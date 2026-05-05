import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Operations / lead-time reporting (Sprint 7 KPI suite).
 *
 * Lead time = readyAt - paidAt. The duration between the cashier confirming
 * payment and the bar/kitchen marking the LAST item READY. This is the core
 * café operations KPI — how long does the customer actually wait?
 *
 * All metrics filter on `paidAt` (the production-queue entry time), not
 * `completedAt`. Orders still in PAID status have `readyAt = null` and
 * are excluded from lead-time aggregates but shown in the "in-flight"
 * count separately.
 */
@Injectable()
export class OperationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Daily lead-time KPIs for the dashboard cards. Shape is intentionally
   * compact so the dashboard can fetch + render quickly. Returns null
   * fields when there's no data yet (avoid divide-by-zero / NaN).
   */
  async getDailyLeadTime(tenantId: string, branchId: string, date: string): Promise<DailyLeadTimeReport> {
    const startOfDay = new Date(`${date}T00:00:00+08:00`);
    const endOfDay   = new Date(`${date}T23:59:59.999+08:00`);

    // All paid orders for the day (PAID + COMPLETED, excludes VOIDED).
    // Sale-recognition is at paidAt (PFRS § 9), so this captures everything
    // that "happened today" regardless of when production finished.
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        paidAt: { gte: startOfDay, lte: endOfDay },
        status: { in: ['PAID', 'COMPLETED'] },
      },
      select: {
        id:           true,
        status:       true,
        paidAt:       true,
        readyAt:      true,
        items:        {
          select:     {
            productId:   true,
            productName: true,
            quantity:    true,
            product:     { select: { category: { select: { stationId: true, name: true } } } },
          },
        },
      },
      orderBy: { paidAt: 'asc' },
    });

    // Lead times in seconds. Only orders that have actually completed
    // production (readyAt set) count toward aggregate stats.
    const leadTimesSec: number[] = [];
    let inFlightCount = 0;
    for (const o of orders) {
      if (o.status === 'PAID' || !o.readyAt) {
        inFlightCount++;
        continue;
      }
      const seconds = Math.floor((o.readyAt.getTime() - (o.paidAt?.getTime() ?? 0)) / 1000);
      if (seconds >= 0) leadTimesSec.push(seconds);
    }

    const completedCount = leadTimesSec.length;
    const avgSec = completedCount === 0 ? null : Math.round(mean(leadTimesSec));
    const p50Sec = completedCount === 0 ? null : percentile(leadTimesSec, 0.50);
    const p90Sec = completedCount === 0 ? null : percentile(leadTimesSec, 0.90);
    const p95Sec = completedCount === 0 ? null : percentile(leadTimesSec, 0.95);

    // Threshold counts — useful as alarm thresholds.
    const FIVE_MIN  = 5  * 60;
    const TEN_MIN   = 10 * 60;
    const overFiveMin = leadTimesSec.filter((s) => s > FIVE_MIN).length;
    const overTenMin  = leadTimesSec.filter((s) => s > TEN_MIN).length;

    // Per-station breakdown. We need to look at the items' station routing
    // to attribute lead time to a station. For multi-station orders, the
    // lead time counts toward EACH station that was involved.
    const stationStats = new Map<string, { stationId: string; stationName: string; samples: number[] }>();
    for (const o of orders) {
      if (o.status !== 'COMPLETED' || !o.readyAt || !o.paidAt) continue;
      const seconds = Math.floor((o.readyAt.getTime() - o.paidAt.getTime()) / 1000);
      if (seconds < 0) continue;
      const stationsTouched = new Set<string>();
      const stationNames    = new Map<string, string>();
      for (const it of o.items) {
        const sid = it.product?.category?.stationId;
        if (sid) {
          stationsTouched.add(sid);
          const sname = it.product?.category?.name ?? '—';
          if (!stationNames.has(sid)) stationNames.set(sid, sname);
        }
      }
      for (const sid of stationsTouched) {
        const existing = stationStats.get(sid);
        if (existing) {
          existing.samples.push(seconds);
        } else {
          stationStats.set(sid, {
            stationId:   sid,
            stationName: stationNames.get(sid) ?? '—',
            samples:     [seconds],
          });
        }
      }
    }

    // Resolve the actual Station names (the category.name is wrong — we
    // tracked which categories were involved, not the stations themselves).
    const stationIds = Array.from(stationStats.keys());
    const stations = stationIds.length
      ? await this.prisma.station.findMany({
          where:  { id: { in: stationIds } },
          select: { id: true, name: true, kind: true },
        })
      : [];
    const stationNameById = new Map(stations.map((s) => [s.id, { name: s.name, kind: s.kind }]));

    const byStation = Array.from(stationStats.values())
      .map((entry) => {
        const meta = stationNameById.get(entry.stationId);
        return {
          stationId:   entry.stationId,
          stationName: meta?.name ?? entry.stationName,
          stationKind: meta?.kind ?? 'BAR',
          orderCount:  entry.samples.length,
          avgSec:      Math.round(mean(entry.samples)),
          p90Sec:      percentile(entry.samples, 0.90),
        };
      })
      .sort((a, b) => b.avgSec - a.avgSec);

    // Per-product lead time — useful for "which drinks are slow" question.
    // We attribute the order's full lead time to each product on it (a drink's
    // wait is the same as its order's wait — they're entangled in service).
    const productStats = new Map<string, { productId: string; productName: string; samples: number[]; totalQty: number }>();
    for (const o of orders) {
      if (o.status !== 'COMPLETED' || !o.readyAt || !o.paidAt) continue;
      const seconds = Math.floor((o.readyAt.getTime() - o.paidAt.getTime()) / 1000);
      if (seconds < 0) continue;
      for (const it of o.items) {
        if (!it.product?.category?.stationId) continue; // skip unrouted items
        const existing = productStats.get(it.productId);
        if (existing) {
          existing.samples.push(seconds);
          existing.totalQty += Number(it.quantity);
        } else {
          productStats.set(it.productId, {
            productId:   it.productId,
            productName: it.productName,
            samples:     [seconds],
            totalQty:    Number(it.quantity),
          });
        }
      }
    }
    const byProduct = Array.from(productStats.values())
      .map((entry) => ({
        productId:   entry.productId,
        productName: entry.productName,
        orderCount:  entry.samples.length,
        totalQty:    entry.totalQty,
        avgSec:      Math.round(mean(entry.samples)),
      }))
      .sort((a, b) => b.avgSec - a.avgSec);

    // By hour of day — sparkline data. 24 bins, in PH time.
    const byHour: Array<{ hour: number; orderCount: number; avgSec: number | null }> = [];
    for (let h = 0; h < 24; h++) byHour.push({ hour: h, orderCount: 0, avgSec: null });
    const hourBuckets: number[][] = Array.from({ length: 24 }, () => []);
    for (const o of orders) {
      if (o.status !== 'COMPLETED' || !o.readyAt || !o.paidAt) continue;
      const seconds = Math.floor((o.readyAt.getTime() - o.paidAt.getTime()) / 1000);
      if (seconds < 0) continue;
      // PH local hour — paidAt is UTC; offset 8h.
      const phHour = Math.floor(((o.paidAt.getTime() + 8 * 60 * 60 * 1000) / 3_600_000) % 24);
      hourBuckets[phHour].push(seconds);
    }
    for (let h = 0; h < 24; h++) {
      const bucket = hourBuckets[h];
      byHour[h].orderCount = bucket.length;
      byHour[h].avgSec     = bucket.length === 0 ? null : Math.round(mean(bucket));
    }

    return {
      date,
      branchId,
      totalOrders:   orders.length,
      completedCount,
      inFlightCount,
      avgSec,
      p50Sec,
      p90Sec,
      p95Sec,
      overFiveMinCount: overFiveMin,
      overTenMinCount:  overTenMin,
      byStation,
      byProduct: byProduct.slice(0, 10), // top 10 slowest only
      byHour,
    };
  }
}

// ── Statistics helpers ──────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Linear-interpolation percentile (e.g., 0.90 = P90). Assumes xs has at least one element. */
function percentile(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const low  = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return sorted[low];
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (idx - low));
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface DailyLeadTimeReport {
  date:             string;     // YYYY-MM-DD
  branchId:         string;
  totalOrders:      number;     // PAID + COMPLETED
  completedCount:   number;     // orders with readyAt set
  inFlightCount:    number;     // orders still PAID (in production)
  avgSec:           number | null;
  p50Sec:           number | null;
  p90Sec:           number | null;
  p95Sec:           number | null;
  overFiveMinCount: number;
  overTenMinCount:  number;
  byStation: Array<{
    stationId:   string;
    stationName: string;
    stationKind: string;
    orderCount:  number;
    avgSec:      number;
    p90Sec:      number;
  }>;
  byProduct: Array<{
    productId:   string;
    productName: string;
    orderCount:  number;
    totalQty:    number;
    avgSec:      number;
  }>;
  byHour: Array<{
    hour:       number;       // 0..23 in PH time
    orderCount: number;
    avgSec:     number | null;
  }>;
}
