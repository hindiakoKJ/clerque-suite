'use client';
/**
 * Owner-only Sales Report — date-range aggregate of POS revenue.
 *
 * Backed by GET /reports/sales-range. Owner + Manager only (the
 * route's middleware role gate already enforces this; the report
 * endpoint also validates).
 *
 * Sections:
 *   1. KPIs   — total revenue, gross profit, AOV, voids
 *   2. By day — table with date / orders / revenue / GP
 *   3. By payment method — total per method
 *   4. Top products — top 20 by revenue
 *   5. Export — CSV button
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, ChartBar, ShoppingCart, TrendingUp, Wallet, Ban, Receipt } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

interface ByDay {
  date: string; orderCount: number; voidCount: number;
  totalRevenue: number; totalCogs: number; grossProfit: number;
}
interface ByPaymentMethod { method: string; total: number; count: number; }
interface TopProduct {
  productId: string; productName: string;
  qty: number; revenue: number; lineCount: number;
}
interface SalesRange {
  from: string; to: string; branchId: string | null;
  totals: {
    totalRevenue: number; totalCogs: number; grossProfit: number;
    grossMargin: number; totalOrders: number; voidCount: number;
    avgOrderValue: number;
  };
  byDay: ByDay[];
  byPaymentMethod: ByPaymentMethod[];
  topProducts: TopProduct[];
}

function todayPH() {
  const now = new Date();
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return ph.toISOString().slice(0, 10);
}
function offsetDate(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function SalesReportPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';

  const today = todayPH();
  const [from, setFrom] = useState(offsetDate(today, -29));   // last 30 days default
  const [to, setTo]     = useState(today);

  const { data, isLoading } = useQuery<SalesRange>({
    queryKey: ['sales-range', branchId, from, to],
    queryFn:  () => api.get('/reports/sales-range', { params: { from, to, branchId } }).then((r) => r.data),
    enabled:  !!from && !!to && !!branchId,
  });

  function setRange(days: number) {
    const t = todayPH();
    setFrom(offsetDate(t, -(days - 1)));
    setTo(t);
  }

  function exportCsv() {
    if (!data) return;
    const rows: string[] = [];
    rows.push('Date,Orders,Voids,Revenue,COGS,Gross Profit');
    for (const d of data.byDay) {
      rows.push([d.date, d.orderCount, d.voidCount, d.totalRevenue, d.totalCogs, d.grossProfit].join(','));
    }
    rows.push('');
    rows.push('TOTAL,,,' + data.totals.totalRevenue + ',' + data.totals.totalCogs + ',' + data.totals.grossProfit);
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `sales-${from}-to-${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <ChartBar className="h-5 w-5 text-[var(--accent)]" />
          <div>
            <h1 className="text-xl font-semibold">Sales Report</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {from === to ? from : `${from} → ${to}`}
              {data && ` · ${data.totals.totalOrders} orders · ${formatPeso(data.totals.totalRevenue)}`}
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          disabled={!data}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </header>

      <div className="flex-1 p-4 sm:p-6 space-y-5 max-w-6xl mx-auto w-full">

        {/* Date range controls */}
        <section className="rounded-xl border border-border bg-card p-4 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 px-2 rounded-md border border-border bg-background text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">To</label>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 px-2 rounded-md border border-border bg-background text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setRange(d)}
                className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted"
              >
                Last {d}d
              </button>
            ))}
          </div>
        </section>

        {isLoading ? (
          <div className="text-sm text-muted-foreground p-10 text-center">Loading…</div>
        ) : !data ? null : (
          <>
            {/* KPI cards */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi icon={ShoppingCart} label="Total Revenue" value={formatPeso(data.totals.totalRevenue)} sub={`${data.totals.totalOrders} orders`} accent />
              <Kpi icon={Wallet} label="Gross Profit" value={formatPeso(data.totals.grossProfit)} sub={`${(data.totals.grossMargin * 100).toFixed(1)}% margin`} />
              <Kpi icon={TrendingUp} label="Avg Order Value" value={formatPeso(data.totals.avgOrderValue)} />
              <Kpi icon={Ban} label="Voids" value={String(data.totals.voidCount)} sub="excluded from revenue" tone="warn" />
            </section>

            {/* By-day table */}
            <section className="rounded-xl border border-border bg-card overflow-hidden">
              <header className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Receipt className="h-4 w-4" /> By day
                </h2>
              </header>
              {data.byDay.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">No paid orders in this range.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Date</th>
                      <th className="text-right px-4 py-2 font-medium">Orders</th>
                      <th className="text-right px-4 py-2 font-medium">Voids</th>
                      <th className="text-right px-4 py-2 font-medium">Revenue</th>
                      <th className="text-right px-4 py-2 font-medium">COGS</th>
                      <th className="text-right px-4 py-2 font-medium">Gross Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDay.map((d) => (
                      <tr key={d.date} className="border-t border-border/40">
                        <td className="px-4 py-2.5 font-mono text-xs">{d.date}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{d.orderCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{d.voidCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-mono">{formatPeso(d.totalRevenue)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-mono text-muted-foreground">{formatPeso(d.totalCogs)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-mono font-semibold text-emerald-700 dark:text-emerald-400">{formatPeso(d.grossProfit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Payment methods + Top products grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold mb-3">Payment methods</h2>
                {data.byPaymentMethod.length === 0 ? (
                  <div className="text-xs text-muted-foreground">—</div>
                ) : (
                  <div className="space-y-1.5">
                    {data.byPaymentMethod.map((p) => {
                      const pct = data.totals.totalRevenue > 0 ? (p.total / data.totals.totalRevenue) * 100 : 0;
                      return (
                        <div key={p.method} className="text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{p.method.replace(/_/g, ' ')}</span>
                            <span className="font-mono">{formatPeso(p.total)} ({pct.toFixed(1)}%)</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold mb-3">Top products by revenue</h2>
                {data.topProducts.length === 0 ? (
                  <div className="text-xs text-muted-foreground">—</div>
                ) : (
                  <div className="space-y-1">
                    {data.topProducts.map((p, idx) => (
                      <div key={p.productId} className="flex items-center justify-between gap-2 text-xs py-1">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-muted-foreground tabular-nums w-6 text-right">#{idx + 1}</span>
                          <span className="truncate">{p.productName}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-semibold">{formatPeso(p.revenue)}</div>
                          <div className="text-[10px] text-muted-foreground">{p.qty.toFixed(0)} sold</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        <div className="text-[11px] text-muted-foreground pb-4">
          Revenue is recognized at <span className="font-mono">paidAt</span>. Voided orders excluded from revenue/profit
          but counted under Voids. COGS is the sum of <span className="font-mono">OrderItem.costPrice × quantity</span> at sale time.
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, sub, accent, tone,
}: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  accent?: boolean; tone?: 'warn';
}) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${accent ? 'border-l-4 border-l-[var(--accent)]' : 'border-border'}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums ${tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : ''}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

