'use client';
/**
 * Sprint 19 — Cross-branch inventory dashboard (owner-only).
 *
 * Answers the owner's "what do I have where" question without forcing them
 * to switch branches one at a time. One row per product; columns for each
 * branch's quantity. Lot expiry rolled up into per-product earliest-expiry
 * + count of lots expiring within 90 days (red badge).
 *
 * Per-row "Transfer" button → POST /inventory/transfer-product. One-shot
 * decrement source + increment destination + WAC re-blend, atomic.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Search, ArrowRightLeft, X, AlertTriangle, Calendar, Pill, Package,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface Branch { id: string; name: string }

interface Row {
  productId:        string;
  name:             string;
  sku:              string | null;
  genericName:      string | null;
  brandName:        string | null;
  drugClass:        string | null;
  isRxRequired:     boolean | null;
  isControlledDrug: boolean | null;
  uom:              string | null;
  totalQty:         number;
  quantitiesByBranch: Record<string, { qty: number; threshold: number | null }>;
  earliestExpiry:   string | null;
  expiringSoon:     number;
  expired:          number;
  lots: Array<{ branchId: string; lotNumber: string; expiresAt: string; quantity: number }>;
}

interface Summary { branches: Branch[]; rows: Row[] }

export default function CrossBranchInventoryPage() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);
  const qc     = useQueryClient();

  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (user && !isOwner) router.replace('/pos/dashboard');
  }, [user, isOwner, router]);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<Summary>({
    queryKey: ['cross-branch-inventory', debounced],
    queryFn:  () => api.get(`/inventory/cross-branch${debounced ? `?search=${encodeURIComponent(debounced)}` : ''}`).then((r) => r.data),
    enabled:  !!user && isOwner,
  });

  const [transferRow, setTransferRow] = useState<Row | null>(null);

  if (!isOwner) return null;

  const branches = data?.branches ?? [];
  const rows     = data?.rows     ?? [];

  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-5">
      <button
        onClick={() => router.push('/pos/dashboard')}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Package className="h-6 w-6 text-[var(--accent)]" />
          Cross-Branch Inventory
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Live view of every product across every branch. Click <strong>Transfer</strong> on a row to
          move stock between branches in one shot — decrements source, increments destination, with
          full audit trail.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, generic, brand, SKU, or barcode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 h-10 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No products match your search.
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
                <th className="text-left px-3 py-2 sticky left-0 bg-muted/50 z-10">Product</th>
                <th className="text-left px-3 py-2">Class</th>
                {branches.map((b) => (
                  <th key={b.id} className="text-right px-3 py-2 whitespace-nowrap">
                    {b.name}
                  </th>
                ))}
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Expiry</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const earliestExpiryDate = r.earliestExpiry ? new Date(r.earliestExpiry) : null;
                return (
                  <tr key={r.productId} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-2 sticky left-0 bg-card z-10">
                      <div className="font-medium">{r.name}</div>
                      {(r.genericName || r.brandName) && (
                        <div className="text-xs text-muted-foreground">
                          {[r.brandName, r.genericName].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {r.sku && <div className="text-[10px] text-muted-foreground font-mono">SKU: {r.sku}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {r.drugClass && (
                        <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          r.drugClass === 'OTC'      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' :
                          r.drugClass === 'RX_ONLY'  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400' :
                          r.drugClass.startsWith('DDB') ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {r.drugClass.replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    {branches.map((b) => {
                      const cell = r.quantitiesByBranch[b.id];
                      const qty  = cell?.qty ?? 0;
                      const threshold = cell?.threshold ?? null;
                      const isLow = threshold != null && qty <= threshold && qty > 0;
                      const isOut = qty === 0;
                      return (
                        <td key={b.id} className={`px-3 py-2 text-right tabular-nums ${
                          isOut ? 'text-muted-foreground' :
                          isLow ? 'text-amber-700 dark:text-amber-400 font-medium' :
                          ''
                        }`}>
                          {cell ? qty : '—'}
                          {r.uom && cell ? ` ${r.uom}` : ''}
                          {isLow && <span className="ml-1 text-[9px]">LOW</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {r.totalQty}{r.uom ? ` ${r.uom}` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.expired > 0 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400 mr-1">
                          <AlertTriangle className="h-3 w-3" />
                          {r.expired} expired
                        </span>
                      )}
                      {r.expiringSoon > 0 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 mr-1">
                          <Calendar className="h-3 w-3" />
                          {r.expiringSoon} &lt;90d
                        </span>
                      )}
                      {!r.expired && !r.expiringSoon && earliestExpiryDate && (
                        <span className="text-muted-foreground">
                          earliest: {earliestExpiryDate.toLocaleDateString()}
                        </span>
                      )}
                      {!earliestExpiryDate && <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setTransferRow(r)}
                        disabled={r.totalQty <= 0 || branches.length < 2}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                        title={branches.length < 2 ? 'Need at least 2 branches to transfer' : 'Transfer between branches'}
                      >
                        <ArrowRightLeft className="h-3 w-3" />
                        Transfer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {transferRow && (
        <TransferModal
          row={transferRow}
          branches={branches}
          onClose={() => setTransferRow(null)}
          onDone={() => {
            setTransferRow(null);
            qc.invalidateQueries({ queryKey: ['cross-branch-inventory'] });
          }}
        />
      )}
    </div>
  );
}

// ── Transfer modal ─────────────────────────────────────────────────────

function TransferModal({
  row, branches, onClose, onDone,
}: { row: Row; branches: Branch[]; onClose: () => void; onDone: () => void }) {
  // Default source = the branch with the most stock; default destination = anything else.
  const branchesWithStock = branches.filter((b) => (row.quantitiesByBranch[b.id]?.qty ?? 0) > 0);
  const initialFrom = branchesWithStock.sort((a, b) =>
    (row.quantitiesByBranch[b.id]?.qty ?? 0) - (row.quantitiesByBranch[a.id]?.qty ?? 0)
  )[0]?.id ?? '';
  const initialTo = branches.find((b) => b.id !== initialFrom)?.id ?? '';

  const [fromBranchId, setFromBranchId] = useState(initialFrom);
  const [toBranchId,   setToBranchId]   = useState(initialTo);
  const [quantity,     setQuantity]     = useState('1');
  const [notes,        setNotes]        = useState('');

  const sourceQty = row.quantitiesByBranch[fromBranchId]?.qty ?? 0;
  const qtyNum    = parseFloat(quantity) || 0;
  const overage   = qtyNum > sourceQty;
  const sameBranch = fromBranchId === toBranchId;

  const transferMut = useMutation({
    mutationFn: () => api.post('/inventory/transfer-product', {
      fromBranchId,
      toBranchId,
      productId: row.productId,
      quantity:  qtyNum,
      notes:     notes.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(`Transferred ${data.quantity} ${row.name} from ${data.fromBranchName} to ${data.toBranchName}.`);
      onDone();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : (msg ?? 'Transfer failed.'));
    },
  });

  const inputCls = 'w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-card border border-border p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-base flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-[var(--accent)]" />
              Transfer {row.name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {row.brandName ?? row.genericName ?? row.name}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">From branch</span>
          <select className={inputCls} value={fromBranchId} onChange={(e) => setFromBranchId(e.target.value)}>
            {branches.map((b) => {
              const qty = row.quantitiesByBranch[b.id]?.qty ?? 0;
              return (
                <option key={b.id} value={b.id} disabled={qty <= 0}>
                  {b.name} {qty > 0 ? `(${qty} ${row.uom ?? 'units'})` : '— no stock'}
                </option>
              );
            })}
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">To branch</span>
          <select className={inputCls} value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id} disabled={b.id === fromBranchId}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Quantity {row.uom ? `(${row.uom})` : ''}
          </span>
          <input
            type="number" min={0.001} step="0.001"
            className={inputCls}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <span className={`text-[11px] mt-1 inline-block ${overage ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
            Available at source: {sourceQty}{row.uom ? ` ${row.uom}` : ''}
            {overage && ` — exceeds by ${(qtyNum - sourceQty).toFixed(3)}`}
          </span>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Notes (optional)</span>
          <input
            className={inputCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. low stock at Front desk; rebalance"
          />
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            disabled={transferMut.isPending}
          >
            Cancel
          </button>
          <button
            onClick={() => transferMut.mutate()}
            disabled={transferMut.isPending || sameBranch || qtyNum <= 0 || overage}
            className="rounded-lg bg-[var(--accent)] text-white text-sm px-4 py-2 hover:opacity-90 disabled:opacity-40"
          >
            {transferMut.isPending ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
