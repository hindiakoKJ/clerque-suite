import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { availableQty, heldAcross, heldUsage } from '../orders/held-usage';
import { stillWaiting } from '../orders/waste';
import { DAY_MS, isManilaDay, manilaDayStart, usedByDay, UsageDay, UsageRow } from './daily-usage';

/**
 * Ingredient (raw-material) reporting.
 *
 * Four report shapes:
 *   1. Per-ingredient movements    — receipts + consumption timeline
 *   2. Per-ingredient FIFO lots    — what's on the shelf, in age order
 *   3. Aggregated tenant report    — opening / purchases / consumption / closing
 *                                    across all ingredients for a date range
 *   4. Daily usage (daily-usage.ts) — what left the shelf each Manila day,
 *                                    as sold / wasted / into preps / written off.
 *                                    The aggregated report's consumption and the
 *                                    end-of-day message both read it.
 *
 * Consumption isn't logged in its own table — it's derived on the fly from
 * order lines × their recipe (size recipe and add-ons included), prep batches
 * and write-offs; see daily-usage.ts. This keeps the schema lean and means
 * consumption history is always perfectly consistent with sales history (no
 * drift between two separately-maintained tables). A line still waiting at a kitchen or bar
 * screen is left out: its ingredients leave stock when it is marked ready.
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
        // Purchases only — a write-off's sentinel lot carries a negative
        // qtyReceived so it can hold the idempotency reference, and counting
        // it here would net removals against what was bought.
        qtyReceived: { gt: 0 },
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

    // Consumption — derived from paid orders (PAID + COMPLETED) that
    // include products whose BOM contains this raw material. Most lines
    // take their ingredients at the sale, so a PAID order has used them even
    // before production finishes. A line that waits at a kitchen or bar
    // screen takes them only when it is marked ready, so while it waits it
    // has used nothing and is left out below.
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        status:    { in: ['PAID', 'COMPLETED'] },
        deletedAt: null,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        ...(fromDate || toDate
          ? { paidAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
          : {}),
      },
      select: {
        id:          true,
        orderNumber: true,
        paidAt:      true,
        completedAt: true,
        branchId:    true,
        items: {
          select: {
            quantity:      true,
            productId:     true,
            usageOnReady:  true,
            usagePostedAt: true,
            product:       { select: { name: true } },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
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
        if (stillWaiting(it)) continue;   // nothing has left the shelf for it yet
        const perUnit = bomByProduct.get(it.productId);
        if (!perUnit) continue;
        totalQty += Number(it.quantity) * perUnit;
        if (it.product?.name) productNames.push(`${it.quantity}× ${it.product.name}`);
      }
      if (totalQty <= 0) continue;
      consumption.push({
        id:           `ord-${order.id}`,
        kind:         'CONSUMPTION',
        occurredAt:   (order.paidAt ?? order.completedAt ?? new Date()).toISOString(),
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
      // Sentinels excluded: a lot with negative qtyReceived is a write-off
      // marker, not a layer of stock that can be drained.
      where: { tenantId, rawMaterialId, qtyReceived: { gt: 0 }, ...(branchId ? { branchId } : {}) },
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
  //   consumptionQty / consumptionValue — everything that left the shelf
  //   soldQty / wastedQty / intoPrepsQty / writtenOffQty — why it left (they add up to consumptionQty)
  //   (totals.consumptionValue leaves intoPreps out -- see step 6)
  //   closingQty   / closingValue  — current RawMaterialInventory snapshot
  //   heldQty      — what tickets still waiting at a kitchen or bar screen hold
  //   availableQty — closingQty less heldQty, never below zero
  //   daysOfStock  — availableQty ÷ avgDailyConsumption (null if no consumption)
  //   isLowStock   — availableQty at or under the ingredient's alert level
  //
  // Date range defaults to the last 30 days. A bare date (YYYY-MM-DD, what the
  // report page's date pickers send) is a whole Manila day, `to` included.

  async getAggregatedReport(
    tenantId: string,
    opts: { from?: string; to?: string; branchId?: string } = {},
  ) {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    /*
      `new Date('2026-09-16')` is UTC midnight -- 8 AM in Manila. So "Sep 1 to
      Sep 16" ran from 8 AM on the 1st to 8 AM on the 16th: the first morning
      of sales went uncounted and the last day stopped at breakfast, which is
      never going to match a sheet counted by hand. One window for every figure
      on the report, so opening = closing - purchases + consumption still holds.
    */
    const fromDate = opts.from
      ? (isManilaDay(opts.from) ? manilaDayStart(opts.from) : new Date(opts.from))
      : defaultFrom;
    const toDate = opts.to
      ? (isManilaDay(opts.to) ? new Date(manilaDayStart(opts.to).getTime() + DAY_MS - 1) : new Date(opts.to))
      : now;
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
        qtyReceived: { gt: 0 },   // purchases, not write-off sentinels
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

    /*
      2b. What tickets still waiting at a kitchen or bar screen hold.

      That stock is still on the books -- closing stays the book figure, the
      same number the stock screen and the valuation show -- but it is already
      promised and leaves the moment the tickets are marked ready. Days of
      cover and the low-stock flag are warnings about what is left to sell, so
      they read the stock less what is held. Every branch when none is asked.
    */
    const held = await heldUsage(this.prisma, tenantId, opts.branchId ? [opts.branchId] : null);

    /*
      4. Consumption: everything that left the shelf in range, and why.

      This used to walk only the PRODUCT's own recipe, so a Large read as a
      Regular, an add-on's syrup was never counted, oat milk did not take the
      dairy off, and a voided or refunded drink whose milk was already poured
      counted one way here and another on the stock book. The same numbers
      the staff count by hand now come from one place: sold and wasted order
      lines through the shared recipe walk, prep batches, and write-offs. A
      line still waiting at a kitchen or bar screen has used nothing and is
      left out, which also keeps opening (closing - purchases + consumption)
      true. `to` is inclusive here, the daily usage exclusive.
    */
    const usage = await usedByDay(this.prisma, tenantId, opts.branchId ?? null, fromDate, new Date(toDate.getTime() + 1));
    const usedByRm = new Map(usage.rows.map((r) => [r.rawMaterialId, r]));

    // 5. Build the per-ingredient rows.
    const rows = ingredients.map((rm) => {
      const cost           = rm.costPrice != null ? Number(rm.costPrice) : 0;
      const closingQty     = onHandByRm.get(rm.id) ?? 0;
      const purchasesQty   = purchasesQtyByRm.get(rm.id) ?? 0;
      const purchasesValue = purchasesValByRm.get(rm.id) ?? 0;
      const used           = usedByRm.get(rm.id);
      const consumptionQty = used?.total ?? 0;
      const consumptionValue = consumptionQty * cost;
      // Opening = closing - net change; net change = purchases - consumption.
      const openingQty   = closingQty - purchasesQty + consumptionQty;
      const openingValue = openingQty * cost;
      const closingValue = closingQty * cost;
      const heldQty      = heldAcross(held, rm.id);
      const available    = availableQty(closingQty, heldQty);
      const avgDailyConsumption = consumptionQty / days;
      const daysOfStock = avgDailyConsumption > 0
        ? Math.round((available / avgDailyConsumption) * 10) / 10
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
        soldQty:           used?.sold ?? 0,
        wastedQty:         used?.wasted ?? 0,
        intoPrepsQty:      used?.intoPreps ?? 0,
        writtenOffQty:     used?.writtenOff ?? 0,
        closingQty,
        closingValue,
        heldQty,
        availableQty: available,
        daysOfStock,
        isLowStock:
          rm.lowStockAlert != null && available <= Number(rm.lowStockAlert),
      };
    });

    /*
      6. Totals. The split is priced like consumptionValue. Each row keeps its
      preps (the sugar did leave the sugar shelf), but the consumption total
      does not: that sugar became syrup still on the shelf, and the syrup is
      counted again when it is sold, wasted or written off. So sold + wasted +
      written off add up to the total, and intoPrepsValue stands on its own.
    */
    const totals = rows.reduce(
      (acc, r) => ({
        openingValue:     acc.openingValue     + r.openingValue,
        purchasesValue:   acc.purchasesValue   + r.purchasesValue,
        consumptionValue: acc.consumptionValue + (r.soldQty + r.wastedQty + r.writtenOffQty) * r.costPrice,
        soldValue:        acc.soldValue        + r.soldQty       * r.costPrice,
        wastedValue:      acc.wastedValue      + r.wastedQty     * r.costPrice,
        intoPrepsValue:   acc.intoPrepsValue   + r.intoPrepsQty  * r.costPrice,
        writtenOffValue:  acc.writtenOffValue  + r.writtenOffQty * r.costPrice,
        closingValue:     acc.closingValue     + r.closingValue,
      }),
      {
        openingValue: 0, purchasesValue: 0, consumptionValue: 0,
        soldValue: 0, wastedValue: 0, intoPrepsValue: 0, writtenOffValue: 0,
        closingValue: 0,
      },
    );

    return {
      from:    fromDate.toISOString(),
      to:      toDate.toISOString(),
      days,
      branchId: opts.branchId ?? null,
      rows,
      totals,
      // Units sold in range still waiting at a kitchen or bar screen: not in consumption yet.
      stillBeingMade: usage.stillBeingMade,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // One day's usage -- what the end-of-day message sends
  // ─────────────────────────────────────────────────────────────────────────

  /** One Manila day: rows most valuable first, peso totals, and what is still being made. */
  async usageForDay(tenantId: string, branchId: string | null, day: string): Promise<UsageDay> {
    if (!isManilaDay(day)) {
      throw new BadRequestException('The day has to be a real date written as YYYY-MM-DD.');
    }
    const from = manilaDayStart(day);
    const usage = await usedByDay(this.prisma, tenantId, branchId, from, new Date(from.getTime() + DAY_MS));
    return usage.days.find((d) => d.day === day) ?? {
      day,
      rows: [],
      totals: { soldValue: 0, wastedValue: 0, intoPrepsValue: 0, writtenOffValue: 0, value: 0 },
      stillBeingMade: 0,
    };
  }

  /**
   * Everything used at a branch in [from, to), as one sheet under `label`.
   *
   * For the end-of-day message of a shop that closes after midnight: its
   * trade runs from one closing to the next, not midnight to midnight, so the
   * 00:30 latte belongs on the sheet sent at 01:00. The rows, totals and what
   * is still being made are for the whole window, never cut at midnight;
   * `label` only names the sheet (the business day most of it falls in).
   */
  async usageForWindow(tenantId: string, branchId: string, label: string, from: Date, to: Date): Promise<UsageDay> {
    if (!isManilaDay(label)) {
      throw new BadRequestException('The day has to be a real date written as YYYY-MM-DD.');
    }
    const usage = await usedByDay(this.prisma, tenantId, branchId, from, to);
    return { day: label, rows: usage.rows, totals: usage.totals, stillBeingMade: usage.stillBeingMade };
  }

  /** The ingredients used on one Manila day at a branch (every branch when null), most valuable first. */
  async usedOn(tenantId: string, branchId: string | null, day: string): Promise<UsageRow[]> {
    return (await this.usageForDay(tenantId, branchId, day)).rows;
  }
}
