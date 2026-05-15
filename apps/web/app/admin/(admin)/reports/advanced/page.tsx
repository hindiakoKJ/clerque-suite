'use client';

/**
 * Sprint 25 — Advanced reports page (Solo Pro feature `advancedReports`).
 *
 * Three sections, plain Tailwind (no chart libs):
 *  - Sales heatmap: 7 × 24 colored grid (weekday rows × hour columns).
 *  - Customer cohorts: triangle retention table.
 *  - Attach rate: top 20 product pairs as a simple list.
 *
 * The endpoints are gated server-side by PlanFeatureGuard; if the tenant
 * does not have advancedReports the API returns 403 with PLAN_FEATURE_LOCKED
 * and the sections show an upgrade prompt.
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface HeatmapCell {
  weekday:    number;
  hour:       number;
  orderCount: number;
  revenue:    number;
}

interface CohortRow {
  cohortMonth: string;
  cohortSize:  number;
  retention:   Array<{ monthIndex: number; returned: number }>;
}

interface AttachRateRow {
  productAId:   string;
  productAName: string;
  productBId:   string;
  productBName: string;
  coOccurrence: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtPhp(amt: number): string {
  return `₱${amt.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function AdvancedReportsPage() {
  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-6 py-5 shrink-0">
        <h1 className="text-xl font-bold text-foreground">Advanced Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Hourly sales heatmap, customer cohort retention, and product attach-rate analysis. Solo Pro plan feature.
        </p>
      </div>
      <div className="p-4 sm:p-6 max-w-6xl space-y-8">
        <HeatmapSection />
        <CohortsSection />
        <AttachRateSection />
      </div>
    </div>
  );
}

// ── Heatmap ─────────────────────────────────────────────────────────────

function HeatmapSection() {
  const { data, isLoading, error } = useQuery<HeatmapCell[]>({
    queryKey: ['reports-advanced', 'heatmap'],
    queryFn:  () => api.get('/reports-advanced/sales-heatmap').then((r) => r.data),
  });

  if (isLoading) return <SectionSkeleton title="Sales heatmap" />;
  if (error)     return <SectionError title="Sales heatmap" error={error} />;

  const grid: Record<string, HeatmapCell> = {};
  let maxCount = 0;
  for (const c of data ?? []) {
    grid[`${c.weekday}-${c.hour}`] = c;
    if (c.orderCount > maxCount) maxCount = c.orderCount;
  }

  function intensity(count: number): string {
    if (count === 0 || maxCount === 0) return 'bg-zinc-50';
    const ratio = count / maxCount;
    if (ratio < 0.2) return 'bg-emerald-100';
    if (ratio < 0.4) return 'bg-emerald-200';
    if (ratio < 0.6) return 'bg-emerald-300';
    if (ratio < 0.8) return 'bg-emerald-400';
    return 'bg-emerald-500 text-white';
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-foreground mb-1">Sales heatmap — past 90 days</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Order count per weekday × hour. Greener = busier. Use this to plan staffing and happy-hour promos.
      </p>
      <div className="overflow-x-auto">
        <table className="text-[10px]">
          <thead>
            <tr>
              <th className="w-10"></th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="px-1 text-muted-foreground text-center font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((label, w) => (
              <tr key={w}>
                <td className="pr-2 text-muted-foreground text-right font-medium">{label}</td>
                {Array.from({ length: 24 }, (_, h) => {
                  const cell = grid[`${w}-${h}`];
                  const count = cell?.orderCount ?? 0;
                  return (
                    <td
                      key={h}
                      title={cell ? `${WEEKDAYS[w]} ${h}:00 — ${count} orders, ${fmtPhp(cell.revenue)}` : `${WEEKDAYS[w]} ${h}:00 — 0`}
                      className={`w-7 h-6 text-center align-middle ${intensity(count)} border border-white`}
                    >
                      {count > 0 ? count : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Cohorts ────────────────────────────────────────────────────────────

function CohortsSection() {
  const { data, isLoading, error } = useQuery<CohortRow[]>({
    queryKey: ['reports-advanced', 'cohorts'],
    queryFn:  () => api.get('/reports-advanced/cohorts').then((r) => r.data),
  });

  if (isLoading) return <SectionSkeleton title="Customer cohorts" />;
  if (error)     return <SectionError title="Customer cohorts" error={error} />;

  // Determine the max monthIndex across all cohorts to size the table.
  const maxIdx = Math.max(0, ...((data ?? []).flatMap((r) => r.retention.map((b) => b.monthIndex))));

  function pct(returned: number, size: number): string {
    if (!size) return '—';
    return `${Math.round((returned / size) * 100)}%`;
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-foreground mb-1">Customer cohorts — past 12 months</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Each row is the month a customer first bought from you. Columns show what % of that cohort returned in subsequent months.
      </p>
      {(!data || data.length === 0) ? (
        <p className="text-xs text-muted-foreground">No cohort data yet — needs at least one customer with a tracked customerId.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-muted-foreground font-medium">Cohort</th>
                <th className="px-2 py-1 text-right text-muted-foreground font-medium">Size</th>
                {Array.from({ length: maxIdx + 1 }, (_, i) => (
                  <th key={i} className="px-2 py-1 text-center text-muted-foreground font-medium">M{i}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const byIdx = new Map(row.retention.map((b) => [b.monthIndex, b.returned]));
                return (
                  <tr key={row.cohortMonth} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{row.cohortMonth}</td>
                    <td className="px-2 py-1 text-right">{row.cohortSize}</td>
                    {Array.from({ length: maxIdx + 1 }, (_, i) => {
                      const ret = byIdx.get(i);
                      const isFuture = i > 0 && row.cohortMonth && monthsFromNow(row.cohortMonth) < i;
                      if (isFuture) return <td key={i} className="px-2 py-1 text-center text-zinc-300">·</td>;
                      return (
                        <td key={i} className="px-2 py-1 text-center">
                          {ret == null ? '—' : pct(ret, row.cohortSize)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function monthsFromNow(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  const now = new Date();
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}

// ── Attach rate ────────────────────────────────────────────────────────

function AttachRateSection() {
  const { data, isLoading, error } = useQuery<AttachRateRow[]>({
    queryKey: ['reports-advanced', 'attach-rate'],
    queryFn:  () => api.get('/reports-advanced/attach-rate').then((r) => r.data),
  });

  if (isLoading) return <SectionSkeleton title="Attach rate" />;
  if (error)     return <SectionError title="Attach rate" error={error} />;

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-foreground mb-1">Attach rate — top 20 pairs (past 180 days)</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Products that frequently appear in the same order. Use this to build combo deals or place complementary items together at the till.
      </p>
      {(!data || data.length === 0) ? (
        <p className="text-xs text-muted-foreground">Not enough multi-item orders yet to compute attach rate.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="px-2 py-1 text-left text-muted-foreground font-medium">Rank</th>
              <th className="px-2 py-1 text-left text-muted-foreground font-medium">Product A</th>
              <th className="px-2 py-1 text-left text-muted-foreground font-medium">Product B</th>
              <th className="px-2 py-1 text-right text-muted-foreground font-medium">Co-occurrence</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={`${r.productAId}-${r.productBId}`} className="border-b border-border/40">
                <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                <td className="px-2 py-1">{r.productAName}</td>
                <td className="px-2 py-1">{r.productBName}</td>
                <td className="px-2 py-1 text-right font-mono">{r.coOccurrence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── shared ─────────────────────────────────────────────────────────────

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">{title}</h2>
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    </section>
  );
}

function SectionError({ title, error }: { title: string; error: unknown }) {
  const msg = (error as { response?: { data?: { code?: string; message?: string } } })?.response?.data;
  const isLocked = msg?.code === 'PLAN_FEATURE_LOCKED';
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-2">{title}</h2>
      {isLocked ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Advanced reports require the Solo Pro plan. Upgrade to unlock hourly heatmaps, cohort retention, and attach-rate analysis.
        </p>
      ) : (
        <p className="text-xs text-red-700">{msg?.message ?? 'Failed to load this section.'}</p>
      )}
    </section>
  );
}
