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
import { memoryStorage } from 'multer';
import { Response } from 'express';
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
import { SuperAdminGuard } from '../admin/admin.guard';

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
  // Memory storage, EXPLICITLY. This module registers no MulterModule, so the
  // interceptor already ran on multer's memory default — where `file.path`
  // does not exist. The handler below used to read `file.path` anyway, so
  // every upload died on readFile(undefined) with a 500 the UI could only
  // report as a server error. The file lives in `file.buffer`; say so in the
  // interceptor config so the contract is visible, and hand the buffer to
  // storage directly — no temp files, works on Railway's read-only disk.
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } }))
  async uploadImage(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('No file received.');
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported image type: ${file.mimetype}. Use JPEG/PNG/WEBP/GIF.`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Image exceeds the 5 MB size limit.');
    }

    const ext = (path.extname(file.originalname) || '.bin').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const id  = crypto.randomBytes(12).toString('hex');
    // Sprint 19 — public/ prefix kept so the static-asset middleware in
    // main.ts continues to serve LOCAL-driver uploads. On S3/R2 the prefix
    // is just part of the object key and getPublicUrl() returns the CDN URL.
    const storageKey = path.posix.join('public', 'products', user.tenantId!, `${id}${ext}`);

    await this.storage.putBuffer(file.buffer, storageKey, {
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Why a photo is not showing.
   *
   * Product images have now failed twice for reasons that were invisible from
   * the outside: the storage driver silently chose ephemeral disk, and then the
   * check meant to prevent that matched environment variables Railway does not
   * set. Both times the only symptom was a blank square, and both times the fix
   * was guessed rather than observed. This makes the state readable instead:
   * which driver is live, whether photos are actually in the database, and the
   * exact URL that would be produced.
   *
   * Declared BEFORE `:id` so Express does not match "_diagnostics" as an id.
   *
   * SUPER_ADMIN ONLY. It was originally left public "because it exposes no
   * photo bytes, no tenant data and no credentials" -- which was wrong on the
   * second count and dangerous on the third. It returned a platform-wide photo
   * count and the ids of the three most recently uploaded photos ACROSS EVERY
   * TENANT. Those ids are precisely the tokens the sibling route trusts: the
   * public GET :id is safe only because the id is unguessable, and this handed
   * three of them out to anyone with curl and no account at all. A diagnostic
   * that defeats the control protecting the thing it diagnoses is not a
   * diagnostic.
   *
   * The part that is actually useful for debugging -- which storage driver is
   * live and what URL an upload would produce -- is configuration, not tenant
   * data, and it stays.
   */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('_diagnostics')
  async diagnostics(): Promise<Record<string, unknown>> {
    const recent = await this.prisma.productPhoto.findMany({
      orderBy: { createdAt: 'desc' },
      take:    3,
      select:  { id: true, mimeType: true, byteSize: true, createdAt: true },
    });
    const sampleKey = 'public/products/TENANT/deadbeefcafe1234.jpg';
    return {
      driver:          this.storage.driverName,
      photosInDatabase: await this.prisma.productPhoto.count(),
      recent,
      // What an upload would hand the browser right now.
      urlThatWouldBeReturned: this.storage.getPublicUrl(sampleKey),
      hint:
        this.storage.driverName === 'LOCAL'
          ? 'LOCAL writes to disk. On Railway that disk is wiped by every deploy, so photos vanish without an error.'
          : this.storage.driverName === 'DB'
            ? 'DB keeps photos in Postgres. If a photo still will not load, open urlThatWouldBeReturned directly and see what comes back.'
            : 'S3/R2. Check the bucket is public-read and S3_PUBLIC_URL is set.',
    };
  }

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
