'use client';
/**
 * Sprint 19 — Unified all-branch report (owner-only).
 *
 * One-page read-out across all branches. Per-branch breakdown of:
 *   • Revenue / COGS / Gross profit
 *   • Order count + void count + AOV
 *   • AP billed + outstanding
 *   • AR invoiced + outstanding
 *   • Inventory value (qty × WAC, falling back to product.costPrice)
 * Plus tenant-wide totals at the top.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, BarChart3, Download, Calendar, TrendingUp, AlertCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface BranchRow {
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

interface UnifiedReport {
  from: string; to: string;
  branches: BranchRow[];
  shared:   BranchRow[];
  totals: {
    revenue: number; cogs: number; grossProfit: number; grossMargin: number;
    orderCount: number; voidCount: number;
    apBilled: number; apOutstanding: number;
    arInvoiced: number; arOutstanding: number;
    inventoryValue: number;
  };
}

function fmtPeso(n: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}
function isoDay(d: Date) {
  const ph = new Date(d.getTime() + 8 * 60 * 60_000);
  return ph.toISOString().slice(0, 10);
}

export default function UnifiedReportPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (user && !isOwner) router.replace('/pos/dashboard');
  }, [user, isOwner, router]);

  // Default range: last 30 days inclusive
  const today = new Date();
  const thirtyAgo = new Date(today.getTime() - 30 * 24 * 60 * 60_000);
  const [from, setFrom] = useState(isoDay(thirtyAgo));
  const [to,   setTo]   = useState(isoDay(today));

  const { data, isLoading } = useQuery<UnifiedReport>({
    queryKey: ['unified-report', from, to],
    queryFn:  () => api.get(`/reports/unified?from=${from}&to=${to}`).then((r) => r.data),
    enabled:  !!user && isOwner,
  });

  function setRange(days: number) {
    const t = new Date();
    const f = new Date(t.getTime() - days * 24 * 60 * 60_000);
    setFrom(isoDay(f));
    setTo(isoDay(t));
  }

  function exportCsv() {
    if (!data) return;
    const headers = [
      'Branch','Revenue','COGS','Gross Profit','Orders','Voids','AOV',
      'AP Billed','AP Outstanding','AR Invoiced','AR Outstanding','Inventory Value',
    ];
    const rows = [...data.branches, ...data.shared].map((b) => [
      b.branchName, b.revenue, b.cogs, b.grossProfit,
      b.orderCount, b.voidCount, b.avgOrderValue.toFixed(2),
      b.apBilled, b.apOutstanding, b.arInvoiced, b.arOutstanding, b.inventoryValue,
    ]);
    const csv = [
      headers.join(','),
      ...rows.map((r) => r.map((v) => typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v).join(',')),
      [
        'TOTAL', data.totals.revenue, data.totals.cogs, data.totals.grossProfit,
        data.totals.orderCount, data.totals.voidCount, '',
        data.totals.apBilled, data.totals.apOutstanding,
        data.totals.arInvoiced, data.totals.arOutstanding, data.totals.inventoryValue,
      ].join(','),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `clerque-unified-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!isOwner) return null;

  const inputCls = 'rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';

  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-5">
      <button
        onClick={() => router.push('/pos/dashboard')}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-[var(--accent)]" />
            Unified Report — All Branches
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Single read-out of the whole business. Sales, COGS, AP, AR, and inventory value
            broken down per branch with tenant-wide totals.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={!data}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {/* Range picker */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" /> From
          </span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <div className="flex gap-1">
          {[
            { d: 7,   label: '7d' },
            { d: 30,  label: '30d' },
            { d: 90,  label: '90d' },
          ].map((opt) => (
            <button
              key={opt.d}
              onClick={() => setRange(opt.d)}
              className="text-xs rounded-md border border-border px-2.5 py-1 hover:bg-muted"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !data ? (
        <div className="text-sm text-muted-foreground">No data.</div>
      ) : (
        <>
          {/* Tenant-wide KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Revenue" value={fmtPeso(data.totals.revenue)} accent />
            <Kpi label="Gross profit" value={fmtPeso(data.totals.grossProfit)}
              sub={`${(data.totals.grossMargin * 100).toFixed(1)}% margin`} />
            <Kpi label="Orders" value={String(data.totals.orderCount)}
              sub={data.totals.voidCount ? `${data.totals.voidCount} voided` : undefined} />
            <Kpi label="Inventory value" value={fmtPeso(data.totals.inventoryValue)} />
            <Kpi label="AP outstanding" value={fmtPeso(data.totals.apOutstanding)}
              sub={`${fmtPeso(data.totals.apBilled)} billed`} />
            <Kpi label="AR outstanding" value={fmtPeso(data.totals.arOutstanding)}
              sub={`${fmtPeso(data.totals.arInvoiced)} invoiced`} />
            <Kpi label="Cash trapped" value={fmtPeso(data.totals.arOutstanding + data.totals.inventoryValue)}
              sub="AR + inventory" />
            <Kpi label="Net working" value={fmtPeso(data.totals.arOutstanding + data.totals.inventoryValue - data.totals.apOutstanding)}
              sub="(AR + inv) − AP" />
          </div>

          {/* Per-branch breakdown */}
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
                  <th className="text-left px-3 py-2">Branch</th>
                  <th className="text-right px-3 py-2">Revenue</th>
                  <th className="text-right px-3 py-2">COGS</th>
                  <th className="text-right px-3 py-2">Gross profit</th>
                  <th className="text-right px-3 py-2">Orders</th>
                  <th className="text-right px-3 py-2">AOV</th>
                  <th className="text-right px-3 py-2">AP outstanding</th>
                  <th className="text-right px-3 py-2">AR outstanding</th>
                  <th className="text-right px-3 py-2">Inventory value</th>
                </tr>
              </thead>
              <tbody>
                {data.branches.map((b) => (
                  <tr key={b.branchId} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{b.branchName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPeso(b.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtPeso(b.cogs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtPeso(b.grossProfit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.orderCount}
                      {b.voidCount > 0 && (
                        <span className="text-[10px] text-rose-500 ml-1">({b.voidCount} void)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtPeso(b.avgOrderValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.apOutstanding > 0
                        ? <span className="text-amber-700 dark:text-amber-400 font-medium">{fmtPeso(b.apOutstanding)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.arOutstanding > 0
                        ? <span className="text-blue-700 dark:text-blue-400 font-medium">{fmtPeso(b.arOutstanding)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPeso(b.inventoryValue)}</td>
                  </tr>
                ))}
                {data.shared.length > 0 && data.shared.map((b) => (
                  <tr key={b.branchId} className="border-b border-border bg-muted/10">
                    <td className="px-3 py-2 italic text-muted-foreground">{b.branchName}</td>
                    <td colSpan={5}></td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.apOutstanding > 0 ? fmtPeso(b.apOutstanding) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.arOutstanding > 0 ? fmtPeso(b.arOutstanding) : '—'}
                    </td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40 font-semibold border-t-2 border-border">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPeso(data.totals.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtPeso(data.totals.cogs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPeso(data.totals.grossProfit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{data.totals.orderCount}</td>
                  <td></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPeso(data.totals.apOutstanding)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPeso(data.totals.arOutstanding)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPeso(data.totals.inventoryValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Footnotes */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="flex items-start gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Revenue + COGS + Gross profit + Order count are filtered to the date range. Inventory value
              is point-in-time as of right now.
            </p>
            {data.shared.length > 0 && (
              <p className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                "Shared / no branch" rolls up AP bills and AR invoices that were posted without a branch
                tag (typically corporate-level transactions).
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border border-border p-3 ${accent ? 'bg-[var(--accent-soft)]' : 'bg-card'}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-0.5 tabular-nums ${accent ? 'text-[var(--accent)]' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
