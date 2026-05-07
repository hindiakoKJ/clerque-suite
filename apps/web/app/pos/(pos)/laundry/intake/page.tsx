'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Trash2, Sparkles, Receipt, ShoppingBag,
  WashingMachine, Wind, Combine,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────
type ServiceCode = 'WASH' | 'DRY' | 'WASH_DRY_COMBO' | 'DRY_CLEAN' | 'IRON' | 'FOLD' | 'EXTRA_RINSE' | 'FABRIC_SOFTENER';
type ServiceMode = 'SELF_SERVICE' | 'FULL_SERVICE';

interface ServicePrice {
  serviceCode: ServiceCode;
  mode:        ServiceMode;
  unitPrice:   string;
  isActive:    boolean;
}

interface Branch   { id: string; name: string }
interface Customer { id: string; name: string; contactPhone: string | null }
interface Product  { id: string; name: string; sku: string | null; price: string }

interface ServiceLine {
  serviceCode: ServiceCode;
  mode:        ServiceMode;
  sets:        number;
  weightKg?:   number;
  notes?:      string;
}
interface ProductLine {
  productId: string;
  quantity:  number;
}

const SERVICE_LABEL: Record<ServiceCode, string> = {
  WASH:            'Wash',
  DRY:             'Dry',
  WASH_DRY_COMBO:  'Wash + Dry combo',
  DRY_CLEAN:       'Dry-clean',
  IRON:            'Iron',
  FOLD:            'Fold',
  EXTRA_RINSE:     'Extra rinse',
  FABRIC_SOFTENER: 'Fabric softener',
};

const SERVICE_ICON: Record<ServiceCode, any> = {
  WASH:            WashingMachine,
  DRY:             Wind,
  WASH_DRY_COMBO:  Combine,
  DRY_CLEAN:       Sparkles,
  IRON:            Sparkles,
  FOLD:            Sparkles,
  EXTRA_RINSE:     Sparkles,
  FABRIC_SOFTENER: Sparkles,
};

function fmtPeso(n: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);
}

