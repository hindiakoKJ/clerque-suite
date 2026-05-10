import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface PaymentBreakdown {
  method: string;
  totalAmount: number;
  orderCount: number;
}

export interface TopProduct {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

export interface HourlyBreakdown {
  hour: number;
  orderCount: number;
  revenue: number;
}

export interface SalesSummary {
  totalOrders: number;
  voidCount: number;
  totalRevenue: number;
  avgOrderValue: number;
  cashRevenue: number;
  nonCashRevenue: number;
  byPaymentMethod: PaymentBreakdown[];
  topProducts: TopProduct[];
  byHour: HourlyBreakdown[];
  /** Sum of (qty × costPrice) for all sold items that had a costPrice set. */
  totalCogs: number;
  /** Net of VAT, then minus COGS. The "true profit" number. */
  grossProfit: number;
  /** grossProfit / netRevenue, as a 0-1 fraction. 0 if revenue=0. */
  grossMargin: number;
  /**
   * Items sold without a costPrice on the snapshot. Their revenue is
   * counted but COGS is not — meaning grossProfit is overstated. The UI
   * should warn whenever this is > 0.
   */
  itemsMissingCost: { lineCount: number; revenueLeak: number };
}

export interface DailyReport extends SalesSummary {
  date: string;
  branchId: string;
}

export interface ShiftReport extends SalesSummary {
  shift: {
    id: string;
    openedAt: Date;
    closedAt: Date | null;
    openingCash: number;
    closingCashDeclared: number | null;
    closingCashExpected: number | null;
    variance: number | null;
    notes: string | null;
    /** Sprint 3 — terminal this shift opened on (POS-01, POS-02, ...). */
    terminal: { id: string; name: string; code: string } | null;
  };
  /** Cash leaving the till during the shift (paid-outs + drops). */
  cashOuts: Array<{
    id:        string;
    type:      'PAID_OUT' | 'CASH_DROP';
    amount:    number;
    reason:    string;
    category:  string | null;
    createdAt: string;
  }>;
  paidOutTotal:  number;
  cashDropTotal: number;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ─── Daily report ─────────────────────────────────────────────────────────

