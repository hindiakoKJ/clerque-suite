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

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        completedAt: { gte: startOfDay, lte: endOfDay },
      },
      include: { payments: true, items: true },
    });

    const summary = this.computeSummary(orders);
    return { date, branchId, ...summary };
  }

  // ─── Shift report ──────────────────────────────────────────────────────────

  async getShiftReport(tenantId: string, shiftId: string): Promise<ShiftReport> {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId },
    });
    if (!shift) throw new NotFoundException('Shift not found');

    const [orders, cashOuts] = await Promise.all([
      this.prisma.order.findMany({
        where: { shiftId, tenantId },
        include: { payments: true, items: true },
      }),
      this.prisma.shiftCashOut.findMany({
        where:   { shiftId, tenantId },
        orderBy: { createdAt: 'asc' },
        select:  { id: true, type: true, amount: true, reason: true, category: true, createdAt: true },
      }),
    ]);

    const summary = this.computeSummary(orders);
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

  private computeSummary(orders: Awaited<ReturnType<typeof this.getOrders>>): SalesSummary {
    const completed = orders.filter((o) => o.status === 'COMPLETED');
    const voided = orders.filter((o) => o.status === 'VOIDED');

    const totalRevenue = completed.reduce((s, o) => s + Number(o.totalAmount), 0);
    const totalOrders = completed.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

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
      where: { tenantId, branchId, completedAt: { gte: startOfDay, lte: endOfDay } },
      include: { payments: true, items: true },
    });

    const completed   = orders.filter((o) => o.status === 'COMPLETED');
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
}
