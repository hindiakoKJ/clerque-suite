import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

    const orders = await this.prisma.order.findMany({
      where: { shiftId, tenantId },
      include: { payments: true, items: true },
    });

    const summary = this.computeSummary(orders);
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

  // Helper to satisfy TypeScript for the return type reference
  private getOrders(tenantId: string) {
    return this.prisma.order.findMany({
      where: { tenantId },
      include: { payments: true, items: true },
    });
  }
}
