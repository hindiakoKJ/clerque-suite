import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService, CreateProductDto, UpdateProductDto } from './products.service';

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

@ApiTags('Products')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private storage: StorageService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('includeInactive') includeInactive?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.productsService.findAll(
      user.tenantId!,
      includeInactive === 'true',
      branchId ?? user.branchId ?? undefined,
    );
  }

  @Get('pos')
  findForPos(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.productsService.findForPos(
      user.tenantId!,
      branchId ?? user.branchId ?? '',
      customerId,
    );
  }

  /** Barcode scanner integration — GET /products/barcode/:barcode */
  @Get('barcode/:barcode')
  findByBarcode(@CurrentUser() user: JwtPayload, @Param('barcode') barcode: string) {
    return this.productsService.findByBarcode(user.tenantId!, barcode);
  }

  /**
   * Products with no cost price set — these silently break gross-profit
   * reporting because no COGS is posted when they sell. Owner-facing audit
   * list, used by the POS Dashboard "fix me" card.
   */
  @Get('missing-cost')
  findMissingCost(@CurrentUser() user: JwtPayload) {
    return this.productsService.findMissingCost(user.tenantId!);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.productsService.findOne(user.tenantId!, id);
  }

  // Master data writes: MDM and OWNER (SOD — no other roles may create products)
  @Roles('BUSINESS_OWNER', 'MDM')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProductDto) {
    return this.productsService.create(user.tenantId!, dto);
  }

  // General update — MDM and OWNER allowed; price/cost fields additionally gated
  // at the service level (SOD Price Wall) against any bypass attempts.
  @Roles('BUSINESS_OWNER', 'MDM')
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(user.tenantId!, id, dto, user.role);
  }

  // Deactivate (soft-delete) — OWNER only; MDM cannot permanently remove products
  @Roles('BUSINESS_OWNER')
  @Delete(':id')
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.productsService.deactivate(user.tenantId!, id);
  }

  /**
   * Sprint 19 — direct image upload from camera or gallery.
   *
   * Stores the file under `uploads/public/products/<tenantId>/<cuid>.<ext>`
   * and returns its public URL. The URL is what gets saved on the product
   * row (`imageUrl` column) so every device with a session — admin, cashier,
   * customer display — renders the same picture without auth.
   *
   * Public URL is fine here: image filenames are random cuid-prefixed and
   * MIME-restricted to images only. There's no PII or financial data in a
   * product photo. Sensitive documents continue to flow through the
   * authenticated `/documents/:id/download` path.
   */
  @ApiOperation({ summary: 'Upload a product image (camera/gallery), returns public URL' })
  @Roles('BUSINESS_OWNER', 'MDM')
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  async uploadImage(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('No file received.');
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw new BadRequestException(`Unsupported image type: ${file.mimetype}. Use JPEG/PNG/WEBP/GIF.`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw new BadRequestException('Image exceeds the 5 MB size limit.');
    }

    const ext = (path.extname(file.originalname) || '.bin').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const id  = crypto.randomBytes(12).toString('hex');
    // Sprint 19 — public/ prefix kept so the static-asset middleware in
    // main.ts continues to serve LOCAL-driver uploads. On S3/R2 the prefix
    // is just part of the object key and getPublicUrl() returns the CDN URL.
    const storageKey = path.posix.join('public', 'products', user.tenantId!, `${id}${ext}`);

    await this.storage.putFromTempPath(file.path, storageKey, {
      contentType:  file.mimetype,
      publicRead:   true, // for AWS S3; ignored on R2 (uses bucket-level public access)
      tenantId:     user.tenantId!,
      originalName: file.originalname,
    });

    return { url: this.storage.getPublicUrl(storageKey) };
  }

  /**
   * Replace the product-level recipe (BOM) in one atomic call.
   * Passing an empty array clears the recipe and sets inventoryMode = UNIT_BASED.
   * Body: { items: [{ rawMaterialId, quantity }] }
   */
  @Roles('BUSINESS_OWNER', 'MDM')
  @Put(':id/bom')
  saveBom(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { items: Array<{ rawMaterialId: string; quantity: number }> },
  ) {
    return this.productsService.saveBom(user.tenantId!, id, body.items ?? []);
  }

  /**
   * Replace the variant-level recipe for a specific size/variant.
   * Body: { items: [{ rawMaterialId, quantity }] }
   */
  @Roles('BUSINESS_OWNER', 'MDM')
  @Put(':id/variants/:variantId/bom')
  saveVariantBom(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('variantId') variantId: string,
    @Body() body: { items: Array<{ rawMaterialId: string; quantity: number }> },
  ) {
    return this.productsService.saveVariantBom(user.tenantId!, productId, variantId, body.items ?? []);
  }
}

/**
 * Public product-photo byte-streaming endpoint. Lives on its own controller
 * (NOT wrapped in JwtAuthGuard/RolesGuard) because product photos are
 * embedded on receipts, customer-display screens, and the public POS grid —
 * none of which carry a JWT. Enumeration is not a real risk: the id is a
 * 24-hex-char cuid-style token, and the payload is just a product photo.
 */
@ApiTags('Products')
@Controller('products/photos')
export class ProductPhotosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async getPhoto(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const row = await this.prisma.productPhoto.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', row.byteSize);
    // Bytes are immutable per id (we never overwrite a photo row in place),
    // so it's safe to cache for a year. New uploads get new ids.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(row.data);
  }
}
