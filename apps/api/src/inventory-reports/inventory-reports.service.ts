import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface VarianceRow {
  rawMaterialId: string;
  name:          string;
  unit:          string;
  /**
   * The last physical count of this ingredient at this branch, and when it
   * was taken. Everything below is measured from there. Null when the
   * ingredient has never been counted -- in which case there is no variance
   * to report, and saying so is the point.
   */
  countedAt:     string | null;
  countNumber:   string | null;
  startingQty:   number | null;
  receiptsQty:   number;
  expectedConsumption: number;
  expectedEndingQty:   number | null;
  actualEndingQty:     number;
  /** Actual on hand minus what the recipes say should be there. */
  deltaQty:            number | null;
  deltaPct:            number | null;
  /** Why deltaQty is null, in words a shop owner can act on. */
  cannotTell:          string | null;
}

export interface MarginRow {
  productId:    string;
  productName:  string;
  qtySold:      number;
  revenue:      number;
  cogs:         number;
  grossMargin:  number;
  marginPct:    number | null;
}

export interface DepletionRow {
  rawMaterialId: string;
  name:          string;
  unit:          string;
  currentStock:  number;
  avgDailyConsumption: number;
  /** Predicted days until stockout; null when consumption is zero. */
  daysUntilStockout: number | null;
}

/**
 * The orders that are actually sales.
 *
 * Order.deletedAt is written by nothing in this codebase, so filtering on it
 * alone let two kinds of non-sale into every one of these reports: a receipt
 * that was rung up and voided, and a cart that was opened and abandoned.
 * Both carried their full peso value into the owner's margin, variance and
 * depletion figures.
 */
const SOLD: Prisma.OrderWhereInput = { status: { in: ['PAID', 'COMPLETED'] } };

