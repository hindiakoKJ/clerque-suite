import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { availableQty, heldAcross, heldUsage } from '../orders/held-usage';
import { loadLineRecipes } from '../orders/line-recipes';
import { stillWaiting } from '../orders/waste';
import { DAY_MS, isManilaDay, manilaDayStart, usedByDay, UsageDay, UsageRow } from './daily-usage';

/**
 * Ingredient (raw-material) reporting.
 *
 * Four report shapes:
 *   1. Per-ingredient movements    — deliveries, sales, prep batches,
 *                                    write-offs and counts, one timeline
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
export type IngredientMovementKind = 'RECEIPT' | 'CONSUMPTION' | 'PREP' | 'WRITE_OFF' | 'COUNT';

export interface IngredientMovementRow {
  id:            string;
  /**
   * RECEIPT      a delivery, or a batch of this prep made
   * CONSUMPTION  used by a sale, through the full recipe walk (size, add-ons)
   * PREP         used by a batch of a syrup, sauce or dough
   * WRITE_OFF    spoiled, dropped, thrown out at a station
   * COUNT        a physical count's correction (+ found, - missing)
   */
  kind:          IngredientMovementKind;
  occurredAt:    string;
  /** Signed: + arrived on the shelf, - left it. */
  quantity:      number;
  qtyRemaining:  number;
  unitCost:      number;
  /** Signed like `quantity`. */
  totalValue:    number;
  reference:     string | null;
  paymentMethod: string | null;
  branchId:      string | null;
  orderId:       string | null;
  orderNumber:   string | null;
  /** Why, when the record said: a write-off's reason, a count's kind. */
  reason:        string | null;
}

/** Plain words for a write-off's reason code, so the timeline never reads "DAMAGE". */
const WRITE_OFF_REASON_TEXT: Record<string, string> = {
  EXPIRY:       'Past its date',
  DAMAGE:       'Dropped, spilled or spoiled',
  THEFT:        'Missing',
  SAMPLE:       'Given away',
  INTERNAL_USE: 'Staff use',
  OTHER:        'Other',
};

/** A write-off's books entry may be stamped a little after its lot; this far apart they are still one write-off. */
const WRITE_OFF_MATCH_MS = 10 * 60 * 1000;

/**
 * The window a report asks for. A bare day (YYYY-MM-DD, what the date
 * pickers send) is the whole Manila day, `to` included: `new Date('2026-09-16')`
 * is UTC midnight, 8 AM here, which dropped the first morning's delivery and
 * cut the last day off at breakfast. Anything else is the instant it names.
 */
function windowOf(from?: string, to?: string): { fromDate?: Date; toDate?: Date } {
  const fromDate = from ? (isManilaDay(from) ? manilaDayStart(from) : new Date(from)) : undefined;
  const toDate   = to   ? (isManilaDay(to)   ? new Date(manilaDayStart(to).getTime() + DAY_MS - 1) : new Date(to)) : undefined;
  if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
    throw new BadRequestException('The report dates are not valid dates.');
  }
  return { fromDate, toDate };
}

