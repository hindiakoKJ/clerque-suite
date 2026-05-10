'use client';
/**
 * Sprint 19 — Supplier delivery receiving.
 *
 * Pharmacies receive stock from distributors (Mercury, Watsons-DSI, Zuellig,
 * Pharma) and need to log it with lot + expiry per item → posts to
 * ProductLot + InventoryItem atomically.
 *
 * The optional AP bill link is left for a later step — the owner posts the
 * supplier's bill from /ledger/ap/bills and (in a future sprint) ties it
 * back. For now, this page is the inventory side: receive, capture lot +
 * expiry, increment stock, done.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Truck, Package, X, Loader2, AlertTriangle, Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface Vendor   { id: string; name: string }
interface Branch   { id: string; name: string }
interface Product  { id: string; name: string; genericName?: string | null; brandName?: string | null }
interface ReceiptItem {
  id: string; productId: string; lotNumber: string; expiresAt: string;
  quantity: number | string; costPrice: number | string;
  product?: { id: string; name: string };
}
interface Receipt {
  id: string;
  drNumber: string;
  receivedAt: string;
  notes: string | null;
  vendor: Vendor;
  branch: Branch;
  items: ReceiptItem[];
}

export default function DeliveryReceiptsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const { data: receipts = [], isLoading } = useQuery<Receipt[]>({
    queryKey: ['delivery-receipts'],
    queryFn:  () => api.get('/pharmacy/deliveries').then((r) => r.data),
    enabled:  !!user,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <button
        onClick={() => router.push('/pos/dashboard')}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Truck className="h-6 w-6 text-[var(--accent)]" />
            Supplier Deliveries
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Log incoming stock from distributors. Each line creates a Product Lot (FDA
            Circular 13-2014 trail) and increments inventory at the receiving branch.
            Post the supplier&apos;s bill in <Link href="/ledger/ap/bills" className="underline">Ledger → AP</Link> when ready.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New delivery
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : receipts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Truck className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No deliveries logged yet.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Received</th>
                <th className="text-left px-4 py-2">Vendor</th>
                <th className="text-left px-4 py-2">DR #</th>
                <th className="text-left px-4 py-2">Branch</th>
                <th className="text-right px-4 py-2">Lines</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border hover:bg-muted/40 cursor-pointer"
                  onClick={() => setOpenReceipt(r)}
                >
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(r.receivedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 font-medium">{r.vendor.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.drNumber}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.branch.name}</td>
                  <td className="px-4 py-3 text-right">{r.items.length}</td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">View →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateDeliveryModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['delivery-receipts'] });
          }}
        />
      )}

      {openReceipt && (
        <ReceiptDetailModal receipt={openReceipt} onClose={() => setOpenReceipt(null)} />
      )}
    </div>
  );
}

// ── Create modal ─────────────────────────────────────────────────────────

interface DraftLine {
  key:        string;
  productId:  string;
  productLabel: string; // for display when picked
  lotNumber:  string;
  expiresAt:  string;
  quantity:   string;
  costPrice:  string;
}

function CreateDeliveryModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
  const { data: vendors = [] }  = useQuery<Vendor[]>({
    queryKey: ['vendors'],
    queryFn: () => api.get('/ap/vendors').then((r) => r.data),
  });
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/users/branches').then((r) => r.data),
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: () => api.get('/products?includeInactive=false').then((r) => r.data),
  });

  const [vendorId, setVendorId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [drNumber, setDrNumber] = useState('');
  const [notes,    setNotes]    = useState('');
  const [lines,    setLines]    = useState<DraftLine[]>([
    { key: '1', productId: '', productLabel: '', lotNumber: '', expiresAt: '', quantity: '', costPrice: '' },
  ]);

  // Auto-pick branch when there's only one (single-branch tenant)
  useEffect(() => {
    if (!branchId && branches.length === 1) setBranchId(branches[0].id);
  }, [branches, branchId]);

  function setLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: String(Date.now()), productId: '', productLabel: '', lotNumber: '', expiresAt: '', quantity: '', costPrice: '' },
    ]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const totalCost = lines.reduce((sum, l) => {
    const q = parseFloat(l.quantity);
    const c = parseFloat(l.costPrice);
    return sum + (isNaN(q) || isNaN(c) ? 0 : q * c);
  }, 0);

  const createMut = useMutation({
    mutationFn: () => api.post('/pharmacy/deliveries', {
      vendorId,
      branchId,
      drNumber: drNumber.trim(),
      notes:    notes.trim() || undefined,
      items: lines
        .filter((l) => l.productId && l.lotNumber.trim() && l.quantity && l.costPrice)
        .map((l) => ({
          productId: l.productId,
          lotNumber: l.lotNumber.trim(),
          expiresAt: l.expiresAt,
          quantity:  parseFloat(l.quantity),
          costPrice: parseFloat(l.costPrice),
        })),
    }).then((r) => r.data),
    onSuccess: () => {
      toast.success(`Delivery posted. Inventory + lots updated.`);
      onCreated();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : (msg ?? 'Failed to post delivery.'));
    },
  });

  const canSubmit =
    !!vendorId && !!branchId && drNumber.trim().length >= 1 &&
    lines.some((l) => l.productId && l.lotNumber.trim() && l.expiresAt && l.quantity && l.costPrice);

  const inputCls = 'w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-card border border-border p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-base flex items-center gap-2">
              <Truck className="h-5 w-5 text-[var(--accent)]" />
              New supplier delivery
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each line creates a lot + adds to inventory.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Vendor</span>
            <select className={inputCls} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Select vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Branch</span>
            <select className={inputCls} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">DR #</span>
            <input
              className={inputCls}
              value={drNumber}
              onChange={(e) => setDrNumber(e.target.value)}
              placeholder="e.g. DR-2026-1234"
            />
          </label>
        </div>

        {/* Line items */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="bg-muted/40 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground grid grid-cols-12 gap-2">
            <span className="col-span-3">Product</span>
            <span className="col-span-2">Lot #</span>
            <span className="col-span-2">Expiry</span>
            <span className="col-span-1 text-right">Qty</span>
            <span className="col-span-2 text-right">Cost ₱</span>
            <span className="col-span-1 text-right">Subtotal</span>
            <span className="col-span-1"></span>
          </div>
          {lines.map((l) => {
            const subtotal = (parseFloat(l.quantity) || 0) * (parseFloat(l.costPrice) || 0);
            return (
              <div key={l.key} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-border items-center">
                <select
                  className={`${inputCls} col-span-3`}
                  value={l.productId}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    setLine(l.key, { productId: e.target.value, productLabel: p?.name ?? '' });
                  }}
                >
                  <option value="">Pick product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.genericName ? ` (${p.genericName})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  className={`${inputCls} col-span-2`}
                  placeholder="LOT-…"
                  value={l.lotNumber}
                  onChange={(e) => setLine(l.key, { lotNumber: e.target.value })}
                />
                <input
                  type="date"
                  className={`${inputCls} col-span-2`}
                  value={l.expiresAt}
                  onChange={(e) => setLine(l.key, { expiresAt: e.target.value })}
                />
                <input
                  type="number" min={0} step="0.001"
                  className={`${inputCls} col-span-1 text-right`}
                  value={l.quantity}
                  onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                />
                <input
                  type="number" min={0} step="0.01"
                  className={`${inputCls} col-span-2 text-right`}
                  value={l.costPrice}
                  onChange={(e) => setLine(l.key, { costPrice: e.target.value })}
                />
                <div className="col-span-1 text-right text-sm tabular-nums">
                  ₱{subtotal.toFixed(2)}
                </div>
                <button
                  onClick={() => removeLine(l.key)}
                  disabled={lines.length === 1}
                  className="col-span-1 p-1 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 transition-colors"
                  title="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          <div className="px-3 py-2 border-t border-border flex items-center justify-between">
            <button
              onClick={addLine}
              className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add line
            </button>
            <div className="text-sm text-muted-foreground">
              Total cost: <strong className="text-foreground">₱{totalCost.toFixed(2)}</strong>
            </div>
          </div>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Notes (optional)</span>
          <input
            className={inputCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. partial delivery — balance follows next week"
          />
        </label>

        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            Posting creates / updates Product Lots and increments inventory at the selected
            branch. To record the supplier&apos;s liability, post the AP bill from
            <Link href="/ledger/ap/bills" className="underline ml-1">Ledger → AP</Link> after.
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            disabled={createMut.isPending}
          >
            Cancel
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!canSubmit || createMut.isPending}
            className="rounded-lg bg-[var(--accent)] text-white text-sm px-4 py-2 hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {createMut.isPending ? 'Posting…' : 'Post delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail modal ────────────────────────────────────────────────────────

function ReceiptDetailModal({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const total = receipt.items.reduce(
    (sum, l) => sum + Number(l.quantity) * Number(l.costPrice),
    0,
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-border p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-base flex items-center gap-2">
              <Package className="h-5 w-5 text-[var(--accent)]" />
              Delivery from {receipt.vendor.name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              DR# {receipt.drNumber} · received {new Date(receipt.receivedAt).toLocaleString()} · {receipt.branch.name}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-1.5">Product</th>
                <th className="text-left px-3 py-1.5">Lot</th>
                <th className="text-left px-3 py-1.5">Expires</th>
                <th className="text-right px-3 py-1.5">Qty</th>
                <th className="text-right px-3 py-1.5">Cost</th>
                <th className="text-right px-3 py-1.5">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((it) => (
                <tr key={it.id} className="border-t border-border">
                  <td className="px-3 py-1.5">{it.product?.name ?? it.productId}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{it.lotNumber}</td>
                  <td className="px-3 py-1.5">{new Date(it.expiresAt).toLocaleDateString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">₱{Number(it.costPrice).toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    ₱{(Number(it.quantity) * Number(it.costPrice)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/40">
                <td colSpan={5} className="px-3 py-1.5 text-right font-semibold">Total</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">₱{total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {receipt.notes && (
          <p className="text-xs text-muted-foreground">{receipt.notes}</p>
        )}
      </div>
    </div>
  );
}
