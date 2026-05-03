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

  /**
   * Replace all BOM items for a product in one atomic operation.
   * Passing an empty array clears the recipe entirely.
   * Also sets inventoryMode = RECIPE_BASED when items are provided, UNIT_BASED when cleared.
   */
  async saveBom(
    tenantId: string,
    productId: string,
    items: CreateBomItemDto[],
  ) {
    await this.findOne(tenantId, productId); // ownership check

    return this.prisma.$transaction(async (tx) => {
      // Wipe existing BOM
      await tx.bomItem.deleteMany({ where: { productId } });

      // Re-insert new BOM
      if (items.length > 0) {
        await tx.bomItem.createMany({
          data: items.map((b) => ({
            productId,
            rawMaterialId: b.rawMaterialId,
            quantity: new Prisma.Decimal(b.quantity),
          })),
        });
      }

      // Sync inventoryMode flag
      await tx.product.update({
        where: { id: productId },
        data: { inventoryMode: items.length > 0 ? 'RECIPE_BASED' : 'UNIT_BASED' },
      });

      // Return updated BOM with raw material names
      return tx.bomItem.findMany({
        where: { productId },
        include: { rawMaterial: { select: { id: true, name: true, unit: true } } },
      });
    });
  }

  /**
   * Replace all BOM items for a specific variant.
   * Used by the Variants & Recipe modal to set size-specific quantities.
   */
  async saveVariantBom(
    tenantId: string,
    productId: string,
    variantId: string,
    items: Array<{ rawMaterialId: string; quantity: number }>,
  ) {
    // Verify the variant belongs to the product which belongs to the tenant
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, product: { tenantId } },
    });
    if (!variant) throw new NotFoundException('Variant not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.variantBomItem.deleteMany({ where: { variantId } });

      if (items.length > 0) {
        await tx.variantBomItem.createMany({
          data: items.map((b) => ({
            variantId,
            rawMaterialId: b.rawMaterialId,
            quantity: new Prisma.Decimal(b.quantity),
          })),
        });
      }

      return tx.variantBomItem.findMany({
        where: { variantId },
        include: { rawMaterial: { select: { id: true, name: true, unit: true } } },
      });
    });
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
  /**
   * Products with no costPrice set. These break COGS reporting silently —
   * sales register revenue but no cost, overstating gross profit.
   * Returns active products only (deactivated ones can't be sold anyway).
   */
  async findMissingCost(tenantId: string) {
    const products = await this.prisma.product.findMany({
      where:   { tenantId, isActive: true, costPrice: null },
      select:  {
        id: true, name: true, sku: true, price: true,
        category: { select: { name: true } },
      },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });
    return {
      count:    products.length,
      products,
    };
  }

  /**
   * POS terminal product feed.
   *
   * For UNIT_BASED products, stock = InventoryItem.quantity at this branch
   * (the same as before).
   *
   * For RECIPE_BASED products (F&B drinks/dishes), there is no finished-goods
   * stock — instead we compute "maxProducible" = MIN(ingredient.stock / bom.qty)
   * across all BOM lines. When chocolate syrup runs out, every drink that uses
   * chocolate syrup automatically shows "0 left" because it's a derived value.
   *
   * The terminal uses this number to:
   *   - Show "X left" badge on each tile
   *   - Gray out tiles where maxProducible = 0 (cannot be sold)
   *   - Show amber "Low" badge when below the product's lowStockAlert
   */
  async findForPos(tenantId: string, branchId: string) {
    const products = await this.prisma.product.findMany({
      where: { tenantId, isActive: true },
      include: {
        category: { select: { id: true, name: true } },
        variants: { where: { isActive: true } },
        inventory: { where: { branchId }, select: { quantity: true, lowStockAlert: true } },
        // BOM lines so we can compute maxProducible for RECIPE_BASED items
        bomItems: { select: { rawMaterialId: true, quantity: true } },
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

    // Collect every raw-material id referenced by any recipe in one query
    const allRawMaterialIds = new Set<string>();
    for (const p of products) {
      if (p.inventoryMode === 'RECIPE_BASED') {
        for (const b of p.bomItems) allRawMaterialIds.add(b.rawMaterialId);
      }
    }

    let rmStockMap = new Map<string, number>();
    if (allRawMaterialIds.size > 0 && branchId) {
      const rmInventory = await this.prisma.rawMaterialInventory.findMany({
        where: {
          branchId,
          rawMaterialId: { in: Array.from(allRawMaterialIds) },
        },
        select: { rawMaterialId: true, quantity: true },
      });
      rmStockMap = new Map(rmInventory.map((r) => [r.rawMaterialId, Number(r.quantity)]));
    }

    return products.map((p) => {
      let maxProducible: number | null = null;

      if (p.inventoryMode === 'RECIPE_BASED') {
        // No BOM at all → cannot produce; treat as 0 so cashier can't sell it.
        if (p.bomItems.length === 0) {
          maxProducible = 0;
        } else {
          // Limiting ingredient = the one that yields the lowest producible count.
          let min = Number.POSITIVE_INFINITY;
          for (const bom of p.bomItems) {
            const stock = rmStockMap.get(bom.rawMaterialId) ?? 0;
            const perUnit = Number(bom.quantity);
            if (perUnit <= 0) continue;
            const producible = Math.floor(stock / perUnit);
            if (producible < min) min = producible;
          }
          maxProducible = min === Number.POSITIVE_INFINITY ? 0 : min;
        }
      } else {
        // UNIT_BASED: same as before — finished-goods inventory at branch.
        const inv = p.inventory[0];
        maxProducible = inv ? Number(inv.quantity) : null;
      }

      const lowStockAlert = p.inventory[0]?.lowStockAlert ?? null;
      const isLowStock =
        maxProducible != null &&
        ((lowStockAlert != null && maxProducible <= lowStockAlert) ||
         (lowStockAlert == null && maxProducible <= 5)); // sensible default for recipes
      const isOutOfStock = maxProducible === 0;

      return {
        ...p,
        maxProducible,
        isLowStock,
        isOutOfStock,
      };
    });
  }
}