// ─────────────────────────────────────────────────────────────────────────────
export default function LaundryIntakePage() {
  const router = useRouter();

  const { data: branchData } = useQuery<{ data: Branch[] }>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });
  const branches = branchData?.data ?? [];

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn:  () => api.get('/customers').then((r) => Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
  });

  const { data: prices = [] } = useQuery<ServicePrice[]>({
    queryKey: ['laundry-service-prices'],
    queryFn:  () => api.get('/laundry/service-prices').then((r) => r.data),
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['laundry-retail-products'],
    queryFn:  () => api.get('/products').then((r) => Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
  });

  // ── Form state ──────────────────────────────────────────────────────────
  const [branchId,    setBranchId]    = useState('');
  const [customerId,  setCustomerId]  = useState('');
  const [promisedAt,  setPromisedAt]  = useState('');
  const [notes,       setNotes]       = useState('');
  const [lines,       setLines]       = useState<ServiceLine[]>([]);
  const [productLines, setProductLines] = useState<ProductLine[]>([]);

  useEffect(() => {
    if (!branchId && branches.length > 0) setBranchId(branches[0].id);
  }, [branchId, branches]);

  // Price lookup
  const priceFor = (code: ServiceCode, mode: ServiceMode): number => {
    const row = prices.find((p) => p.serviceCode === code && p.mode === mode && p.isActive);
    return row ? Number(row.unitPrice) : 0;
  };
  const productPriceFor = (id: string): number => Number(products.find((p) => p.id === id)?.price ?? 0);

  // Live totals
  const { servicesSubtotal, productsSubtotal, total } = useMemo(() => {
    const svc = lines.reduce((s, l) => s + priceFor(l.serviceCode, l.mode) * l.sets, 0);
    const prd = productLines.reduce((s, l) => s + productPriceFor(l.productId) * l.quantity, 0);
    return {
      servicesSubtotal: Math.round(svc * 100) / 100,
      productsSubtotal: Math.round(prd * 100) / 100,
      total:            Math.round((svc + prd) * 100) / 100,
    };
  }, [lines, productLines, prices, products]);

  // ── Submit ──────────────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: () => api.post('/laundry/orders/v2', {
      branchId,
      customerId: customerId || undefined,
      promisedAt: promisedAt || undefined,
      notes:      notes || undefined,
      lines:      lines.map((l) => ({
        serviceCode: l.serviceCode,
        mode:        l.mode,
        sets:        l.sets,
        weightKg:    l.weightKg,
        notes:       l.notes,
      })),
      productLines: productLines.length ? productLines : undefined,
    }).then((r) => r.data),
    onSuccess: (order: { id: string; claimNumber: string }) => {
      toast.success(`Intake recorded — ${order.claimNumber}`);
      router.push(`/pos/laundry/${order.id}`);
    },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  // ── Line helpers ────────────────────────────────────────────────────────
  function addServiceLine(code: ServiceCode, mode: ServiceMode = 'SELF_SERVICE') {
    setLines([...lines, { serviceCode: code, mode, sets: 1 }]);
  }
  function patchLine(idx: number, p: Partial<ServiceLine>) {
    setLines(lines.map((l, i) => i === idx ? { ...l, ...p } : l));
  }
  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }

  function addProductLine() {
    setProductLines([...productLines, { productId: products[0]?.id ?? '', quantity: 1 }]);
  }
  function patchProductLine(idx: number, p: Partial<ProductLine>) {
    setProductLines(productLines.map((l, i) => i === idx ? { ...l, ...p } : l));
  }
  function removeProductLine(idx: number) {
    setProductLines(productLines.filter((_, i) => i !== idx));
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href="/pos/laundry/queue" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Queue
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-[var(--accent)]" />
          New Intake
        </h1>
        <p className="text-sm text-muted-foreground">Add service lines and retail items, then print the claim ticket.</p>
      </header>

      {/* Customer + branch */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <h2 className="text-sm font-semibold">Customer</h2>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="">— branch —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="">Walk-in (anonymous)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.contactPhone ? ` · ${c.contactPhone}` : ''}</option>
            ))}
          </select>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <h2 className="text-sm font-semibold">Pickup &amp; notes</h2>
          <input type="datetime-local" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Service lines */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Service lines</h2>
          <span className="text-xs text-muted-foreground">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
        </header>
        <div className="p-4">
          {/* Quick-add buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(['WASH', 'DRY', 'WASH_DRY_COMBO', 'DRY_CLEAN', 'IRON', 'FOLD'] as ServiceCode[]).map((code) => {
              const Icon = SERVICE_ICON[code];
              return (
                <button
                  key={code}
                  onClick={() => addServiceLine(code, code === 'DRY_CLEAN' || code === 'IRON' || code === 'FOLD' ? 'FULL_SERVICE' : 'SELF_SERVICE')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border hover:bg-muted px-3 py-1.5 text-xs font-medium"
                >
                  <Icon className="h-3.5 w-3.5 text-[var(--accent)]" />
                  + {SERVICE_LABEL[code]}
                </button>
              );
            })}
          </div>
          {lines.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No service lines yet — tap a button above.</p>
          )}
          <div className="space-y-2">
            {lines.map((l, idx) => {
              const unit = priceFor(l.serviceCode, l.mode);
              const lineTotal = Math.round(unit * l.sets * 100) / 100;
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center rounded-lg bg-muted/30 px-3 py-2">
                  <div className="col-span-3 flex items-center gap-2">
                    <select
                      value={l.serviceCode}
                      onChange={(e) => patchLine(idx, { serviceCode: e.target.value as ServiceCode })}
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      {(Object.keys(SERVICE_LABEL) as ServiceCode[]).map((c) => (
                        <option key={c} value={c}>{SERVICE_LABEL[c]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3 flex gap-1">
                    {(['SELF_SERVICE', 'FULL_SERVICE'] as ServiceMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => patchLine(idx, { mode: m })}
                        className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium border transition-colors ${
                          l.mode === m
                            ? 'bg-[var(--accent)] text-white border-transparent'
                            : 'bg-background border-border hover:bg-muted'
                        }`}
                      >
                        {m === 'SELF_SERVICE' ? 'Self' : 'Full'}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number" min={1}
                    value={l.sets}
                    onChange={(e) => patchLine(idx, { sets: Math.max(1, Number(e.target.value)) })}
                    className="col-span-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-center"
                    title="Sets"
                  />
                  <div className="col-span-2 text-xs text-muted-foreground tabular-nums">
                    @ {fmtPeso(unit)}/set
                  </div>
                  <div className="col-span-2 text-right font-semibold tabular-nums">{fmtPeso(lineTotal)}</div>
                  <button onClick={() => removeLine(idx)} className="col-span-1 text-red-500 hover:bg-red-500/10 rounded p-1.5 justify-self-end">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Retail product lines */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
            Retail items
          </h2>
          <button onClick={addProductLine} className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>
        </header>
        <div className="p-4 space-y-2">
          {productLines.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No retail items.</p>
          )}
          {productLines.map((p, idx) => {
            const unit = productPriceFor(p.productId);
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center rounded-lg bg-muted/30 px-3 py-2">
                <select
                  value={p.productId}
                  onChange={(e) => patchProductLine(idx, { productId: e.target.value })}
                  className="col-span-7 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {products.map((prod) => (
                    <option key={prod.id} value={prod.id}>
                      {prod.name} {prod.sku ? `· ${prod.sku}` : ''} — {fmtPeso(Number(prod.price))}
                    </option>
                  ))}
                </select>
                <input
                  type="number" min={1}
                  value={p.quantity}
                  onChange={(e) => patchProductLine(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                  className="col-span-2 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-center"
                  title="Qty"
                />
                <div className="col-span-2 text-right font-semibold tabular-nums">{fmtPeso(unit * p.quantity)}</div>
                <button onClick={() => removeProductLine(idx)} className="col-span-1 text-red-500 hover:bg-red-500/10 rounded p-1.5 justify-self-end">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Totals + submit */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Services subtotal</span>
          <span className="font-semibold tabular-nums">{fmtPeso(servicesSubtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Retail subtotal</span>
          <span className="font-semibold tabular-nums">{fmtPeso(productsSubtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-base pt-2 border-t border-border">
          <span className="font-semibold">Total (before promos)</span>
          <span className="text-xl font-bold tabular-nums">{fmtPeso(total)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground italic">
          Promos are evaluated automatically on save based on the line set + current time.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/pos/laundry/queue" className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</Link>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || !branchId || (lines.length === 0 && productLines.length === 0) || total <= 0}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            <Receipt className="h-4 w-4" />
            {create.isPending ? 'Saving…' : 'Record Intake'}
          </button>
        </div>
      </div>
    </div>
  );
}
