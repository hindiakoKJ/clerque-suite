/**
 * Sprint 25 — Advanced reports (Solo Pro feature `advancedReports`).
 *
 *  - Sales heatmap: per-hour x per-weekday order count + revenue for the
 *    past 90 days. Useful for staffing / promo planning.
 *  - Customer cohorts: month-of-first-order → retention in subsequent
 *    months, for the past 12 months.
 *  - Attach rate: top product pairs that frequently appear together in
 *    the same order (basket-analysis lite).
 *
 * All queries are tenant-scoped and exclude voided/soft-deleted orders.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HeatmapCell {
  weekday:    number;   // 0 = Sunday … 6 = Saturday
  hour:       number;   // 0–23
  orderCount: number;
  revenue:    number;
}

export interface CohortRow {
  cohortMonth: string;             // "YYYY-MM" of first order
  cohortSize:  number;             // first-time customers in that month
  retention:   Array<{ monthIndex: number; returned: number }>; // 0 = same month
}

export interface AttachRateRow {
  productAId:   string;
  productAName: string;
  productBId:   string;
  productBName: string;
  coOccurrence: number;
}

@Injectable()
export class ReportsAdvancedService {
  constructor(private prisma: PrismaService) {}

  /**
   * Sales heatmap — past 90 days, grouped by weekday × hour of day.
   * Returns a flat list of cells (only non-zero buckets included to keep
   * payloads small; the UI fills in zeros for missing cells).
   */
  async salesHeatmap(tenantId: string): Promise<HeatmapCell[]> {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    since.setHours(0, 0, 0, 0);

    // Pull only the columns we need. 90 days at a busy branch ≈ 45k rows —
    // streamed once, aggregated in JS. Avoids reaching for raw SQL across DB
    // engines and keeps the query stable across Prisma versions.
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status:    { in: ['PAID', 'COMPLETED'] },
        paidAt:    { gte: since },
      },
      select: { paidAt: true, totalAmount: true },
    });

    const buckets = new Map<string, HeatmapCell>();
    for (const o of orders) {
      const ts = o.paidAt;
      if (!ts) continue;
      const weekday = ts.getDay();
      const hour    = ts.getHours();
      const key     = `${weekday}-${hour}`;
      const cell = buckets.get(key) ?? {
        weekday, hour, orderCount: 0, revenue: 0,
      };
      cell.orderCount += 1;
      cell.revenue    += Number(o.totalAmount);
      buckets.set(key, cell);
    }
    return Array.from(buckets.values());
  }

  /**
   * Customer cohort retention — past 12 months.
   * Cohort = month of customer's FIRST order (within the 12-month window).
   * For each subsequent month, count distinct customers from that cohort
   * who placed at least one order in that month.
   *
   * Walk-in orders (customerId IS NULL) are excluded — there's no identity
   * to track.
   */
  async cohorts(tenantId: string): Promise<CohortRow[]> {
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        deletedAt:  null,
        status:     { in: ['PAID', 'COMPLETED'] },
        paidAt:     { gte: start },
        customerId: { not: null },
      },
      select: { customerId: true, paidAt: true },
      orderBy: { paidAt: 'asc' },
    });

    // First-order month per customer (within the window).
    const firstMonthByCustomer = new Map<string, string>();
    // (cohortMonth, monthIndex) → Set<customerId> who placed an order that month
    const activity = new Map<string, Set<string>>();

    const ymKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthDelta = (from: string, to: string) => {
      const [fy, fm] = from.split('-').map(Number);
      const [ty, tm] = to.split('-').map(Number);
      return (ty - fy) * 12 + (tm - fm);
    };

    for (const o of orders) {
      if (!o.customerId || !o.paidAt) continue;
      const m = ymKey(o.paidAt);
      if (!firstMonthByCustomer.has(o.customerId)) {
        firstMonthByCustomer.set(o.customerId, m);
      }
    }

    for (const o of orders) {
      if (!o.customerId || !o.paidAt) continue;
      const cohort = firstMonthByCustomer.get(o.customerId);
      if (!cohort) continue;
      const idx = monthDelta(cohort, ymKey(o.paidAt));
      if (idx < 0) continue;
      const k = `${cohort}|${idx}`;
      let set = activity.get(k);
      if (!set) { set = new Set(); activity.set(k, set); }
      set.add(o.customerId);
    }

    // Group by cohortMonth
    const cohortMap = new Map<string, CohortRow>();
    for (const [k, set] of activity) {
      const [cohort, idxStr] = k.split('|');
      const monthIndex = Number(idxStr);
      let row = cohortMap.get(cohort);
      if (!row) {
        row = { cohortMonth: cohort, cohortSize: 0, retention: [] };
        cohortMap.set(cohort, row);
      }
      row.retention.push({ monthIndex, returned: set.size });
      if (monthIndex === 0) row.cohortSize = set.size;
    }
    // Sort cohorts ascending; sort retention buckets ascending.
    const out = Array.from(cohortMap.values()).sort(
      (a, b) => a.cohortMonth.localeCompare(b.cohortMonth),
    );
    for (const r of out) r.retention.sort((a, b) => a.monthIndex - b.monthIndex);
    return out;
  }

  /**
   * Attach rate — top 20 product pairs that co-occur in the same order.
   * Limited to orders from the past 180 days for relevance and to keep
   * the row count manageable.
   */
  async attachRate(tenantId: string): Promise<AttachRateRow[]> {
    const since = new Date();
    since.setDate(since.getDate() - 180);
    since.setHours(0, 0, 0, 0);

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status:    { in: ['PAID', 'COMPLETED'] },
        paidAt:    { gte: since },
      },
      select: {
        id:    true,
        items: { select: { productId: true, productName: true } },
      },
    });

    // (pid_a, pid_b) → { count, names }
    const pairs = new Map<string, { a: string; b: string; nameA: string; nameB: string; count: number }>();
    for (const o of orders) {
      // Deduplicate productIds within an order — we count co-occurrence per
      // order, not per line.
      const seen = new Map<string, string>(); // productId -> productName
      for (const it of o.items) {
        if (!seen.has(it.productId)) seen.set(it.productId, it.productName);
      }
      const ids = Array.from(seen.keys());
      ids.sort();
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i], b = ids[j];
          const key = `${a}|${b}`;
          const cur = pairs.get(key) ?? {
            a, b, nameA: seen.get(a)!, nameB: seen.get(b)!, count: 0,
          };
          cur.count += 1;
          pairs.set(key, cur);
        }
      }
    }

    return Array.from(pairs.values())
      .sort((x, y) => y.count - x.count)
      .slice(0, 20)
      .map((p) => ({
        productAId:   p.a,
        productAName: p.nameA,
        productBId:   p.b,
        productBName: p.nameB,
        coOccurrence: p.count,
      }));
  }
}