@Injectable()
export class IngredientReportsService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Per-ingredient movements (everything that put it on the shelf or took it off)
  // ─────────────────────────────────────────────────────────────────────────

  /*
    Every way this ingredient moves, from the same records the stock book and
    the daily usage sheet read. It used to show deliveries and the sales of
    products whose OWN recipe named the ingredient, and nothing else: a syrup
    used only through add-ons read "consumed 0", the 100 ml just written off
    was not on the timeline, and the 760 g a batch of teriyaki took was
    missing while the shelf said it was gone.
  */
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

    const { fromDate, toDate } = windowOf(opts.from, opts.to);
    const limit  = Math.min(500, opts.limit ?? 200);
    const branch = opts.branchId ? { branchId: opts.branchId } : {};
    const between = (field: string) =>
      fromDate || toDate
        ? { [field]: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : {};
    const inRange = (at: Date) =>
      (!fromDate || at.getTime() >= fromDate.getTime()) && (!toDate || at.getTime() <= toDate.getTime());
    const cost = rm.costPrice != null ? Number(rm.costPrice) : 0;
    const rows: IngredientMovementRow[] = [];

    /*
      1. Lots. A delivery or a batch of this prep made is a lot with a
      positive qtyReceived. A write-off leaves a marker lot with a NEGATIVE
      qtyReceived (written for every write-off, priced or not), so both come
      from one query and the sign says which is which.
    */
    const lots = await this.prisma.rawMaterialLot.findMany({
      where:   { tenantId, rawMaterialId, ...branch, ...between('receivedAt') },
      orderBy: { receivedAt: 'desc' },
    });

    /*
      2. The books: every batch (to find the ones that took this ingredient),
      and every entry about this ingredient (a write-off's reason, a count's
      correction). Read from the start of the window with no upper bound: a
      batch is dated when it was made, which can be before it was recorded,
      and a write-off's entry lands a moment after its lot.
    */
    const events = await this.prisma.accountingEvent.findMany({
      where: {
        tenantId,
        type: 'INVENTORY_ADJUSTMENT',
        ...(fromDate ? { createdAt: { gte: fromDate } } : {}),
        OR: [
          { payload: { path: ['kind'],          equals: 'SUB_RECIPE_BATCH' } },
          { payload: { path: ['rawMaterialId'], equals: rawMaterialId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, createdAt: true, payload: true },
    });
    const payloads = events.map((ev) => ({ ev, p: (ev.payload ?? null) as Record<string, unknown> | null }));
    const writeOffEntries = payloads.filter(({ p }) =>
      p && p['adjustmentType'] === 'WRITE_OFF' && p['rawMaterialId'] === rawMaterialId,
    );
    const reasonOfWriteOff = (lot: { referenceNumber: string | null; qtyReceived: unknown; receivedAt: Date }): string | null => {
      const qty = Math.abs(Number(lot.qtyReceived));
      const hit = writeOffEntries.find(({ ev, p }) =>
        lot.referenceNumber
          ? p!['referenceNumber'] === lot.referenceNumber
          : Math.abs(Number(p!['quantity'])) === qty
            && Math.abs(ev.createdAt.getTime() - lot.receivedAt.getTime()) <= WRITE_OFF_MATCH_MS,
      );
      if (!hit) return null;
      const said = hit.p!['reason'];
      const code = hit.p!['reasonCode'];
      if (typeof said === 'string' && said && said !== code) return said;   // the note the person typed
      return typeof code === 'string' ? (WRITE_OFF_REASON_TEXT[code] ?? code) : null;
    };

    for (const lot of lots) {
      const received = Number(lot.qtyReceived);
      if (received > 0) {
        rows.push({
          id:            `lot-${lot.id}`,
          kind:          'RECEIPT',
          occurredAt:    lot.receivedAt.toISOString(),
          quantity:      received,
          qtyRemaining:  Number(lot.qtyRemaining),
          unitCost:      Number(lot.unitCost),
          totalValue:    received * Number(lot.unitCost),
          reference:     lot.referenceNumber,
          paymentMethod: lot.paymentMethod,
          branchId:      lot.branchId,
          orderId:       null,
          orderNumber:   null,
          reason:        null,
        });
      } else if (received < 0) {
        rows.push({
          id:            `wo-${lot.id}`,
          kind:          'WRITE_OFF',
          occurredAt:    lot.receivedAt.toISOString(),
          quantity:      received,
          qtyRemaining:  0,
          unitCost:      Number(lot.unitCost),
          totalValue:    received * Number(lot.unitCost),
          reference:     lot.referenceNumber,
          paymentMethod: null,
          branchId:      lot.branchId,
          orderId:       null,
          orderNumber:   null,
          reason:        reasonOfWriteOff(lot),
        });
      }
    }

    for (const { ev, p } of payloads) {
      if (!p) continue;
      if (opts.branchId && p['branchId'] && p['branchId'] !== opts.branchId) continue;

      // A batch of a syrup, sauce or dough that took this ingredient. The
      // batch of THIS prep being made is its lot above, so it is not repeated.
      if (p['kind'] === 'SUB_RECIPE_BATCH') {
        const stated = typeof p['madeAt'] === 'string' ? new Date(p['madeAt']) : null;
        const madeAt = stated && !Number.isNaN(stated.getTime()) ? stated : ev.createdAt;
        if (!inRange(madeAt)) continue;
        const mine = ((Array.isArray(p['consumed']) ? p['consumed'] : []) as unknown[])
          .filter((c): c is Record<string, unknown> =>
            !!c && typeof c === 'object' && (c as Record<string, unknown>)['rawMaterialId'] === rawMaterialId);
        const took = mine.reduce((s, c) => s + Number(c['quantity'] ?? 0), 0);
        if (!(took > 0)) continue;
        const statedCost = Number(mine[0]['unitCost']);
        const unitCost = Number.isFinite(statedCost) && statedCost > 0 ? statedCost : cost;
        const batches = Number(p['batches'] ?? 1);
        const station = typeof p['stationName'] === 'string' && p['stationName'] ? ` · ${p['stationName']}` : '';
        rows.push({
          id:            `prep-${ev.id}`,
          kind:          'PREP',
          occurredAt:    madeAt.toISOString(),
          quantity:      -took,
          qtyRemaining:  0,
          unitCost,
          totalValue:    -took * unitCost,
          reference:     `${String(p['rawMaterialName'] ?? 'a prep')}${batches > 1 ? ` (${batches} batches)` : ''}${station}`,
          paymentMethod: null,
          branchId:      typeof p['branchId'] === 'string' ? p['branchId'] : null,
          orderId:       null,
          orderNumber:   null,
          reason:        null,
        });
        continue;
      }

      // A physical count's correction, or the shop's opening count.
      const adjustment = p['adjustmentType'];
      if (p['rawMaterialId'] === rawMaterialId && (adjustment === 'COUNT_CORRECTION' || adjustment === 'OPENING_BALANCE')) {
        if (!inRange(ev.createdAt)) continue;
        const qty = Number(p['quantity'] ?? 0);
        if (!qty) continue;
        const statedCost = Number(p['unitCost']);
        const unitCost = Number.isFinite(statedCost) && statedCost > 0 ? statedCost : cost;
        rows.push({
          id:            `count-${ev.id}`,
          kind:          'COUNT',
          occurredAt:    ev.createdAt.toISOString(),
          quantity:      qty,
          qtyRemaining:  0,
          unitCost,
          totalValue:    qty * unitCost,
          reference:     typeof p['referenceNumber'] === 'string' ? p['referenceNumber'] : null,
          paymentMethod: null,
          branchId:      typeof p['branchId'] === 'string' ? p['branchId'] : null,
          orderId:       null,
          orderNumber:   null,
          reason:        adjustment === 'OPENING_BALANCE' ? 'Opening stock' : 'Physical count',
        });
      }
    }

    /*
      3. Sales. Orders paid in the window, each line walked through the same
      recipe walk the sale and the ready tap use (the size's recipe, the
      add-ons, oat milk netting out dairy), so a syrup used only through
      add-ons shows the drinks that used it. A line taken at the sale used
      every unit, refunded or not: a refund puts no ingredient back. A line
      that waits at a kitchen or bar screen used nothing until it was marked
      ready, and then what was left of it.
    */
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        status:    { in: ['PAID', 'COMPLETED', 'RETURNED'] },
        deletedAt: null,
        ...branch,
        ...between('paidAt'),
      },
      select: {
        id:          true,
        orderNumber: true,
        paidAt:      true,
        completedAt: true,
        branchId:    true,
        items: {
          select: {
            id:            true,
            productId:     true,
            variantId:     true,
            quantity:      true,
            refundedQty:   true,
            usageOnReady:  true,
            usagePostedAt: true,
            modifiers:     { select: { modifierOptionId: true } },
            product:       { select: { name: true } },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    });
    const lines = orders.flatMap((o) => o.items);
    const usageOf = lines.length ? await loadLineRecipes(this.prisma, tenantId, lines) : () => [];

    for (const order of orders) {
      let totalQty = 0;
      const productNames: string[] = [];
      for (const it of order.items) {
        if (stillWaiting(it)) continue;   // nothing has left the shelf for it yet
        const perUnit = usageOf(it).find((u) => u.rawMaterialId === rawMaterialId)?.perUnit ?? 0;
        if (!(perUnit > 0)) continue;
        const units = it.usageOnReady
          ? Math.max(0, Number(it.quantity) - Number(it.refundedQty))
          : Number(it.quantity);
        if (!(units > 0)) continue;
        totalQty += units * perUnit;
        if (it.product?.name) productNames.push(`${units}× ${it.product.name}`);
      }
      if (totalQty <= 0) continue;
      rows.push({
        id:            `ord-${order.id}`,
        kind:          'CONSUMPTION',
        occurredAt:    (order.paidAt ?? order.completedAt ?? new Date()).toISOString(),
        quantity:      -totalQty,
        qtyRemaining:  0,
        unitCost:      cost,
        totalValue:    -totalQty * cost,
        reference:     productNames.join(', ') || null,
        paymentMethod: null,
        branchId:      order.branchId,
        orderId:       order.id,
        orderNumber:   order.orderNumber,
        reason:        null,
      });
    }

    // Newest first, capped.
    rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    return {
      ingredient: {
        id:        rm.id,
        name:      rm.name,
        unit:      rm.unit,
        costPrice: rm.costPrice != null ? Number(rm.costPrice) : null,
      },
      movements: rows.slice(0, limit),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-ingredient FIFO lots
  // ─────────────────────────────────────────────────────────────────────────

  async getLots(tenantId: string, rawMaterialId: string, branchId?: string) {
    const rm = await this.prisma.rawMaterial.findFirst({
      where: { id: rawMaterialId, tenantId },
      select: { id: true, name: true, unit: true, costPrice: true },
    });
    if (!rm) throw new NotFoundException('Ingredient not found');

    const lots = await this.prisma.rawMaterialLot.findMany({
      // Sentinels excluded: a lot with negative qtyReceived is a write-off
      // marker, not a layer of stock that can be drained.
      where: { tenantId, rawMaterialId, qtyReceived: { gt: 0 }, ...(branchId ? { branchId } : {}) },
      orderBy: { receivedAt: 'asc' }, // FIFO order — oldest first
    });

    /*
      What is on the shelf: the stock book's figure, the same one Stock on
      hand shows, valued at today's average cost. The lots' remaining
      quantities are NOT it -- a write-off, a batch or a count moves the book
      without always draining a lot -- and adding them up put 1,969 ml on the
      page for a shelf holding 1,829 ml.
    */
    const stock = await this.prisma.rawMaterialInventory.findMany({
      where:  { tenantId, rawMaterialId, ...(branchId ? { branchId } : {}) },
      select: { quantity: true },
    });
    const onHandQty = stock.reduce((s, r) => s + Number(r.quantity), 0);
    const cost = rm.costPrice != null ? Number(rm.costPrice) : 0;

    return {
      ingredient: { id: rm.id, name: rm.name, unit: rm.unit },
      onHand: { quantity: onHandQty, value: onHandQty * cost },
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
