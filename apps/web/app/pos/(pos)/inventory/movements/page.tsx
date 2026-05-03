'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownCircle, ArrowUpCircle, ChevronLeft, FileSpreadsheet, FlaskConical, Package, ShoppingCart, RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Movement {
  id:                string;
  kind:              'PRODUCT' | 'RAW_MATERIAL';
  occurredAt:        string;
  type:              string;
  itemName:          string;
  unit:              string | null;
  quantity:          number;
  quantityBefore:    number | null;
  quantityAfter:     number | null;
  branchId:          string | null;
  reason:            string | null;
  reference:         string | null;
  createdById:       string | null;
  createdByName:     string | null;
  paymentMethod:     string | null;
  totalValue:        number | null;
  accountingEventId: string | null;
}

// ─── Type → label + icon map ──────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  INITIAL:        'Opening Stock',
  STOCK_IN:       'Stock In',
  STOCK_OUT:      'Stock Out',
  ADJUSTMENT:     'Adjustment',
  SALE_DEDUCTION: 'Sale',
  VOID_REVERSAL:  'Void Reversed',
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH:         'Cash',
  CREDIT:       'Credit / AP',
  OWNER_FUNDED: 'Owner Funds',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function StockMovementsPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(sevenDaysAgo);
  const [to,   setTo]   = useState(today);
  const [kind, setKind] = useState<'ALL' | 'PRODUCT' | 'RAW_MATERIAL'>('ALL');

  const { data: movements = [], isLoading, refetch, isFetching } = useQuery<Movement[]>({
    queryKey: ['stock-movements', branchId, from, to, kind],
    queryFn: () => {
      const params = new URLSearchParams({
        ...(branchId ? { branchId } : {}),
        ...(from ? { from: new Date(from).toISOString() } : {}),
        ...(to   ? { to:   new Date(`${to}T23:59:59`).toISOString() } : {}),
        kind,
      });
      return api.get(`/inventory/movements?${params}`).then((r) => r.data);
    },
    enabled: !!branchId,
    staleTime: 15_000,
  });

  // CSV export — done client-side for the current filtered view.
  function exportCsv() {
    const header = [
      'Date', 'Kind', 'Type', 'Item', 'Unit', 'Quantity',
      'Stock Before', 'Stock After', 'Value', 'Payment', 'Reference', 'Reason', 'Cashier',
    ];
    const rows = movements.map((m) => [
      new Date(m.occurredAt).toISOString().slice(0, 19).replace('T', ' '),
      m.kind === 'PRODUCT' ? 'Product' : 'Ingredient',
      TYPE_LABEL[m.type] ?? m.type,
      m.itemName,
      m.unit ?? '',
      m.quantity.toString(),
      m.quantityBefore?.toString() ?? '',
      m.quantityAfter?.toString() ?? '',
      m.totalValue != null ? m.totalValue.toFixed(2) : '',
      m.paymentMethod ? (PAYMENT_LABEL[m.paymentMethod] ?? m.paymentMethod) : '',
      m.reference ?? '',
      m.reason ?? '',
      m.createdByName ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-movements-${from}-to-${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const INPUT_CLS =
    'border border-border bg-background rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]';

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <div>
          <Link
            href="/pos/inventory"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
          >
            <ChevronLeft className="h-3 w-3" />
            Back to Ingredients
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Stock Movements</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every stock change in one place — sales, receipts, adjustments. Click any row for the underlying record.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={exportCsv}
            disabled={movements.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-border shrink-0 bg-muted/20">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT_CLS} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT_CLS} />
        </div>
        <div className="flex items-center gap-1">
          {(['ALL', 'PRODUCT', 'RAW_MATERIAL'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                kind === k
                  ? 'text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
              style={kind === k ? { background: 'var(--accent)' } : undefined}
            >
              {k === 'ALL' ? 'All' : k === 'PRODUCT' ? 'Products' : 'Ingredients'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground ml-auto">
          {movements.length} movement{movements.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Loading…
          </div>
        ) : movements.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
            <Package className="h-8 w-8 opacity-30" />
            <p>No stock movements in this range.</p>
          </div>
        ) : (
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-left font-semibold">Item</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-right font-semibold">Qty</th>
                <th className="px-4 py-3 text-right font-semibold">Stock After</th>
                <th className="px-4 py-3 text-right font-semibold">Value</th>
                <th className="px-4 py-3 text-left font-semibold">Reference</th>
                <th className="px-4 py-3 text-left font-semibold">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {movements.map((m) => {
                const isStockIn = m.quantity > 0;
                return (
                  <tr key={`${m.kind}-${m.id}`} className="hover:bg-muted/40 transition-colors">
                    {/* Date */}
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {new Date(m.occurredAt).toLocaleString('en-PH', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                        hour12: true, timeZone: 'Asia/Manila',
                      })}
                    </td>

                    {/* Item — name + kind icon */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {m.kind === 'PRODUCT' ? (
                          <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <FlaskConical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium text-foreground">{m.itemName}</span>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        m.type === 'SALE_DEDUCTION'
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : isStockIn
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'bg-red-500/10 text-red-600 dark:text-red-400'
                      }`}>
                        {m.type === 'SALE_DEDUCTION' ? (
                          <ShoppingCart className="h-2.5 w-2.5" />
                        ) : isStockIn ? (
                          <ArrowUpCircle className="h-2.5 w-2.5" />
                        ) : (
                          <ArrowDownCircle className="h-2.5 w-2.5" />
                        )}
                        {TYPE_LABEL[m.type] ?? m.type}
                      </span>
                    </td>

                    {/* Quantity (signed) */}
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold whitespace-nowrap ${
                      isStockIn ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      {isStockIn ? '+' : ''}{m.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      {m.unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{m.unit}</span>}
                    </td>

                    {/* Stock after */}
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums whitespace-nowrap">
                      {m.quantityAfter != null
                        ? m.quantityAfter.toLocaleString(undefined, { maximumFractionDigits: 4 })
                        : '—'}
                    </td>

                    {/* Value */}
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums whitespace-nowrap">
                      {m.totalValue != null && m.totalValue > 0 ? formatPeso(m.totalValue) : '—'}
                    </td>

                    {/* Reference (order # or supplier ref) */}
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {m.reference ?? '—'}
                      {m.paymentMethod && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">
                          · {PAYMENT_LABEL[m.paymentMethod] ?? m.paymentMethod}
                        </span>
                      )}
                      {m.reason && (
                        <p className="text-[10px] text-muted-foreground/70 italic mt-0.5 truncate max-w-[160px]">
                          {m.reason}
                        </p>
                      )}
                    </td>

                    {/* Created by */}
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {m.createdByName ?? <span className="opacity-50">system</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
