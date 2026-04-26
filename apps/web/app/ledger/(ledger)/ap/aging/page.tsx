'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso, downloadAuthFile } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgingRow {
  vendorId: string;
  vendorName: string;
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  days90plus: number;
  total: number;
}

interface AgingTotals {
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  days90plus: number;
  total: number;
}

interface AgingResponse {
  asOf: string;
  rows: AgingRow[];
  totals: AgingTotals;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function AmtCell({ amount, cls = '' }: { amount: number; cls?: string }) {
  if (amount === 0) return <span className="text-muted-foreground/40">—</span>;
  return <span className={cls || 'text-foreground'}>{formatPeso(amount)}</span>;
}

// Column bucket config
const BUCKETS: {
  key: keyof AgingTotals;
  label: string;
  sub: string;
  headerCls: string;
  cellCls: string;
}[] = [
  {
    key: 'current',
    label: 'Current',
    sub: 'Not yet due',
    headerCls: 'text-muted-foreground',
    cellCls: 'text-foreground',
  },
  {
    key: 'days1_30',
    label: '1–30 Days',
    sub: 'Past due',
    headerCls: 'text-yellow-600 dark:text-yellow-400',
    cellCls: 'text-yellow-600 dark:text-yellow-400',
  },
  {
    key: 'days31_60',
    label: '31–60 Days',
    sub: 'Past due',
    headerCls: 'text-amber-600 dark:text-amber-400',
    cellCls: 'text-amber-600 dark:text-amber-400',
  },
  {
    key: 'days61_90',
    label: '61–90 Days',
    sub: 'Past due',
    headerCls: 'text-orange-600 dark:text-orange-400',
    cellCls: 'text-orange-600 dark:text-orange-400',
  },
  {
    key: 'days90plus',
    label: '90+ Days',
    sub: 'Past due',
    headerCls: 'text-rose-600 dark:text-rose-400',
    cellCls: 'text-rose-600 dark:text-rose-400',
  },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AgingPage() {
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery<AgingResponse>({
    queryKey: ['ap-aging'],
    queryFn: () => api.get('/ap/vendors/aging').then((r) => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">AP Aging Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Outstanding accounts payable grouped by days past due
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {data && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 border border-border">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span>As of {fmtDate(data.asOf)}</span>
            </div>
          )}
          <button
            onClick={() => downloadAuthFile('/export/ap-aging', `ap-aging-${new Date().toISOString().slice(0, 10)}.xlsx`)}
            className="flex items-center gap-1.5 text-sm border border-border rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-muted transition-colors"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* Grand Total Card */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="col-span-2 sm:col-span-1 bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Total Outstanding AP
            </p>
            <p className="text-2xl font-bold text-foreground font-mono">
              {formatPeso(data.totals.total)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.rows.length} vendor{data.rows.length !== 1 ? 's' : ''} with open balances
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Current</p>
            <p className="text-xl font-bold text-foreground font-mono">{formatPeso(data.totals.current)}</p>
          </div>

          <div className="bg-card border border-rose-400/30 rounded-xl p-4">
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wide mb-1">
              Overdue (90+ days)
            </p>
            <p className="text-xl font-bold text-rose-600 dark:text-rose-400 font-mono">
              {formatPeso(data.totals.days90plus)}
            </p>
          </div>
        </div>
      )}

      {/* Aging Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading aging report…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No outstanding payables</p>
          <p className="text-xs mt-1 opacity-70">All posted expenses are fully paid</p>
        </div>
      ) : (
        <div className="bg-background rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Vendor
                  </th>
                  {BUCKETS.map((b) => (
                    <th
                      key={b.key}
                      className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide ${b.headerCls}`}
                    >
                      <div>{b.label}</div>
                      <div className="text-muted-foreground font-normal normal-case tracking-normal">
                        {b.sub}
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground uppercase tracking-wide">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((row) => (
                  <tr key={row.vendorId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {row.vendorName}
                    </td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className={`px-4 py-3 text-right font-mono text-xs ${b.cellCls}`}>
                        <AmtCell amount={row[b.key]} cls={b.cellCls} />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-foreground">
                      {formatPeso(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Summary row */}
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40">
                  <td className="px-4 py-3 text-xs font-bold text-foreground uppercase tracking-wide">
                    Total
                  </td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className={`px-4 py-3 text-right font-mono text-xs font-bold ${b.headerCls}`}>
                      {data.totals[b.key] > 0 ? formatPeso(data.totals[b.key]) : '—'}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-mono text-sm font-bold text-foreground">
                    {formatPeso(data.totals.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-border bg-muted/20 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted-foreground/30" /> Current: not yet due
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-500/60" /> 1–30 days overdue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/60" /> 31–60 days overdue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500/60" /> 61–90 days overdue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500/60" /> 90+ days overdue
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
