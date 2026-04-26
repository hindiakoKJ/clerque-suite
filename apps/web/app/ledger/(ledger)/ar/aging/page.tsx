'use client';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso, downloadAuthFile } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgingRow {
  customerId: string;
  customerName: string;
  notDue: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90plus: number;
  total: number;
}

interface AgingGrandTotal {
  notDue: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90plus: number;
  total: number;
}

interface AgingResponse {
  asOf: string;
  rows: AgingRow[];
  grandTotal: AgingGrandTotal;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function AmountCell({
  value,
  colorClass,
}: {
  value: number;
  colorClass?: string;
}) {
  if (value === 0) {
    return (
      <td className="px-4 py-3 text-right font-mono text-muted-foreground/40 text-sm">—</td>
    );
  }
  return (
    <td className={`px-4 py-3 text-right font-mono text-sm font-medium ${colorClass ?? 'text-foreground'}`}>
      {formatPeso(value)}
    </td>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AgingPage() {
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery<AgingResponse>({
    queryKey: ['ar-aging'],
    queryFn:  () => api.get('/ar/aging').then((r) => r.data),
    enabled:  !!user,
  });

  const buckets = [
    { key: 'notDue'       as const, label: 'Not Yet Due',    colorClass: 'text-foreground' },
    { key: 'bucket1_30'   as const, label: '1 – 30 days',    colorClass: 'text-yellow-600 dark:text-yellow-400' },
    { key: 'bucket31_60'  as const, label: '31 – 60 days',   colorClass: 'text-amber-600 dark:text-amber-400' },
    { key: 'bucket61_90'  as const, label: '61 – 90 days',   colorClass: 'text-orange-600 dark:text-orange-400' },
    { key: 'bucket90plus' as const, label: '90+ days',       colorClass: 'text-red-600 dark:text-red-400' },
    { key: 'total'        as const, label: 'Total',          colorClass: 'text-foreground font-bold' },
  ];

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[var(--accent)]" />
            AR Aging Report
          </h1>
          {data?.asOf && (
            <p className="text-sm text-muted-foreground mt-1">
              As of <span className="font-medium text-foreground">{fmtDate(data.asOf)}</span>
              {' · '}Outstanding balances only
            </p>
          )}
        </div>
        <button
          onClick={() => downloadAuthFile('/export/ar-aging', `ar-aging-${new Date().toISOString().slice(0, 10)}.xlsx`)}
          className="flex items-center gap-1.5 text-sm border border-border rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-muted transition-colors self-start sm:self-auto"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-5">
        {buckets.slice(0, -1).map((b) => (
          <div key={b.key} className="flex items-center gap-1.5 text-xs">
            <div className={`w-2.5 h-2.5 rounded-full ${b.colorClass.replace('text-', 'bg-')}`} />
            <span className={b.colorClass}>{b.label}</span>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading aging report…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No outstanding AR invoices found
        </div>
      ) : (
        <div className="bg-background rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase">
                  <th className="px-4 py-2.5 text-left font-semibold">Customer</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Not Yet Due</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-yellow-600 dark:text-yellow-400">1 – 30 days</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-amber-600 dark:text-amber-400">31 – 60 days</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-orange-600 dark:text-orange-400">61 – 90 days</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-red-600 dark:text-red-400">90+ days</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((row) => (
                  <tr key={row.customerId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{row.customerName}</td>
                    <AmountCell value={row.notDue}       colorClass="text-foreground" />
                    <AmountCell value={row.bucket1_30}   colorClass="text-yellow-600 dark:text-yellow-400" />
                    <AmountCell value={row.bucket31_60}  colorClass="text-amber-600 dark:text-amber-400" />
                    <AmountCell value={row.bucket61_90}  colorClass="text-orange-600 dark:text-orange-400" />
                    <AmountCell value={row.bucket90plus} colorClass="text-red-600 dark:text-red-400" />
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-foreground">
                      {formatPeso(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Grand Total row */}
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/60">
                  <td className="px-4 py-3 font-bold text-foreground text-sm">Grand Total</td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-bold text-foreground">
                    {data.grandTotal.notDue > 0 ? formatPeso(data.grandTotal.notDue) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-bold text-yellow-600 dark:text-yellow-400">
                    {data.grandTotal.bucket1_30 > 0 ? formatPeso(data.grandTotal.bucket1_30) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-bold text-amber-600 dark:text-amber-400">
                    {data.grandTotal.bucket31_60 > 0 ? formatPeso(data.grandTotal.bucket31_60) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-bold text-orange-600 dark:text-orange-400">
                    {data.grandTotal.bucket61_90 > 0 ? formatPeso(data.grandTotal.bucket61_90) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-bold text-red-600 dark:text-red-400">
                    {data.grandTotal.bucket90plus > 0 ? formatPeso(data.grandTotal.bucket90plus) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-bold text-foreground">
                    {formatPeso(data.grandTotal.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Bucket summary cards */}
      {data && data.grandTotal.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-6">
          {buckets.slice(0, -1).map((b) => {
            const val = data.grandTotal[b.key];
            const pct = data.grandTotal.total > 0 ? (val / data.grandTotal.total) * 100 : 0;
            return (
              <div key={b.key} className="bg-card rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground mb-1">{b.label}</p>
                <p className={`text-base font-bold font-mono ${b.colorClass}`}>
                  {formatPeso(val)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{pct.toFixed(1)}% of total</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
