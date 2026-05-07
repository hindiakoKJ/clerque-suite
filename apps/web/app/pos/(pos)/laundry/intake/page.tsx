'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Sparkles, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Branch  { id: string; name: string }
interface Customer { id: string; name: string; contactPhone: string | null }

type ServiceType = 'WASH_FOLD' | 'WASH_ONLY' | 'DRY_ONLY' | 'DRY_CLEAN' | 'IRON_ONLY' | 'FULL_SERVICE';
type PricingMode = 'PER_KG' | 'PER_LOAD' | 'PER_PIECE' | 'PER_GARMENT';

interface IntakeItem {
  garmentType: string;
  quantity:    number;
  condition?:  string;
  tagNumber?:  string;
}

const SERVICE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'WASH_FOLD',    label: 'Wash & Fold' },
  { value: 'WASH_ONLY',    label: 'Wash Only' },
  { value: 'DRY_ONLY',     label: 'Dry Only' },
  { value: 'DRY_CLEAN',    label: 'Dry Clean' },
  { value: 'IRON_ONLY',    label: 'Iron Only' },
  { value: 'FULL_SERVICE', label: 'Full Service (wash + dry + fold + iron)' },
];

export default function LaundryIntakePage() {
  const router = useRouter();

  // Branches + customers come from existing endpoints.
  const { data: branchData } = useQuery<{ data: Branch[] }>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });
  const branches = branchData?.data ?? [];

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn:  () => api.get('/customers').then((r) => Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
  });

  // ── Form state ────────────────────────────────────────────────────────────
  const [branchId,    setBranchId]    = useState('');
  const [customerId,  setCustomerId]  = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('WASH_FOLD');
  const [pricingMode, setPricingMode] = useState<PricingMode>('PER_KG');
  const [weightKg,    setWeightKg]    = useState<string>('');
  const [loadCount,   setLoadCount]   = useState<string>('');
  const [pieceCount,  setPieceCount]  = useState<string>('');
  const [unitPrice,   setUnitPrice]   = useState<string>('60');
  const [promisedAt,  setPromisedAt]  = useState<string>('');
  const [notes,       setNotes]       = useState<string>('');
  const [items,       setItems]       = useState<IntakeItem[]>([]);

  // Default branch: first active. Run as effect — calling setState directly
  // during render triggers a "Cannot update during render" warning and can
  // loop on slow networks where branches arrives after the first paint.
  useEffect(() => {
    if (!branchId && branches.length > 0) setBranchId(branches[0].id);
  }, [branchId, branches]);

  // ── Live total preview ────────────────────────────────────────────────────
  const qty =
    pricingMode === 'PER_KG'   ? Number(weightKg) :
    pricingMode === 'PER_LOAD' ? Number(loadCount) :
                                  Number(pieceCount);
  const total = isFinite(qty) && isFinite(Number(unitPrice))
    ? Math.round(qty * Number(unitPrice) * 100) / 100
    : 0;

  // ── Submit ────────────────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: () =>
      api.post('/laundry/orders', {
        branchId,
        customerId: customerId || undefined,
        serviceType,
        pricingMode,
        weightKg:   pricingMode === 'PER_KG'   ? Number(weightKg)   : undefined,
        loadCount:  pricingMode === 'PER_LOAD' ? Number(loadCount)  : undefined,
        pieceCount: (pricingMode === 'PER_PIECE' || pricingMode === 'PER_GARMENT')
                    ? Number(pieceCount) : undefined,
        unitPrice:  Number(unitPrice),
        promisedAt: promisedAt || undefined,
        notes:      notes || undefined,
        items:      items.length > 0 ? items : undefined,
      }).then((r) => r.data),
    onSuccess: (order: { id: string; claimNumber: string }) => {
      toast.success(`Intake recorded — ${order.claimNumber}`);
      router.push(`/pos/laundry/${order.id}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to create intake.');
    },
  });

  function addItem() {
    setItems([...items, { garmentType: '', quantity: 1 }]);
  }
  function patchItem(idx: number, p: Partial<IntakeItem>) {
    setItems(items.map((it, i) => i === idx ? { ...it, ...p } : it));
  }
  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href="/pos/laundry/queue" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Queue
      </Link>
      <header>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-[var(--accent)]" />
          New Intake
        </h1>
        <p className="text-sm text-muted-foreground">Record a customer drop-off and print the claim ticket.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Branch + Customer */}
        <div className="space-y-3 p-4 rounded-xl border border-border bg-card">
          <h2 className="text-sm font-semibold">Customer</h2>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="">— Select branch —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="">Walk-in (anonymous)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.contactPhone ? ` · ${c.contactPhone}` : ''}</option>
            ))}
          </select>
        </div>

        {/* Service + pricing */}
        <div className="space-y-3 p-4 rounded-xl border border-border bg-card">
          <h2 className="text-sm font-semibold">Service & Price</h2>
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value as ServiceType)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
            {SERVICE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            {(['PER_KG', 'PER_LOAD', 'PER_PIECE'] as PricingMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPricingMode(m)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  pricingMode === m
                    ? 'bg-[var(--accent)] text-white border-transparent'
                    : 'bg-background border-border hover:bg-muted'
                }`}
              >
                {m === 'PER_KG' ? 'Per kg' : m === 'PER_LOAD' ? 'Per load' : 'Per piece'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {pricingMode === 'PER_KG' && (
              <input type="number" step="0.01" placeholder="Weight (kg)" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            )}
            {pricingMode === 'PER_LOAD' && (
              <input type="number" placeholder="Loads" value={loadCount} onChange={(e) => setLoadCount(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            )}
            {(pricingMode === 'PER_PIECE' || pricingMode === 'PER_GARMENT') && (
              <input type="number" placeholder="Pieces" value={pieceCount} onChange={(e) => setPieceCount(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            )}
            <input type="number" step="0.01" placeholder="Unit price ₱" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">{new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(total)}</span>
          </div>
        </div>
      </div>

      {/* Optional pickup time + notes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <label className="text-sm font-semibold">Promised pickup (optional)</label>
          <input type="datetime-local" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <label className="text-sm font-semibold">Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. fabric softener, fragile cycle" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Garment items */}
      <div className="p-4 rounded-xl border border-border bg-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Garments (optional checklist)</h2>
          <button type="button" onClick={addItem} className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>
        </div>
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Skip if you only count by weight or load.</p>
        )}
        {items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
            <input value={it.garmentType} onChange={(e) => patchItem(idx, { garmentType: e.target.value })} placeholder="Garment (e.g. shirt)" className="col-span-4 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
            <input type="number" value={it.quantity} onChange={(e) => patchItem(idx, { quantity: Number(e.target.value) })} placeholder="Qty" className="col-span-2 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
            <input value={it.condition ?? ''} onChange={(e) => patchItem(idx, { condition: e.target.value })} placeholder="Condition" className="col-span-3 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
            <input value={it.tagNumber ?? ''} onChange={(e) => patchItem(idx, { tagNumber: e.target.value })} placeholder="Tag #" className="col-span-2 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
            <button type="button" onClick={() => removeItem(idx)} className="col-span-1 text-red-500 hover:bg-red-500/10 rounded p-1.5">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end gap-2">
        <Link href="/pos/laundry/queue" className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted">Cancel</Link>
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending || !branchId || total <= 0}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          <Receipt className="h-4 w-4" />
          {create.isPending ? 'Saving…' : 'Record Intake'}
        </button>
      </div>
    </div>
  );
}
