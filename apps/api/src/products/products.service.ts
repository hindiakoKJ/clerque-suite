import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface CreateProductDto {
  name: string;
  description?: string;
  sku?: string;
  categoryId?: string;
  price: number;
  costPrice?: number;
  inventoryMode?: 'UNIT_BASED' | 'RECIPE_BASED';
  isVatable?: boolean;
  variants?: CreateVariantDto[];
  bomItems?: CreateBomItemDto[];
}

export interface CreateVariantDto {
  name: string;
  sku?: string;
  price?: number;
}

export interface CreateBomItemDto {
  rawMaterialId: string;
  quantity: number;
}

export interface UpdateProductDto {
  name?: string;
  description?: string;
  sku?: string;
  categoryId?: string;
  price?: number;
  costPrice?: number;
  isVatable?: boolean;
  isActive?: boolean;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  findAll(tenantId: string, includeInactive = false) {
    return this.prisma.product.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      include: {
        category: { select: { id: true, name: true } },
        variants: { where: { isActive: true } },
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

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    await this.findOne(tenantId, id);
    const { price, costPrice, ...rest } = dto;
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

  // Used by POS terminal — optimized for speed
  findForPos(tenantId: string, branchId: string) {
    return this.prisma.product.findMany({
      where: { tenantId, isActive: true },
      include: {
        category: { select: { id: true, name: true } },
        variants: { where: { isActive: true } },
        inventory: { where: { branchId }, select: { quantity: true, lowStockAlert: true } },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
  }
}
