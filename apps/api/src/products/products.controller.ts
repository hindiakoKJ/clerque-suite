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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProductsService, CreateProductDto, UpdateProductDto } from './products.service';

@ApiTags('Products')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

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
  findForPos(@CurrentUser() user: JwtPayload, @Query('branchId') branchId: string) {
    return this.productsService.findForPos(user.tenantId!, branchId ?? user.branchId ?? '');
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
