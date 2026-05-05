import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ingredient (raw-material) reporting.
 *
 * Three report shapes:
 *   1. Per-ingredient movements    — receipts + consumption timeline
 *   2. Per-ingredient FIFO lots    — what's on the shelf, in age order
 *   3. Aggregated tenant report    — opening / purchases / consumption / closing
 *                                    across all ingredients for a date range
 *
 * Consumption isn't logged in its own table — it's derived on the fly by
 * joining completed Orders × OrderItem × Product → BomItem (× variantBom for
 * variant orders). This keeps the schema lean and means consumption history
 * is always perfectly consistent with sales history (no drift between two
 * separately-maintained tables).
 */
export interface IngredientMovementRow {
  id:            string;
  kind:          'RECEIPT' | 'CONSUMPTION';
  occurredAt:    string;
  quantity:      number;
  qtyRemaining:  number;
  unitCost:      number;
  totalValue:    number;
  reference:     string | null;
  paymentMethod: string | null;
  branchId:      string | null;
  orderId:       string | null;
  orderNumber:   string | null;
}

@Injectable()
export class IngredientReportsService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Per-ingredient movements (receipts + consumption)
  // ─────────────────────────────────────────────────────────────────────────

  async getMovements(
    tenantId: string,
    rawMaterialId: string,
    opts: { branchId?: string; from?: string; to?: string; limit?: number } = {},
  ) {
    const rm = await this.prisma.rawMaterial.findFirst({
      where: { id: rawMaterialId, tenantId },
      select: { id: true, name: true, unit: true, costPrice: true },
    });
    if (!rm) throw new NotFoundException('Ingredient not found');

    const fromDate = opts.from ? new Date(opts.from) : undefined;
    const toDate   = opts.to   ? new Date(opts.to)   : undefined;
    const limit    = Math.min(500, opts.limit ?? 200);

    // Receipts — straight from RawMaterialLot (the canonical receipt record).
    const lots = await this.prisma.rawMaterialLot.findMany({
      where: {
        tenantId,
        rawMaterialId,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        ...(fromDate || toDate
          ? { receivedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
          : {}),
      },
      orderBy: { receivedAt: 'desc' },
    });

    const receipts: IngredientMovementRow[] = lots.map((lot) => ({
      id:           `lot-${lot.id}`,
      kind:         'RECEIPT',
      occurredAt:   lot.receivedAt.toISOString(),
      quantity:     Number(lot.qtyReceived),
      qtyRemaining: Number(lot.qtyRemaining),
      unitCost:     Number(lot.unitCost),
      totalValue:   Number(lot.qtyReceived) * Number(lot.unitCost),
      reference:    lot.referenceNumber,
      paymentMethod: lot.paymentMethod,
      branchId:     lot.branchId,
      // Consumption-specific fields
      orderId:      null,
      orderNumber:  null,
    }));

    // Consumption — derived from completed orders that include products
    // whose BOM contains this raw material.
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        status:    'COMPLETED',
        deletedAt: null,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        ...(fromDate || toDate
          ? { completedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
          : {}),
      },
      select: {
        id:          true,
        orderNumber: true,
        completedAt: true,
        branchId:    true,
        items: {
          select: {
            quantity:  true,
            productId: true,
            product:   { select: { name: true } },
          },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    // Pre-load all BOM rows for the products that appear in these orders so
    // we don't N+1 the database. Filter to only the ingredient we care about.
    const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId)))];
    const bomRows = productIds.length
      ? await this.prisma.bomItem.findMany({
          where: { productId: { in: productIds }, rawMaterialId },
          select: { productId: true, quantity: true },
        })
      : [];
    const bomByProduct = new Map<string, number>(
      bomRows.map((b) => [b.productId, Number(b.quantity)]),
    );

    const consumption: IngredientMovementRow[] = [];
    for (const order of orders) {
      let totalQty = 0;
      const productNames: string[] = [];
      for (const it of order.items) {
        const perUnit = bomByProduct.get(it.productId);
        if (!perUnit) continue;
        totalQty += Number(it.quantity) * perUnit;
        if (it.product?.name) productNames.push(`${it.quantity}× ${it.product.name}`);
      }
      if (totalQty <= 0) continue;
      consumption.push({
        id:           `ord-${order.id}`,
        kind:         'CONSUMPTION',
        occurredAt:   (order.completedAt ?? new Date()).toISOString(),
        quantity:     -totalQty, // negative = outflow
        qtyRemaining: 0,
        unitCost:     rm.costPrice != null ? Number(rm.costPrice) : 0,
        totalValue:   rm.costPrice != null ? -totalQty * Number(rm.costPrice) : 0,
        reference:    productNames.join(', ') || null,
        paymentMethod: null,
        branchId:     order.branchId,
        orderId:      order.id,
        orderNumber:  order.orderNumber,
      });
    }

    // Merge, sort by date desc, cap to limit.
    const merged = [...receipts, ...consumption].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt),
    );

    return {
      ingredient: {
        id:        rm.id,
        name:      rm.name,
        unit:      rm.unit,
        costPrice: rm.costPrice != null ? Number(rm.costPrice) : null,
      },
      movements: merged.slice(0, limit),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-ingredient FIFO lots
  // ─────────────────────────────────────────────────────────────────────────

  async getLots(tenantId: string, rawMaterialId: string, branchId?: string) {
    const rm = await this.prisma.rawMaterial.findFirst({
      where: { id: rawMaterialId, tenantId },
      select: { id: true, name: true, unit: true },
    });
    if (!rm) throw new NotFoundException('Ingredient not found');

    const lots = await this.prisma.rawMaterialLot.findMany({
      where: { tenantId, rawMaterialId, ...(branchId ? { branchId } : {}) },
      orderBy: { receivedAt: 'asc' }, // FIFO order — oldest first
    });

    return {
      ingredient: rm,
      lots: lots.map((lot) => ({
        id:              lot.id,
        receivedAt:      lot.receivedAt.toISOString(),
        qtyReceived:     Number(lot.qtyReceived),
        qtyRemaining:    Number(lot.qtyRemaining),
        qtyConsumed:     Number(lot.qtyReceived) - Number(lot.qtyRemaining),
        pctRemaining:    Number(lot.qtyReceived) > 0
          ? (Number(lot.qtyRemaining) / Number(lot.qtyReceived)) * 100
          : 0,
        unitCost:        Number(lot.unitCost),
        valueRemaining:  Number(lot.qtyRemaining) * Number(lot.unitCost),
        valueOriginal:   Number(lot.qtyReceived)  * Number(lot.unitCost),
        reference:       lot.referenceNumber,
        paymentMethod:   lot.paymentMethod,
        branchId:        lot.branchId,
        ageDays:         Math.floor(
          (Date.now() - lot.receivedAt.getTime()) / (1000 * 60 * 60 * 24),
        ),
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Aggregated tenant-level ingredient report
  // ─────────────────────────────────────────────────────────────────────────
  //
  // For each ingredient, returns:
  //   openingQty / openingValue   — derived: closingQty - purchases + consumption
  //   purchasesQty / purchasesValue
  //   consumptionQty / consumptionValue
  //   closingQty   / closingValue  — current RawMaterialInventory snapshot
  //   daysOfStock  — closingQty ÷ avgDailyConsumption (null if no consumption)
  //
  // Date range defaults to the last 30 days.

  async getAggregatedReport(
    tenantId: string,
    opts: { from?: string; to?: string; branchId?: string } = {},
  ) {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromDate = opts.from ? new Date(opts.from) : defaultFrom;
    const toDate   = opts.to   ? new Date(opts.to)   : now;
    const days = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)));

    // 1. List all active ingredients for the tenant.
    const ingredients = await this.prisma.rawMaterial.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, unit: true, costPrice: true, lowStockAlert: true },
    });

    // 2. Current on-hand quantities (closingQty).
    const stocks = await this.prisma.rawMaterialInventory.findMany({
      where: { tenantId, ...(opts.branchId ? { branchId: opts.branchId } : {}) },
    });
    const onHandByRm = new Map<string, number>();
    for (const s of stocks) {
      onHandByRm.set(
        s.rawMaterialId,
        (onHandByRm.get(s.rawMaterialId) ?? 0) + Number(s.quantity),
      );
    }

    // 3. Purchases in range (from RawMaterialLot.receivedAt).
    const lotsInRange = await this.prisma.rawMaterialLot.findMany({
      where: {
        tenantId,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        receivedAt: { gte: fromDate, lte: toDate },
      },
      select: { rawMaterialId: true, qtyReceived: true, unitCost: true },
    });
    const purchasesQtyByRm = new Map<string, number>();
    const purchasesValByRm = new Map<string, number>();
    for (const lot of lotsInRange) {
      const qty = Number(lot.qtyReceived);
      const val = qty * Number(lot.unitCost);
      purchasesQtyByRm.set(lot.rawMaterialId, (purchasesQtyByRm.get(lot.rawMaterialId) ?? 0) + qty);
      purchasesValByRm.set(lot.rawMaterialId, (purchasesValByRm.get(lot.rawMaterialId) ?? 0) + val);
    }

    // 4. Consumption in range (derived from completed orders × BOM).
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        status:      'COMPLETED',
        deletedAt:   null,
        completedAt: { gte: fromDate, lte: toDate },
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
      },
      select: {
        items: {
          select: { productId: true, quantity: true },
        },
      },
    });

    const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId)))];
    const allBom = productIds.length
      ? await this.prisma.bomItem.findMany({
          where:  { productId: { in: productIds } },
          select: { productId: true, rawMaterialId: true, quantity: true },
        })
      : [];
    // Index BOM by productId for quick lookup
    const bomByProduct = new Map<string, Array<{ rawMaterialId: string; quantity: number }>>();
    for (const b of allBom) {
      const arr = bomByProduct.get(b.productId) ?? [];
      arr.push({ rawMaterialId: b.rawMaterialId, quantity: Number(b.quantity) });
      bomByProduct.set(b.productId, arr);
    }

    const consumptionQtyByRm = new Map<string, number>();
    for (const order of orders) {
      for (const item of order.items) {
        const recipe = bomByProduct.get(item.productId);
        if (!recipe) continue;
        for (const r of recipe) {
          const qty = Number(item.quantity) * r.quantity;
          consumptionQtyByRm.set(
            r.rawMaterialId,
            (consumptionQtyByRm.get(r.rawMaterialId) ?? 0) + qty,
          );
        }
      }
    }

    // 5. Build the per-ingredient rows.
    const rows = ingredients.map((rm) => {
      const cost           = rm.costPrice != null ? Number(rm.costPrice) : 0;
      const closingQty     = onHandByRm.get(rm.id) ?? 0;
      const purchasesQty   = purchasesQtyByRm.get(rm.id) ?? 0;
      const purchasesValue = purchasesValByRm.get(rm.id) ?? 0;
      const consumptionQty = consumptionQtyByRm.get(rm.id) ?? 0;
      const consumptionValue = consumptionQty * cost;
      // Opening = closing - net change; net change = purchases - consumption.
      const openingQty   = closingQty - purchasesQty + consumptionQty;
      const openingValue = openingQty * cost;
      const closingValue = closingQty * cost;
      const avgDailyConsumption = consumptionQty / days;
      const daysOfStock = avgDailyConsumption > 0
        ? Math.round((closingQty / avgDailyConsumption) * 10) / 10
        : null;
      return {
        id:                rm.id,
        name:              rm.name,
        unit:              rm.unit,
        costPrice:         cost,
        lowStockAlert:     rm.lowStockAlert != null ? Number(rm.lowStockAlert) : null,
        openingQty,
        openingValue,
        purchasesQty,
        purchasesValue,
        consumptionQty,
        consumptionValue,
        closingQty,
        closingValue,
        daysOfStock,
        isLowStock:
          rm.lowStockAlert != null && closingQty <= Number(rm.lowStockAlert),
      };
    });

    // 6. Totals.
    const totals = rows.reduce(
      (acc, r) => ({
        openingValue:     acc.openingValue     + r.openingValue,
        purchasesValue:   acc.purchasesValue   + r.purchasesValue,
        consumptionValue: acc.consumptionValue + r.consumptionValue,
        closingValue:     acc.closingValue     + r.closingValue,
      }),
      { openingValue: 0, purchasesValue: 0, consumptionValue: 0, closingValue: 0 },
    );

    return {
      from:    fromDate.toISOString(),
      to:      toDate.toISOString(),
      days,
      branchId: opts.branchId ?? null,
      rows,
      totals,
    };
  }
}
