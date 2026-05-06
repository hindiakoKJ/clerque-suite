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

  /**
   * Management list — used by /pos/products page.
   *
   * For UNIT_BASED products: stock = InventoryItem.quantity at the branch.
   * For RECIPE_BASED products: stock = maxProducible = MIN(rawMatStock / bom.qty)
   *   across all BOM lines. Same derivation as findForPos() so the management
   *   table and the cashier terminal agree on what's sellable.
   *
   * branchId is optional — when omitted, stock is null (mostly for accountants
   * / multi-branch supervisors who don't have a branch context).
   */
  async findAll(tenantId: string, includeInactive = false, branchId?: string) {
    const products = await this.prisma.product.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      include: {
        category:       { select: { id: true, name: true } },
        variants:       { where: { isActive: true } },
        unitOfMeasure:  { select: { id: true, name: true, abbreviation: true } },
        inventory:      branchId
          ? { where: { branchId }, select: { quantity: true, lowStockAlert: true } }
          : false,
        bomItems:       { select: { rawMaterialId: true, quantity: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Pre-load raw-material stock map for any RECIPE_BASED products.
    let rmStockMap = new Map<string, number>();
    // Sprint 8: pre-load ingredient COST map too, so we can derive each
    // recipe product's true costPrice live (overriding any stale value
    // stored on Product.costPrice).
    let rmCostMap  = new Map<string, number>();
    {
      const allRmIds = new Set<string>();
      for (const p of products) {
        if (p.inventoryMode === 'RECIPE_BASED') {
          for (const b of p.bomItems) allRmIds.add(b.rawMaterialId);
        }
      }
      if (allRmIds.size > 0) {
        // Costs (always loaded — recipe cost derives from these)
        const rmRows = await this.prisma.rawMaterial.findMany({
          where:  { id: { in: Array.from(allRmIds) } },
          select: { id: true, costPrice: true },
        });
        rmCostMap = new Map(rmRows.map((r) => [r.id, r.costPrice != null ? Number(r.costPrice) : 0]));

        // Stocks (only when a branch is in scope — used for max-producible)
        if (branchId) {
          const stockRows = await this.prisma.rawMaterialInventory.findMany({
            where:  { branchId, rawMaterialId: { in: Array.from(allRmIds) } },
            select: { rawMaterialId: true, quantity: true },
          });
          rmStockMap = new Map(stockRows.map((r) => [r.rawMaterialId, Number(r.quantity)]));
        }
      }
    }

    return products.map((p) => {
      let stockQty: number | null = null;
      if (branchId) {
        if (p.inventoryMode === 'RECIPE_BASED') {
          if (p.bomItems.length === 0) {
            stockQty = 0;
          } else {
            let min = Number.POSITIVE_INFINITY;
            for (const bom of p.bomItems) {
              const stock = rmStockMap.get(bom.rawMaterialId) ?? 0;
              const perUnit = Number(bom.quantity);
              if (perUnit <= 0) continue;
              const producible = Math.floor(stock / perUnit);
              if (producible < min) min = producible;
            }
            stockQty = min === Number.POSITIVE_INFINITY ? 0 : min;
          }
        } else {
          // UNIT_BASED — direct branch inventory
          const inv = (p as { inventory?: { quantity: unknown }[] }).inventory?.[0];
          stockQty = inv ? Number(inv.quantity) : null;
        }
      }
      const lowStockAlert = (p as { inventory?: { lowStockAlert: unknown }[] }).inventory?.[0]?.lowStockAlert;
      const lowAlert = lowStockAlert != null ? Number(lowStockAlert) : null;
      const isLowStock =
        stockQty != null &&
        ((lowAlert != null && stockQty <= lowAlert) ||
         (lowAlert == null && p.inventoryMode === 'RECIPE_BASED' && stockQty <= 5));

      // Sprint 8: derive recipe products' costPrice from BOM × ingredient
      // cost, overriding any stale stored value. The stored Product.costPrice
      // is kept in sync via saveBom + receiveRawMaterial + updateRawMaterial,
      // but read-time computation guarantees the dashboard / margin reports
      // are always live even if a write path was missed.
      let costPriceFinal: number | null = p.costPrice != null ? Number(p.costPrice) : null;
      if (p.inventoryMode === 'RECIPE_BASED' && p.bomItems.length > 0) {
        let derived = 0;
        for (const b of p.bomItems) {
          derived += (rmCostMap.get(b.rawMaterialId) ?? 0) * Number(b.quantity);
        }
        costPriceFinal = derived;
      }

      // Strip the bomItems from the response (frontend doesn't need them here)
      // and merge in derived fields.
      const { bomItems: _bom, inventory: _inv, costPrice: _cp, ...rest } = p as { bomItems: unknown; inventory: unknown; costPrice: unknown };
      return {
        ...rest,
        costPrice: costPriceFinal,
        stockQty,
        isLowStock,
        // Hint to the frontend: when true, the cost field is read-only and
        // tracks ingredients automatically.
        costPriceIsDerived: p.inventoryMode === 'RECIPE_BASED' && p.bomItems.length > 0,
      };
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

    // Sprint 8: derive costPrice live for RECIPE_BASED products. Same
    // override pattern as findAll — keeps detail views honest even if a
    // write path missed the recipe-cost ripple.
    const isRecipe = product.inventoryMode === 'RECIPE_BASED' && product.bomItems.length > 0;
    let derivedCost: number | null = product.costPrice != null ? Number(product.costPrice) : null;
    if (isRecipe) {
      derivedCost = product.bomItems.reduce(
        (sum, b) => sum + (b.rawMaterial?.costPrice != null ? Number(b.rawMaterial.costPrice) : 0) * Number(b.quantity),
        0,
      );
    }

    return {
      ...product,
      costPrice:          derivedCost as unknown as typeof product.costPrice,
      costPriceIsDerived: isRecipe,
    };
  }

  async create(tenantId: string, dto: CreateProductDto) {
    const { variants, bomItems, ...rest } = dto;

    // Sprint 8: when a recipe is supplied at create time, derive costPrice
    // from the BOM × ingredient WAC. This overrides any costPrice the form
    // sent — recipe products' cost IS their ingredient cost, by definition.
    let resolvedCostPrice = rest.costPrice;
    if (bomItems && bomItems.length > 0) {
      const rmIds  = bomItems.map((b) => b.rawMaterialId);
      const rmRows = await this.prisma.rawMaterial.findMany({
        where:  { id: { in: rmIds }, tenantId },
        select: { id: true, costPrice: true },
      });
      const costById = new Map(rmRows.map((r) => [r.id, r.costPrice != null ? Number(r.costPrice) : 0]));
      resolvedCostPrice = bomItems.reduce(
        (sum, b) => sum + (costById.get(b.rawMaterialId) ?? 0) * Number(b.quantity),
        0,
      );
    }

    return this.prisma.product.create({
      data: {
        tenantId,
        ...rest,
        price: new Prisma.Decimal(rest.price),
        costPrice: resolvedCostPrice != null ? new Prisma.Decimal(resolvedCostPrice) : undefined,
        // Auto-set inventoryMode based on whether a BOM was supplied.
        inventoryMode: bomItems && bomItems.length > 0 ? 'RECIPE_BASED' : (rest.inventoryMode ?? 'UNIT_BASED'),
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

      // Sync inventoryMode flag + auto-compute Product.costPrice from BOM.
      // For RECIPE_BASED products, costPrice is DERIVED — it's the sum of
      // (bom.qty × ingredient.costPrice) across all BOM lines using the
      // current WAC for each ingredient. The frontend Edit Product form
      // disables the cost field for recipes and shows this computed value
      // as read-only. (Owners can still see + override via direct DB
      // access for emergency cases, but no UI surface for that.)
      const inventoryMode = items.length > 0 ? 'RECIPE_BASED' : 'UNIT_BASED';
      let derivedCost: number | null = null;
      if (items.length > 0) {
        const rmIds  = items.map((b) => b.rawMaterialId);
        const rmRows = await tx.rawMaterial.findMany({
          where:  { id: { in: rmIds }, tenantId },
          select: { id: true, costPrice: true },
        });
        const costById = new Map(rmRows.map((r) => [r.id, r.costPrice != null ? Number(r.costPrice) : 0]));
        derivedCost = items.reduce(
          (sum, b) => sum + (costById.get(b.rawMaterialId) ?? 0) * Number(b.quantity),
          0,
        );
      }

      await tx.product.update({
        where: { id: productId },
        data: {
          inventoryMode,
          // Only overwrite costPrice when we computed a fresh value. Clearing
          // the BOM (empty items) leaves costPrice alone — the product becomes
          // UNIT_BASED and the owner can set their own cost.
          ...(derivedCost != null ? { costPrice: new Prisma.Decimal(derivedCost.toFixed(4)) } : {}),
        },
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
    // Sprint 9: SERVICE businesses (salon, clinic, laundry) sell appointments
    // that have no COGS by design — costPrice = null is the correct state,
    // not a leak. Skip the warning entirely for these tenants.
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { businessType: true },
    });
    if (tenant?.businessType === 'SERVICE') {
      return { count: 0, products: [] };
    }

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
