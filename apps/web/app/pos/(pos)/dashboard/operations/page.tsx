'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Timer, Activity, AlertTriangle, ArrowLeft, Coffee, ChefHat, Cake, Store,
  ChevronLeft, ChevronRight, RefreshCw, TrendingUp, Hourglass,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

// ─── Types (mirror operations.service.ts) ────────────────────────────────────

interface DailyLeadTimeReport {
  date:             string;
  branchId:         string;
  totalOrders:      number;
  completedCount:   number;
  inFlightCount:    number;
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
    hour:       number;
    orderCount: number;
    avgSec:     number | null;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayPH() {
  const now = new Date();
  const ph  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return ph.toISOString().slice(0, 10);
}

function offsetDate(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string) {
  const today = todayPH();
  if (dateStr === today) return 'Today';
  const yesterday = offsetDate(today, -1);
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(`${dateStr}T12:00:00+08:00`).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Format seconds as "Xm YY s" or "Xs" — compact and readable. */
function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

const STATION_ICON: Record<string, React.ElementType> = {
  COUNTER:     Store,
  BAR:         Coffee,
  KITCHEN:     ChefHat,
  HOT_BAR:     Coffee,
  COLD_BAR:    Coffee,
  PASTRY_PASS: Cake,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OperationsDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';
  const [date, setDate] = useState(todayPH());

  const { data, isLoading, refetch, isFetching } = useQuery<DailyLeadTimeReport>({
    queryKey: ['ops-daily', branchId, date],
    queryFn:  () => api.get(`/reports/operations/daily`, { params: { branchId, date } }).then((r) => r.data),
    enabled:  !!branchId,
    staleTime: 30_000,
    refetchInterval: date === todayPH() ? 30_000 : false, // live refresh on today only
  });

  const maxHourCount = useMemo(
    () => data ? Math.max(1, ...data.byHour.map((h) => h.orderCount)) : 1,
    [data],
  );

  return (
    <div className="flex flex-col h-full bg-muted/30 overflow-auto">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-background border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/pos/dashboard"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Operations · Lead Time</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Production wait times — payment to ready
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted rounded-lg px-1 py-1">
            <button onClick={() => setDate((d) => offsetDate(d, -1))} className="p-1 rounded hover:bg-background transition-colors">
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <span className="text-sm font-medium text-foreground px-2 min-w-20 text-center">
              {formatDateLabel(date)}
            </span>
            <button onClick={() => setDate((d) => offsetDate(d, 1))} disabled={date >= todayPH()} className="p-1 rounded hover:bg-background transition-colors disabled:opacity-30">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <button onClick={() => refetch()} disabled={isFetching} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <RefreshCw className={`h-4 w-4 text-muted-foreground ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">Loading…</div>
      ) : !data ? null : data.completedCount === 0 && data.inFlightCount === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-3 px-6 text-center">
          <Hourglass className="h-12 w-12 opacity-30" />
          <p className="text-sm">No production data yet for {formatDateLabel(date).toLowerCase()}.</p>
          <p className="text-xs">Lead times appear once orders flow Counter → Bar/Kitchen → Ready.</p>
        </div>
      ) : (
        <div className="flex-1 p-4 sm:p-6 space-y-6">

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              icon={Timer}
              label="Avg Lead Time"
              value={fmtDuration(data.avgSec)}
              sub={`${data.completedCount} orders measured`}
              tone="brand"
            />
            <KpiCard
              icon={TrendingUp}
              label="P90 Lead Time"
              value={fmtDuration(data.p90Sec)}
              sub={`90% of orders ready in this time`}
              tone={data.p90Sec != null && data.p90Sec > 600 ? 'warn' : 'neutral'}
            />
            <KpiCard
              icon={Activity}
              label="In Flight"
              value={String(data.inFlightCount)}
              sub={data.inFlightCount === 1 ? 'order in production' : 'orders in production'}
              tone={data.inFlightCount > 5 ? 'warn' : 'neutral'}
            />
            <KpiCard
              icon={AlertTriangle}
              label="Over 10 min"
              value={String(data.overTenMinCount)}
              sub={`${data.overFiveMinCount} over 5 min`}
              tone={data.overTenMinCount > 0 ? 'alert' : 'neutral'}
            />
          </div>

          {/* By station */}
          <section className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">By Station</h2>
              <span className="text-xs text-muted-foreground">— where time is being spent</span>
            </div>
            {data.byStation.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No station-routed items today.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Station</th>
                    <th className="px-4 py-2 text-right font-semibold">Orders</th>
                    <th className="px-4 py-2 text-right font-semibold">Avg Lead Time</th>
                    <th className="px-4 py-2 text-right font-semibold">P90 Lead Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byStation.map((s) => {
                    const Icon = STATION_ICON[s.stationKind] ?? Store;
                    return (
                      <tr key={s.stationId} className="hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium text-foreground">{s.stationName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{s.orderCount}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                          s.avgSec > 600 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
                        }`}>
                          {fmtDuration(s.avgSec)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {fmtDuration(s.p90Sec)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* By product (top 10 slowest) */}
          <section className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Top 10 Slowest Products</h2>
              <span className="text-xs text-muted-foreground">— recipe / process audit candidates</span>
            </div>
            {data.byProduct.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No product data yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Product</th>
                    <th className="px-4 py-2 text-right font-semibold">Sold</th>
                    <th className="px-4 py-2 text-right font-semibold">Avg Wait</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byProduct.map((p, i) => (
                    <tr key={p.productId} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground tabular-nums w-6 inline-block">{i + 1}.</span>
                        <span className="font-medium text-foreground">{p.productName}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {p.totalQty.toLocaleString('en-PH', { maximumFractionDigits: 0 })}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                        p.avgSec > 600 ? 'text-amber-600 dark:text-amber-400' :
                        p.avgSec > 300 ? 'text-foreground' :
                                         'text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {fmtDuration(p.avgSec)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* By hour — sparkline / bar chart */}
          <section className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">By Hour of Day</h2>
              <span className="text-xs text-muted-foreground">— PH time, lead time per hour</span>
            </div>
            <div className="px-4 py-4">
              <div className="flex items-end gap-1 h-32">
                {data.byHour.map((h) => {
                  const heightPct = (h.orderCount / maxHourCount) * 100;
                  const isPeak = h.orderCount === maxHourCount && h.orderCount > 0;
                  const slowHour = h.avgSec != null && h.avgSec > 600;
                  return (
                    <div
                      key={h.hour}
                      className="flex-1 flex flex-col items-center gap-1 group relative"
                      title={`${h.hour}:00 — ${h.orderCount} orders, ${fmtDuration(h.avgSec)} avg`}
                    >
                      <div
                        className={`w-full rounded-t transition-colors ${
                          slowHour ? 'bg-amber-500' :
                          isPeak ? 'bg-[var(--accent)]' :
                                   'bg-muted-foreground/30 group-hover:bg-[var(--accent)]'
                        }`}
                        style={{ height: `${heightPct}%`, minHeight: h.orderCount > 0 ? '2px' : '0' }}
                      />
                      <span className="text-[9px] text-muted-foreground tabular-nums">
                        {h.hour}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-muted-foreground/30" />
                  Normal
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-[var(--accent)]" />
                  Peak hour
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-amber-500" />
                  Slow hour (avg &gt; 10 min)
                </span>
              </div>
            </div>
          </section>

          {/* Methodology footnote */}
          <div className="text-[10px] text-muted-foreground/70 leading-relaxed px-1 pb-2">
            <p>
              Lead time = time from payment confirmation to the moment the LAST item on the order is
              marked READY by the bar/kitchen tablet. Orders without station routing (retail items,
              bottled drinks) bypass production entirely and don&apos;t appear here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  tone: 'brand' | 'neutral' | 'warn' | 'alert';
}) {
  const toneCls =
    tone === 'brand' ? { border: 'border-l-[var(--accent)]', icon: 'text-[var(--accent)]' } :
    tone === 'warn'  ? { border: 'border-l-amber-500',       icon: 'text-amber-500' } :
    tone === 'alert' ? { border: 'border-l-red-500',         icon: 'text-red-500' } :
                       { border: 'border-l-muted-foreground/30', icon: 'text-muted-foreground' };
  return (
    <div className={`bg-background rounded-lg border border-border border-l-4 ${toneCls.border} p-3 sm:p-4 flex flex-col justify-between min-h-[88px]`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <Icon className={`w-4 h-4 ${toneCls.icon}`} />
      </div>
      <div className="text-xl sm:text-2xl font-bold text-foreground tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}