  async getDaily(tenantId: string, branchId: string, date: string): Promise<DailyReport> {
    // PH timezone UTC+8 — interpret the date string as PH local midnight
    const startOfDay = new Date(`${date}T00:00:00+08:00`);
    const endOfDay = new Date(`${date}T23:59:59.999+08:00`);

    // Sprint 7: Revenue is recognized at PAID time (PFRS § 9 — control
    // transferred at point-of-sale), not at production-complete time.
    // Filtering by paidAt captures both PAID-and-still-in-production and
    // fully-COMPLETED orders for the day. Backfilled paidAt = completedAt
    // on legacy rows means this is backwards-compatible.
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        paidAt: { gte: startOfDay, lte: endOfDay },
        status: { in: ['PAID', 'COMPLETED'] },
      },
      include: { payments: true, items: true },
    });

    // Sprint 9: SERVICE businesses sell appointments / labor — products
    // intentionally have no costPrice. The "missing cost" warning that
    // counts these as revenue leaks is wrong for them. Pass the tenant's
    // businessType into the summary computation so SERVICE tenants get
    // a clean dashboard.
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { businessType: true },
    });
    const summary = this.computeSummary(orders, tenant?.businessType ?? null);
    return { date, branchId, ...summary };
  }

  // ─── Shift report ──────────────────────────────────────────────────────────

  async getShiftReport(tenantId: string, shiftId: string): Promise<ShiftReport> {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId },
      // Sprint 3 — include the terminal so the EOD report can show which
      // POS the shift opened on. Falls back to legacy "POS-XXXX" label
      // when terminalId is null (shifts opened before multi-terminal).
      include: { terminal: { select: { id: true, name: true, code: true } } },
    });
    if (!shift) throw new NotFoundException('Shift not found');

    const [orders, cashOuts, tenantInfo] = await Promise.all([
      this.prisma.order.findMany({
        where: { shiftId, tenantId },
        include: { payments: true, items: true },
      }),
      this.prisma.shiftCashOut.findMany({
        where:   { shiftId, tenantId },
        orderBy: { createdAt: 'asc' },
        select:  { id: true, type: true, amount: true, reason: true, category: true, createdAt: true },
      }),
      this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { businessType: true },
      }),
    ]);

    const summary = this.computeSummary(orders, tenantInfo?.businessType ?? null);
    let paidOutTotal  = 0;
    let cashDropTotal = 0;
    for (const c of cashOuts) {
      const amt = Number(c.amount);
      if (c.type === 'PAID_OUT')  paidOutTotal  += amt;
      if (c.type === 'CASH_DROP') cashDropTotal += amt;
    }
    return {
      ...summary,
      shift: {
        id: shift.id,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        openingCash: Number(shift.openingCash),
        closingCashDeclared: shift.closingCashDeclared ? Number(shift.closingCashDeclared) : null,
        closingCashExpected: shift.closingCashExpected ? Number(shift.closingCashExpected) : null,
        variance: shift.variance ? Number(shift.variance) : null,
        notes: shift.notes,
        terminal: shift.terminal
          ? { id: shift.terminal.id, name: shift.terminal.name, code: shift.terminal.code }
          : null,
      },
      cashOuts: cashOuts.map((c) => ({
        id:        c.id,
        type:      c.type,
        amount:    Number(c.amount),
        reason:    c.reason,
        category:  c.category,
        createdAt: c.createdAt.toISOString(),
      })),
      paidOutTotal,
      cashDropTotal,
    };
  }

  // ─── Private aggregation ──────────────────────────────────────────────────

  private computeSummary(
    orders: Awaited<ReturnType<typeof this.getOrders>>,
    businessType?: string | null,
  ): SalesSummary {
    // Sprint 7: PAID and COMPLETED both count as "completed sales" — revenue
    // is recognized at sale time per PFRS § 9.
    const completed = orders.filter((o) => o.status === 'COMPLETED' || o.status === 'PAID');
    const voided = orders.filter((o) => o.status === 'VOIDED');

    const totalRevenue = completed.reduce((s, o) => s + Number(o.totalAmount), 0);
    const totalOrders = completed.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Sprint 9: SERVICE businesses don't have COGS by design — appointments,
    // haircuts, laundry. costPrice = null is intentional, not a leak.
    // Skip the missing-cost warning for these tenants entirely.
    const isServiceBusiness = businessType === 'SERVICE';

    // ── COGS / Gross Profit ─────────────────────────────────────────────────
    // Walk every sold line. If costPrice is present, add (qty × cost) to COGS.
    // If costPrice is NULL on a sold line, count it as a "leak" — its revenue
    // shows up in grossProfit without an offsetting cost, overstating margin.
    // (Skipped for SERVICE businesses where null is the expected state.)
    let totalCogs = 0;
    let netRevenue = 0;
    let leakLines = 0;
    let leakRevenue = 0;
    for (const order of completed) {
      const orderVat = Number(order.vatAmount ?? 0);
      const orderTotal = Number(order.totalAmount);
      // Pro-rate the order's net (ex-VAT) total across line items by lineTotal share
      const orderLineSum = order.items.reduce((s, i) => s + Number(i.lineTotal), 0) || 1;
      for (const item of order.items) {
        const lineRevGross = Number(item.lineTotal);
        // Net-of-VAT share for this line (only meaningful if order had VAT)
        const lineNet = orderTotal > 0
          ? lineRevGross - (orderVat * (lineRevGross / orderLineSum))
          : lineRevGross;
        netRevenue += lineNet;
        if (item.costPrice != null) {
          totalCogs += Number(item.quantity) * Number(item.costPrice);
        } else if (!isServiceBusiness) {
          leakLines  += 1;
          leakRevenue += lineRevGross;
        }
        // For SERVICE: null costPrice is fine, no leak counted.
      }
    }
    const grossProfit = netRevenue - totalCogs;
    const grossMargin = netRevenue > 0 ? grossProfit / netRevenue : 0;

    // Payment method breakdown
    const methodMap = new Map<string, { totalAmount: number; orderCount: number }>();
    for (const order of completed) {
      for (const p of order.payments) {
        const key = p.method;
        const existing = methodMap.get(key) ?? { totalAmount: 0, orderCount: 0 };
        methodMap.set(key, {
          totalAmount: existing.totalAmount + Number(p.amount),
          orderCount: existing.orderCount + 1,
        });
      }
    }
    const byPaymentMethod: PaymentBreakdown[] = Array.from(methodMap.entries()).map(
      ([method, v]) => ({ method, ...v }),
    );

    const cashRevenue = byPaymentMethod
      .filter((p) => p.method === 'CASH')
      .reduce((s, p) => s + p.totalAmount, 0);
    const nonCashRevenue = byPaymentMethod
      .filter((p) => p.method !== 'CASH')
      .reduce((s, p) => s + p.totalAmount, 0);

    // Top products
    const productMap = new Map<string, { productName: string; quantitySold: number; revenue: number }>();
    for (const order of completed) {
      for (const item of order.items) {
        const existing = productMap.get(item.productId) ?? {
          productName: item.productName,
          quantitySold: 0,
          revenue: 0,
        };
        productMap.set(item.productId, {
          productName: item.productName,
          quantitySold: existing.quantitySold + Number(item.quantity),
          revenue: existing.revenue + Number(item.lineTotal),
        });
      }
    }
    const topProducts: TopProduct[] = Array.from(productMap.entries())
      .map(([productId, v]) => ({ productId, ...v }))
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 10);

    // Hourly breakdown (PH time UTC+8)
    const hourMap = new Map<number, { orderCount: number; revenue: number }>();
    for (const order of completed) {
      if (!order.completedAt) continue;
      // Convert to PH local hour
      const phHour = (order.completedAt.getUTCHours() + 8) % 24;
      const existing = hourMap.get(phHour) ?? { orderCount: 0, revenue: 0 };
      hourMap.set(phHour, {
        orderCount: existing.orderCount + 1,
        revenue: existing.revenue + Number(order.totalAmount),
      });
    }
    const byHour: HourlyBreakdown[] = Array.from(hourMap.entries())
      .map(([hour, v]) => ({ hour, ...v }))
      .sort((a, b) => a.hour - b.hour);

    return {
      totalOrders,
      voidCount: voided.length,
      totalRevenue,
      avgOrderValue,
      cashRevenue,
      nonCashRevenue,
      byPaymentMethod,
      topProducts,
      byHour,
      totalCogs,
      grossProfit,
      grossMargin,
      itemsMissingCost: { lineCount: leakLines, revenueLeak: leakRevenue },
    };
  }

  // ─── Z-Read: daily tamper-proof totals (BIR CAS accreditation) ──────────────
  //
  // One Z-Read record per branch per calendar date (PH UTC+8).
  // INSERT-only — the unique constraint on (branchId, date) enforces idempotency.
  // Calling this a second time for the same day returns the existing record.

  async generateZRead(
    tenantId:     string,
    branchId:     string,
    dateStr:      string,   // YYYY-MM-DD in PH time
    generatedById?: string,
  ) {
    // Build the date in UTC+8 (PH local midnight)
    const startOfDay = new Date(`${dateStr}T00:00:00+08:00`);
    const endOfDay   = new Date(`${dateStr}T23:59:59.999+08:00`);

    // Idempotency: return existing record if already generated
    const existing = await this.prisma.zReadLog.findUnique({
      where: { branchId_date: { branchId, date: startOfDay } },
    });
    if (existing) return existing;

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        paidAt: { gte: startOfDay, lte: endOfDay },
        status: { in: ['PAID', 'COMPLETED', 'VOIDED'] },
      },
      include: { payments: true, items: true },
    });

    // Sprint 7: PAID-and-COMPLETED both count as "completed sales" for
    // Z-Read purposes — the customer has paid and revenue is recognized.
    const completed   = orders.filter((o) => o.status === 'COMPLETED' || o.status === 'PAID');
    const voided      = orders.filter((o) => o.status === 'VOIDED');
    const grossSales  = completed.reduce((s, o) => s + Number(o.subtotal),     0);
    const netSales    = completed.reduce((s, o) => s + Number(o.totalAmount),  0);
    const vatAmount   = completed.reduce((s, o) => s + Number(o.vatAmount),    0);
    const discountAmt = completed.reduce((s, o) => s + Number(o.discountAmount), 0);

    let cashAmount = 0, nonCashAmount = 0;
    for (const order of completed) {
      for (const p of order.payments) {
        if (p.method === 'CASH') cashAmount    += Number(p.amount);
        else                     nonCashAmount += Number(p.amount);
      }
    }

    return this.prisma.zReadLog.create({
      data: {
        tenantId,
        branchId,
        date:          startOfDay,
        totalOrders:   completed.length,
        voidCount:     voided.length,
        grossSales:    new Prisma.Decimal(grossSales),
        netSales:      new Prisma.Decimal(netSales),
        vatAmount:     new Prisma.Decimal(vatAmount),
        discountAmount: new Prisma.Decimal(discountAmt),
        cashAmount:    new Prisma.Decimal(cashAmount),
        nonCashAmount: new Prisma.Decimal(nonCashAmount),
        generatedById,
      },
    });
  }

  async listZReadLogs(tenantId: string, branchId?: string, limit = 30) {
    return this.prisma.zReadLog.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      orderBy: { date: 'desc' },
      take: limit,
    });
  }

  // ─── X-Read: shift-level tamper-proof totals ──────────────────────────────────
  //
  // One X-Read record per shift. Created at shift close.
  // The unique constraint on shiftId prevents double-generation.

  async generateXRead(tenantId: string, shiftId: string, generatedById?: string) {
    // Idempotency
    const existing = await this.prisma.xReadLog.findUnique({ where: { shiftId } });
    if (existing) return existing;

    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (!shift.closedAt) throw new ConflictException('Cannot generate X-Read for an open shift.');

    const orders = await this.prisma.order.findMany({
      where: { shiftId, tenantId },
      include: { payments: true, items: true },
    });

    const completed   = orders.filter((o) => o.status === 'COMPLETED');
    const voided      = orders.filter((o) => o.status === 'VOIDED');
    const grossSales  = completed.reduce((s, o) => s + Number(o.subtotal),       0);
    const netSales    = completed.reduce((s, o) => s + Number(o.totalAmount),    0);
    const vatAmount   = completed.reduce((s, o) => s + Number(o.vatAmount),      0);
    const discountAmt = completed.reduce((s, o) => s + Number(o.discountAmount), 0);

    let cashAmount = 0, nonCashAmount = 0;
    for (const order of completed) {
      for (const p of order.payments) {
        if (p.method === 'CASH') cashAmount    += Number(p.amount);
        else                     nonCashAmount += Number(p.amount);
      }
    }

    const openingCash  = Number(shift.openingCash);
    const closingCash  = shift.closingCashDeclared ? Number(shift.closingCashDeclared) : 0;
    const cashVariance = shift.variance ? Number(shift.variance) : 0;

    return this.prisma.xReadLog.create({
      data: {
        tenantId,
        branchId:      shift.branchId,
        shiftId,
        openedAt:      shift.openedAt,
        closedAt:      shift.closedAt,
        totalOrders:   completed.length,
        voidCount:     voided.length,
        grossSales:    new Prisma.Decimal(grossSales),
        netSales:      new Prisma.Decimal(netSales),
        vatAmount:     new Prisma.Decimal(vatAmount),
        discountAmount: new Prisma.Decimal(discountAmt),
        cashAmount:    new Prisma.Decimal(cashAmount),
        nonCashAmount: new Prisma.Decimal(nonCashAmount),
        openingCash:   new Prisma.Decimal(openingCash),
        closingCash:   new Prisma.Decimal(closingCash),
        cashVariance:  new Prisma.Decimal(cashVariance),
        generatedById,
      },
    });
  }

  // Helper to satisfy TypeScript for the return type reference
  private getOrders(tenantId: string) {
    return this.prisma.order.findMany({
      where: { tenantId },
      include: { payments: true, items: true },
    });
  }

  /**
   * Sprint 19 — Sales report over an arbitrary date range. Powers the new
   * /pos/reports/sales owner-only page. Returns:
   *   - Per-day buckets (date, totalRevenue, orderCount, voidCount)
   *   - Totals across the range (revenue, orders, AOV, voidCount, totalCogs,
   *     grossProfit)
   *   - Top 20 products across the range (qty, revenue, lineCount)
   *   - Per-payment-method totals
   *
   * All time bucketing in PH local time (UTC+8). Date strings are inclusive
   * "YYYY-MM-DD" boundaries. Voided orders excluded from revenue but
   * counted under voidCount for visibility.
   */
  async getSalesRange(
    tenantId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string,
  ) {
    const start = new Date(`${fromDate}T00:00:00+08:00`);
    const end   = new Date(`${toDate}T23:59:59.999+08:00`);

    const where = {
      tenantId,
      ...(branchId ? { branchId } : {}),
      paidAt: { gte: start, lte: end },
    };

    const orders = await this.prisma.order.findMany({
      where,
      include: { items: true, payments: true },
      orderBy: { paidAt: 'asc' },
    });

    // Per-day buckets — group by PH-local YYYY-MM-DD.
    const buckets = new Map<string, {
      date:         string;
      orderCount:   number;
      voidCount:    number;
      totalRevenue: number;
      totalCogs:    number;
    }>();
    const isoDay = (d: Date) => {
      // PH = UTC+8; shift before slicing so day boundaries align.
      const ph = new Date(d.getTime() + 8 * 60 * 60_000);
      return ph.toISOString().slice(0, 10);
    };

    let totalRevenue = 0;
    let totalCogs    = 0;
    let totalOrders  = 0;
    let voidCount    = 0;
    const byPayment      = new Map<string, { method: string; total: number; count: number }>();
    const byProduct      = new Map<string, { productName: string; qty: number; revenue: number; lineCount: number }>();

    for (const o of orders) {
      const day = isoDay(new Date(o.paidAt ?? o.createdAt));
      let bucket = buckets.get(day);
      if (!bucket) {
        bucket = { date: day, orderCount: 0, voidCount: 0, totalRevenue: 0, totalCogs: 0 };
        buckets.set(day, bucket);
      }

      if (o.status === 'VOIDED') {
        voidCount++;
        bucket.voidCount++;
        continue;
      }

      const orderTotal = Number(o.totalAmount);
      const orderCogs  = o.items.reduce((s, it) => s + Number(it.costPrice ?? 0) * Number(it.quantity), 0);
      totalRevenue += orderTotal;
      totalCogs    += orderCogs;
      totalOrders  += 1;
      bucket.totalRevenue += orderTotal;
      bucket.totalCogs    += orderCogs;
      bucket.orderCount   += 1;

      // Payment breakdown
      for (const p of o.payments) {
        const cur = byPayment.get(p.method) ?? { method: p.method, total: 0, count: 0 };
        cur.total += Number(p.amount);
        cur.count++;
        byPayment.set(p.method, cur);
      }

      // Product breakdown
      for (const it of o.items) {
        const key = it.productId;
        const cur = byProduct.get(key) ?? { productName: it.productName, qty: 0, revenue: 0, lineCount: 0 };
        cur.qty       += Number(it.quantity);
        cur.revenue   += Number(it.lineTotal);
        cur.lineCount += 1;
        byProduct.set(key, cur);
      }
    }

    const grossProfit = totalRevenue - totalCogs;
    const grossMargin = totalRevenue > 0 ? grossProfit / totalRevenue : 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return {
      from: fromDate,
      to:   toDate,
      branchId: branchId ?? null,
      totals: {
        totalRevenue:  Math.round(totalRevenue * 100) / 100,
        totalCogs:     Math.round(totalCogs * 100) / 100,
        grossProfit:   Math.round(grossProfit * 100) / 100,
        grossMargin:   Math.round(grossMargin * 10000) / 10000,
        totalOrders,
        voidCount,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      },
      byDay: Array.from(buckets.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((b) => ({
          ...b,
          totalRevenue: Math.round(b.totalRevenue * 100) / 100,
          totalCogs:    Math.round(b.totalCogs * 100) / 100,
          grossProfit:  Math.round((b.totalRevenue - b.totalCogs) * 100) / 100,
        })),
      byPaymentMethod: Array.from(byPayment.values())
        .sort((a, b) => b.total - a.total)
        .map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 })),
      topProducts: Array.from(byProduct.entries())
        .map(([productId, v]) => ({
          productId, ...v,
          revenue: Math.round(v.revenue * 100) / 100,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 20),
    };
  }

  // ─── Unified all-branch report (Sprint 19, owner-only) ───────────────────
  // Rolls sales / AP / AR / inventory value into a per-branch breakdown so
  // the owner of a multi-branch tenant sees the whole business in one view
  // without bouncing between branch filters. Date range applies to sales
  // and to AP/AR document creation; inventory value is point-in-time as of
  // the call.

  async getUnifiedReport(tenantId: string, fromDate: string, toDate: string) {
    const start = new Date(`${fromDate}T00:00:00+08:00`);
    const end   = new Date(`${toDate}T23:59:59.999+08:00`);

    const [branches, orders, apBills, arInvoices, inventoryRows] = await Promise.all([
      this.prisma.branch.findMany({
        where:   { tenantId, isActive: true },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true },
      }),
      this.prisma.order.findMany({
        where: { tenantId, paidAt: { gte: start, lte: end } },
        select: {
          id: true, branchId: true, status: true,
          totalAmount: true, paidAt: true,
          items: { select: { quantity: true, costPrice: true } },
        },
      }),
      this.prisma.aPBill.findMany({
        where: {
          tenantId,
          createdAt: { gte: start, lte: end },
          status: { not: 'VOID' as any },
        },
        select: { branchId: true, totalAmount: true, balanceAmount: true },
      }),
      this.prisma.aRInvoice.findMany({
        where: {
          tenantId,
          invoiceDate: { gte: start, lte: end },
          status: { not: 'VOID' as any },
        },
        select: { branchId: true, totalAmount: true, balanceAmount: true },
      }).catch(() => []), // ARInvoice may not exist in all schemas
      this.prisma.inventoryItem.findMany({
        where: { tenantId, quantity: { gt: 0 } },
        select: { branchId: true, quantity: true, avgCost: true, product: { select: { costPrice: true } } },
      }),
    ]);

    // Per-branch buckets
    interface Bucket {
      branchId:        string;
      branchName:      string;
      revenue:         number;
      cogs:            number;
      grossProfit:     number;
      orderCount:      number;
      voidCount:       number;
      avgOrderValue:   number;
      apBilled:        number;
      apOutstanding:   number;
      arInvoiced:      number;
      arOutstanding:   number;
      inventoryValue:  number;
    }
    const initBucket = (b: { id: string; name: string }): Bucket => ({
      branchId:       b.id,
      branchName:     b.name,
      revenue:        0,
      cogs:           0,
      grossProfit:    0,
      orderCount:     0,
      voidCount:      0,
      avgOrderValue:  0,
      apBilled:       0,
      apOutstanding:  0,
      arInvoiced:     0,
      arOutstanding:  0,
      inventoryValue: 0,
    });
    const map = new Map<string, Bucket>(branches.map((b) => [b.id, initBucket(b)]));

    // Sales
    for (const o of orders) {
      const bucket = map.get(o.branchId);
      if (!bucket) continue;
      if (o.status === 'VOIDED') {
        bucket.voidCount++;
        continue;
      }
      const total = Number(o.totalAmount);
      const cogs  = o.items.reduce((s, it) => s + Number(it.costPrice ?? 0) * Number(it.quantity), 0);
      bucket.revenue   += total;
      bucket.cogs      += cogs;
      bucket.orderCount++;
    }
    // AP (branchId may be null → assign to a synthetic "shared" pool)
    const sharedBucket: Bucket = {
      branchId: '_shared', branchName: 'Shared / no branch',
      revenue: 0, cogs: 0, grossProfit: 0,
      orderCount: 0, voidCount: 0, avgOrderValue: 0,
      apBilled: 0, apOutstanding: 0, arInvoiced: 0, arOutstanding: 0,
      inventoryValue: 0,
    };
    for (const b of apBills) {
      const bucket = b.branchId ? (map.get(b.branchId) ?? sharedBucket) : sharedBucket;
      bucket.apBilled      += Number(b.totalAmount);
      bucket.apOutstanding += Number(b.balanceAmount);
    }
    for (const inv of arInvoices as any[]) {
      const bucket = inv.branchId ? (map.get(inv.branchId) ?? sharedBucket) : sharedBucket;
      bucket.arInvoiced    += Number(inv.totalAmount);
      bucket.arOutstanding += Number(inv.balanceAmount);
    }
    // Inventory value (qty × avgCost, falling back to product.costPrice)
    for (const row of inventoryRows) {
      const bucket = map.get(row.branchId);
      if (!bucket) continue;
      const qty  = Number(row.quantity);
      const cost = row.avgCost != null
        ? Number(row.avgCost)
        : Number(row.product.costPrice ?? 0);
      bucket.inventoryValue += qty * cost;
    }
    // Derived metrics
    for (const b of map.values()) {
      b.grossProfit   = b.revenue - b.cogs;
      b.avgOrderValue = b.orderCount > 0 ? b.revenue / b.orderCount : 0;
    }

    // Round to 2 decimals everywhere for the wire response
    const round = (n: number) => Math.round(n * 100) / 100;
    const finalize = (b: Bucket) => ({
      ...b,
      revenue:        round(b.revenue),
      cogs:           round(b.cogs),
      grossProfit:    round(b.grossProfit),
      avgOrderValue:  round(b.avgOrderValue),
      apBilled:       round(b.apBilled),
      apOutstanding:  round(b.apOutstanding),
      arInvoiced:     round(b.arInvoiced),
      arOutstanding:  round(b.arOutstanding),
      inventoryValue: round(b.inventoryValue),
    });

    const branchRows = Array.from(map.values()).map(finalize);
    const sharedRow  = (sharedBucket.apBilled || sharedBucket.arInvoiced)
      ? [finalize(sharedBucket)]
      : [];

    // Tenant-wide totals
    const totals = branchRows.reduce(
      (acc, b) => ({
        revenue:        acc.revenue + b.revenue,
        cogs:           acc.cogs + b.cogs,
        grossProfit:    acc.grossProfit + b.grossProfit,
        orderCount:     acc.orderCount + b.orderCount,
        voidCount:      acc.voidCount + b.voidCount,
        apBilled:       acc.apBilled + b.apBilled,
        apOutstanding:  acc.apOutstanding + b.apOutstanding + (sharedRow[0]?.apOutstanding ?? 0),
        arInvoiced:     acc.arInvoiced + b.arInvoiced,
        arOutstanding:  acc.arOutstanding + b.arOutstanding + (sharedRow[0]?.arOutstanding ?? 0),
        inventoryValue: acc.inventoryValue + b.inventoryValue,
      }),
      {
        revenue: 0, cogs: 0, grossProfit: 0, orderCount: 0, voidCount: 0,
        apBilled: 0, apOutstanding: 0, arInvoiced: 0, arOutstanding: 0, inventoryValue: 0,
      },
    );
    const grossMargin = totals.revenue > 0 ? totals.grossProfit / totals.revenue : 0;

    return {
      from: fromDate,
      to:   toDate,
      branches: branchRows,
      shared:   sharedRow,
      totals: {
        ...totals,
        grossMargin: Math.round(grossMargin * 10000) / 10000,
      },
    };
  }
}
