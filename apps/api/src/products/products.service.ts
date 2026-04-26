import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { hasPermission } from '@repo/shared-types';

/** Roles that may NOT edit price/cost fields under any circumstances (SOD Price Wall). */
const PRICE_WALL_BLOCKED = ['CASHIER', 'SALES_LEAD', 'WAREHOUSE_STAFF', 'BOOKKEEPER',
                            'AR_ACCOUNTANT', 'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR'] as const;

import { CreateProductDto, CreateVariantDto, CreateBomItemDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
export { CreateProductDto, UpdateProductDto, CreateVariantDto, CreateBomItemDto };

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  findAll(tenantId: string, includeInactive = false) {
    return this.prisma.product.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      include: {
        category:       { select: { id: true, name: true } },
        variants:       { where: { isActive: true } },
        unitOfMeasure:  { select: { id: true, name: true, abbreviation: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        category: true,
        variants: true,
        bomItems: { include: { rawMaterial: true } },
        modifierGroups: {
          include: {
            modifierGroup: {
              include: {
                options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(tenantId: string, dto: CreateProductDto) {
    const { variants, bomItems, ...rest } = dto;
    return this.prisma.product.create({
      data: {
        tenantId,
        ...rest,
        price: new Prisma.Decimal(rest.price),
        costPrice: rest.costPrice != null ? new Prisma.Decimal(rest.costPrice) : undefined,
        variants: variants
          ? { create: variants.map((v) => ({ ...v, price: v.price != null ? new Prisma.Decimal(v.price) : undefined })) }
          : undefined,
        bomItems: bomItems
          ? { create: bomItems.map((b) => ({ rawMaterialId: b.rawMaterialId, quantity: new Prisma.Decimal(b.quantity) })) }
          : undefined,
      },
      include: { variants: true, bomItems: { include: { rawMaterial: true } } },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto, callerRole?: string) {
    await this.findOne(tenantId, id);
    const { price, costPrice, ...rest } = dto;

    // ── SOD Price Wall ────────────────────────────────────────────────────────
    // Defense-in-depth: the controller @Roles() guard is the first line; this
    // service-level check is the second — it fires even if the guard is bypassed
    // (e.g., internal service calls or misconfigured decorators).
    if ((price != null || costPrice != null) && !hasPermission(callerRole, 'product:edit_price')) {
      throw new ForbiddenException(
        `Role '${callerRole}' is not permitted to modify product prices. ` +
        'Contact your Business Owner or Master Data Manager.',
      );
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...rest,
        ...(price != null ? { price: new Prisma.Decimal(price) } : {}),
        ...(costPrice != null ? { costPrice: new Prisma.Decimal(costPrice) } : {}),
      },
    });
  }

  async deactivate(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.product.update({ where: { id }, data: { isActive: false } });
  }

  /** Barcode scanner lookup — returns the first active product matching the barcode value. */
  async findByBarcode(tenantId: string, barcode: string) {
    const product = await this.prisma.product.findFirst({
      where: { tenantId, barcode, isActive: true },
      include: {
        category:      { select: { id: true, name: true } },
        variants:      { where: { isActive: true } },
        unitOfMeasure: { select: { id: true, name: true, abbreviation: true } },
      },
    });
    if (!product) throw new NotFoundException(`No active product found for barcode '${barcode}'`);
    return product;
  }

  // Used by POS terminal — optimized for speed; includes modifier groups
  findForPos(tenantId: string, branchId: string) {
    return this.prisma.product.findMany({
      where: { tenantId, isActive: true },
      include: {
        category: { select: { id: true, name: true } },
        variants: { where: { isActive: true } },
        inventory: { where: { branchId }, select: { quantity: true, lowStockAlert: true } },
        modifierGroups: {
          include: {
            modifierGroup: {
              include: {
                options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
  }
}
