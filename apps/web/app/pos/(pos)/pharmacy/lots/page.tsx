'use client';
/**
 * Pharmacy → Product Lots
 *
 * FDA-mandated lot/expiry tracking. Products are picked first (filter +
 * branch select), then we list available lots in FEFO order
 * (first-expiry-first-out). New lot button opens a modal to record a
 * receipt — typically tied to a supplier delivery.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pill, Plus, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Product { id: string; name: string; sku: string | null; isRxRequired: boolean; isControlledDrug: boolean }
interface Branch  { id: string; name: string }
interface Lot {
  id:           string;
  lotNumber:    string;
  expiresAt:    string;
  quantity:     string;
  costPrice:    string;
  receivedAt:   string;
  supplierRef:  string | null;
  isActive:     boolean;
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.floor(ms / 86_400_000);
}

export default function ProductLotsPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: products = [] }  = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn:  () => api.get('/products').then((r) => r.data),
  });
  const { data: branches = [] }  = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });

  const [productId, setProductId] = useState<string>('');
  const [branchId,  setBranchId]  = useState<string>('');
  const [showNew,   setShowNew]   = useState(false);

  const { data: lots = [], isFetching } = useQuery<Lot[]>({
    queryKey: ['pharmacy-lots', productId, branchId],
    queryFn:  () => api.get('/pharmacy/lots/available', {
      params: { productId, branchId },
    }).then((r) => r.data),
    enabled:  !!productId && !!branchId,
  });

  const product = products.find((p) => p.id === productId) ?? null;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-card border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Pill className="h-5 w-5 text-[var(--counter-primary)]" />
          <h1 className="font-display text-xl font-bold tracking-tight">Product Lots</h1>
          <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase font-mono-counter bg-[var(--counter-cream)] text-[var(--counter-ink)]">
            FEFO
          </span>
        </div>
        <button
          onClick={() => setShowNew(true)}
          disabled={!productId || !branchId}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Receive Lot
        </button>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Product</span>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">— select a product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.sku ? `(${p.sku})` : ''} {p.isControlledDrug ? '· DDB' : p.isRxRequired ? '· Rx' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Branch</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">— select a branch —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Lots — FEFO order from server */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {!productId || !branchId ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Select a product and branch to see available lots in FEFO order.
            </div>
          ) : isFetching ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : lots.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No active lots for this product at this branch.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b-2 border-border bg-muted/50">
                    <th className="px-4 py-3 font-bold">Lot #</th>
                    <th className="px-4 py-3 font-bold">Expires</th>
                    <th className="px-4 py-3 font-bold text-right">Qty on hand</th>
                    <th className="px-4 py-3 font-bold text-right">Cost / unit</th>
                    <th className="px-4 py-3 font-bold">Received</th>
                    <th className="px-4 py-3 font-bold">Supplier ref</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => {
                    const days = daysUntil(l.expiresAt);
                    // Counter expiry-tier chip palette: red <30d, amber 30-90d, green >90d.
                    const chipClass =
                      days < 0
                        ? 'bg-[var(--counter-error-soft)] text-[var(--counter-error-deep)]'
                        : days < 30
                          ? 'bg-[var(--counter-error-soft)] text-[var(--counter-error-deep)]'
                          : days < 90
                            ? 'bg-[var(--counter-warning-soft)] text-[var(--counter-warning-deep)]'
                            : 'bg-[var(--counter-success-soft)] text-[var(--counter-success-deep)]';
                    return (
                      <tr key={l.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono-counter text-xs font-bold">{l.lotNumber}</td>
                        <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                          <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold tnum ' + chipClass}>
                            {days < 30 ? <AlertTriangle className="h-3 w-3" /> : null}
                            {new Date(l.expiresAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                            <span className="opacity-80">·</span>
                            {days < 0 ? `expired ${-days}d` : `${days}d`}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-counter tnum font-semibold">{Number(l.quantity).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right font-mono-counter tnum text-muted-foreground">₱{Number(l.costPrice).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap tnum">
                          {new Date(l.receivedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono-counter text-muted-foreground">{l.supplierRef ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showNew && product && (
        <NewLotModal
          product={product}
          branchId={branchId}
          onClose={() => setShowNew(false)}
          onSuccess={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ['pharmacy-lots'] });
          }}
        />
      )}
    </div>
  );
}

function NewLotModal({ product, branchId, onClose, onSuccess }: {
  product: Product; branchId: string;
  onClose: () => void; onSuccess: () => void;
}) {
  const [lotNumber,   setLotNumber]   = useState('');
  const [expiresAt,   setExpiresAt]   = useState('');
  const [quantity,    setQuantity]    = useState('');
  const [costPrice,   setCostPrice]   = useState('');
  const [supplierRef, setSupplierRef] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/pharmacy/lots', {
      productId:   product.id,
      branchId,
      lotNumber:   lotNumber.trim(),
      expiresAt:   new Date(expiresAt).toISOString(),
      quantity:    Number(quantity),
      costPrice:   Number(costPrice),
      supplierRef: supplierRef.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: () => { toast.success('Lot received.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">Receive Lot</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{product.name}</p>
        </header>

        <div className="p-5 space-y-3">
          <Field label="Lot number *" v={lotNumber} on={setLotNumber} mono />
          <Field label="Expiry date *" v={expiresAt} on={setExpiresAt} type="date" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity *" v={quantity} on={setQuantity} type="number" />
            <Field label="Cost / unit (₱) *" v={costPrice} on={setCostPrice} type="number" />
          </div>
          <Field label="Supplier reference" v={supplierRef} on={setSupplierRef} placeholder="DR / PO number" mono />
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !lotNumber || !expiresAt || !quantity || !costPrice}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Receive Lot'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, v, on, type = 'text', placeholder, mono }: {
  label: string; v: string; on: (v: string) => void;
  type?: string; placeholder?: string; mono?: boolean;
}) {
  return (
    <label className="text-sm block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => on(e.target.value)}
        placeholder={placeholder}
        className={'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ' + (mono ? 'font-mono' : '')}
      />
    </label>
  );
}