@Injectable()
export class InventoryReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private parseRange(from?: string, to?: string): { fromD: Date; toD: Date } {
    const toD   = to   ? new Date(to)   : new Date();
    const fromD = from ? new Date(from) : new Date(toD.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      throw new BadRequestException('Invalid from/to date.');
    }
    return { fromD, toD };
  }

  /**
   * Variance: expected vs. actual raw-material qty over a window.
   *   expectedEnding = starting + receipts - BOM-driven consumption
   *   delta          = actual - expected
   */
  async variance(tenantId: string, branchId: string | undefined, from?: string, to?: string): Promise<VarianceRow[]> {
    if (!branchId) throw new BadRequestException('branchId is required.');
    const { fromD, toD } = this.parseRange(from, to);

    const materials = await this.prisma.rawMaterial.findMany({
      where:   { tenantId, isActive: true },
      select:  { id: true, name: true, unit: true },
    });
    if (!materials.length) return [];

    /*
      Variance is measured from the last time somebody physically counted.
      There is no other honest anchor: nothing records raw-material movements
      one by one, so the only quantity this app KNOWS was true is a posted
      count.

      What this used to do was infer the starting quantity from the ending
      one -- starting = ending - receipts + expected consumption -- and then
      compute expected ending = starting + receipts - expected consumption.
      Those cancel. Every row read exactly zero variance, forever, whatever
      was walking out of the stockroom, and the report's existence made it
      look as though somebody was watching. An ingredient nobody has counted
      now says so instead.
    */
    const counts = await this.prisma.cycleCountLine.findMany({
      where: {
        rawMaterialId: { in: materials.map((m) => m.id) },
        count: { tenantId, branchId, status: 'POSTED', postedAt: { not: null, lte: toD } },
      },
      select: {
        rawMaterialId: true, countedQty: true,
        count: { select: { postedAt: true, countNumber: true } },
      },
      orderBy: { count: { postedAt: 'asc' } },
    });
    // Ascending, so the last write per ingredient is the most recent count.
    const anchorByMat = new Map<string, { at: Date; qty: number; countNumber: string }>();
    for (const c of counts) {
      if (!c.count.postedAt) continue;
      anchorByMat.set(c.rawMaterialId, { at: c.count.postedAt, qty: Number(c.countedQty), countNumber: c.count.countNumber });
    }

    const currentInv = await this.prisma.rawMaterialInventory.findMany({
      where:  { tenantId, branchId, rawMaterialId: { in: materials.map((m) => m.id) } },
      select: { rawMaterialId: true, quantity: true },
    });
    const currentByMat = new Map(currentInv.map((r) => [r.rawMaterialId, Number(r.quantity)]));

    /*
      Deliveries since the count, not since the date asked for. An ingredient
      counted a week ago and one counted this morning are each measured from
      their own count, so one stale ingredient does not poison the rest.
      Ingredients with no count are read over the requested window purely so
      the receipts and consumption columns still say something useful.
    */
    const earliest = [...anchorByMat.values()].reduce(
      (min: Date, a) => (a.at < min ? a.at : min), fromD,
    );
    const lots = await this.prisma.rawMaterialLot.findMany({
      // Purchases only. A write-off's sentinel lot carries a negative
      // qtyReceived to hold its idempotency reference; netting it against
      // receipts understates what the shop actually bought in the period.
      where:  { tenantId, branchId, qtyReceived: { gt: 0 }, receivedAt: { gte: earliest, lte: toD } },
      select: { rawMaterialId: true, qtyReceived: true, receivedAt: true },
    });
    const sinceOf = (matId: string) => anchorByMat.get(matId)?.at ?? fromD;
    const receiptsByMat = new Map<string, number>();
    for (const l of lots) {
      if (l.receivedAt < sinceOf(l.rawMaterialId)) continue;
      receiptsByMat.set(l.rawMaterialId, (receiptsByMat.get(l.rawMaterialId) ?? 0) + Number(l.qtyReceived));
    }

    // Expected consumption from BOM × OrderItem.quantity over the window.
    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        order: { tenantId, branchId, deletedAt: null, ...SOLD, createdAt: { gte: earliest, lte: toD } },
      },
      select: {
        productId: true,
        quantity:  true,
        refundedQty: true,
        order: { select: { createdAt: true } },
      },
    });
    const boms = orderItems.length
      ? await this.prisma.bomItem.findMany({
          where:  { productId: { in: Array.from(new Set(orderItems.map((oi) => oi.productId))) } },
          select: { productId: true, rawMaterialId: true, quantity: true },
        })
      : [];
    const bomsByProduct = new Map<string, Array<{ rawMaterialId: string; quantity: number }>>();
    for (const b of boms) {
      const list = bomsByProduct.get(b.productId) ?? [];
      list.push({ rawMaterialId: b.rawMaterialId, quantity: Number(b.quantity) });
      bomsByProduct.set(b.productId, list);
    }
    /*
      Counted per ingredient, because each ingredient's window starts at its
      own count. Refunded units are taken off: a drink handed back was still
      poured, but a line refunded before it was made never drained anything,
      and the margin report already nets the same way.
    */
    const consumptionByMat = new Map<string, number>();
    for (const oi of orderItems) {
      const sold = Number(oi.quantity) - Number(oi.refundedQty ?? 0);
      if (sold <= 0) continue;
      for (const b of bomsByProduct.get(oi.productId) ?? []) {
        if (oi.order.createdAt < sinceOf(b.rawMaterialId)) continue;
        consumptionByMat.set(b.rawMaterialId, (consumptionByMat.get(b.rawMaterialId) ?? 0) + sold * b.quantity);
      }
    }

    const round = (n: number) => Math.round(n * 1000) / 1000;
    return materials.map((m) => {
      const anchor          = anchorByMat.get(m.id) ?? null;
      const receipts        = receiptsByMat.get(m.id) ?? 0;
      const expectedConsume = consumptionByMat.get(m.id) ?? 0;
      const actualEnd       = currentByMat.get(m.id) ?? 0;
      if (!anchor) {
        return {
          rawMaterialId: m.id, name: m.name, unit: m.unit,
          countedAt: null, countNumber: null,
          startingQty: null,
          receiptsQty: round(receipts),
          expectedConsumption: round(expectedConsume),
          expectedEndingQty: null,
          actualEndingQty: round(actualEnd),
          deltaQty: null,
          deltaPct: null,
          cannotTell: 'Never counted. Count this ingredient once and every count after it shows what went missing in between.',
        };
      }
      const expectedEndingQty = anchor.qty + receipts - expectedConsume;
      const deltaQty          = actualEnd - expectedEndingQty;
      const deltaPct          = expectedEndingQty !== 0 ? (deltaQty / expectedEndingQty) * 100 : null;
      return {
        rawMaterialId:       m.id,
        name:                m.name,
        unit:                m.unit,
        countedAt:           anchor.at.toISOString(),
        countNumber:         anchor.countNumber,
        startingQty:         round(anchor.qty),
        receiptsQty:         round(receipts),
        expectedConsumption: round(expectedConsume),
        expectedEndingQty:   round(expectedEndingQty),
        actualEndingQty:     round(actualEnd),
        deltaQty:            round(deltaQty),
        deltaPct:            deltaPct == null ? null : Math.round(deltaPct * 100) / 100,
        cannotTell:          null,
      };
    });
  }

  /**
   * Per-product margin: revenue (sum of lineTotal) vs COGS (sum of qty × costPrice)
   * over the window. Pulls COGS from OrderItem.costPrice (frozen at sale time);
   * falls back to 0 when absent.
   */
  async margin(tenantId: string, from?: string, to?: string): Promise<MarginRow[]> {
    const { fromD, toD } = this.parseRange(from, to);
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: { tenantId, deletedAt: null, ...SOLD, createdAt: { gte: fromD, lte: toD } },
      },
      select: {
        productId:   true,
        productName: true,
        quantity:    true,
        lineTotal:   true,
        costPrice:   true,
        refundedQty: true,
      },
    });

    const agg = new Map<string, MarginRow>();
    for (const it of items) {
      const qtyNet = Number(it.quantity) - Number(it.refundedQty);
      if (qtyNet <= 0) continue;
      const revenue = Number(it.lineTotal) * (qtyNet / Number(it.quantity || 1));
      const cogs    = Number(it.costPrice ?? 0) * qtyNet;
      const existing = agg.get(it.productId) ?? {
        productId:   it.productId,
        productName: it.productName,
        qtySold:     0,
        revenue:     0,
        cogs:        0,
        grossMargin: 0,
        marginPct:   null,
      };
      existing.qtySold     += qtyNet;
      existing.revenue     += revenue;
      existing.cogs        += cogs;
      existing.grossMargin  = existing.revenue - existing.cogs;
      existing.marginPct    = existing.revenue !== 0 ? (existing.grossMargin / existing.revenue) * 100 : null;
      agg.set(it.productId, existing);
    }
    return Array.from(agg.values()).sort((a, b) => b.revenue - a.revenue);
  }

  /**
   * Depletion forecast: avg daily raw-material consumption over the last 30
   * days (from BOM × OrderItem) divided into current stock. Only includes
   * materials with `lotsTracked=true`.
   */
  async depletionForecast(tenantId: string, branchId: string | undefined): Promise<DepletionRow[]> {
    if (!branchId) throw new BadRequestException('branchId is required.');
    const now   = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const days  = 30;

    const materials = await this.prisma.rawMaterial.findMany({
      where:   { tenantId, isActive: true, lotsTracked: true },
      select:  { id: true, name: true, unit: true },
    });
    if (!materials.length) return [];

    const inv = await this.prisma.rawMaterialInventory.findMany({
      where:  { tenantId, branchId, rawMaterialId: { in: materials.map((m) => m.id) } },
      select: { rawMaterialId: true, quantity: true },
    });
    const stockByMat = new Map(inv.map((r) => [r.rawMaterialId, Number(r.quantity)]));

    const items = await this.prisma.orderItem.findMany({
      where: {
        order: { tenantId, branchId, deletedAt: null, ...SOLD, createdAt: { gte: since, lte: now } },
      },
      select: { productId: true, quantity: true },
    });
    const productQty = new Map<string, number>();
    for (const it of items) {
      productQty.set(it.productId, (productQty.get(it.productId) ?? 0) + Number(it.quantity));
    }
    const boms = productQty.size
      ? await this.prisma.bomItem.findMany({
          where:  { productId: { in: Array.from(productQty.keys()), }, rawMaterialId: { in: materials.map((m) => m.id) } },
          select: { productId: true, rawMaterialId: true, quantity: true },
        })
      : [];
    const consumeByMat = new Map<string, number>();
    for (const b of boms) {
      const consumed = (productQty.get(b.productId) ?? 0) * Number(b.quantity);
      consumeByMat.set(b.rawMaterialId, (consumeByMat.get(b.rawMaterialId) ?? 0) + consumed);
    }

    return materials.map((m) => {
      const total = consumeByMat.get(m.id) ?? 0;
      const avg   = total / days;
      const stock = stockByMat.get(m.id) ?? 0;
      return {
        rawMaterialId:       m.id,
        name:                m.name,
        unit:                m.unit,
        currentStock:        stock,
        avgDailyConsumption: avg,
        daysUntilStockout:   avg > 0 ? stock / avg : null,
      };
    }).sort((a, b) => {
      // Soonest stockouts first; nulls (no consumption) at the bottom.
      if (a.daysUntilStockout == null) return 1;
      if (b.daysUntilStockout == null) return -1;
      return a.daysUntilStockout - b.daysUntilStockout;
    });
  }
}

// Suppress unused-import lint when Prisma isn't directly used in this file's
// runtime path (kept for IDE auto-import + future filter helpers).
void Prisma;
