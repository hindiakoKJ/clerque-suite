'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Trash2, Sparkles, Receipt, ShoppingBag,
  WashingMachine, Wind, Combine, UserPlus, Truck,
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

interface AddOn {
  id: string; code: string; name: string;
  kind: 'SURCHARGE' | 'FLAT_FEE';
  amount: string; priority: number;
  defaultOn: boolean; isActive: boolean;
}

interface Branch   { id: string; name: string }
interface Customer {
  id:             string;
  name:           string;
  contactPhone:   string | null;
  defaultAddress?:string | null;
  loyaltyVisits?: number;
}
interface Product  { id: string; name: string; sku: string | null; price: string }
interface Machine  {
  id:       string;
  code:     string;
  kind:     'WASHER' | 'DRYER' | 'COMBO';
  status:   'IDLE' | 'RUNNING' | 'OUT_OF_ORDER';
  branchId: string;
}

interface ServiceLine {
  serviceCode: ServiceCode;
  mode:        ServiceMode;
  sets:        number;
  weightKg?:   number;
  notes?:      string;
  addOnIds:    string[];
  /** Sprint 14 — optional machine pre-assigned at intake time. */
  machineId?:  string;
}

/** Map service codes to compatible machine kinds. Mirrors the backend
 *  validation in laundry.service.ts createOrderV2. Services not in the map
 *  don't run on a machine (DRY_CLEAN / IRON / FOLD / etc.) */
const MACHINE_KINDS_FOR_SERVICE: Partial<Record<ServiceCode, Array<Machine['kind']>>> = {
  WASH:           ['WASHER', 'COMBO'],
  DRY:            ['DRYER',  'COMBO'],
  WASH_DRY_COMBO: ['COMBO'],
};
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

  // /tenant/branches returns Branch[] directly. Earlier this was wrapped as
  // `{ data: Branch[] }` and `branchData?.data` was always undefined, leaving
  // branches=[] and Record Intake disabled because branchId never resolved.
  // Reads either shape defensively (mirrors the fix already applied in the
  // Add Machine modal under settings/laundry).
  const { data: branchesRaw = [] } = useQuery<Branch[]>({
    queryKey: ['tenant-branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) =>
      Array.isArray(r.data) ? r.data : (r.data?.data ?? []),
    ),
  });
  const branches = branchesRaw.filter((b) => (b as { isActive?: boolean }).isActive !== false);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn:  () => api.get('/customers').then((r) => Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
  });

  const { data: prices = [] } = useQuery<ServicePrice[]>({
    queryKey: ['laundry-service-prices'],
    queryFn:  () => api.get('/laundry/service-prices').then((r) => r.data),
  });

  const { data: addons = [] } = useQuery<AddOn[]>({
    queryKey: ['laundry-addons'],
    queryFn:  () => api.get('/laundry/addons').then((r) => r.data),
  });
  const addOnById = useMemo(() => new Map(addons.map((a) => [a.id, a])), [addons]);

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['laundry-retail-products'],
    queryFn:  () => api.get('/products').then((r) => Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
  });

  // Machines — fetched fresh every intake render so the IDLE filter
  // reflects current state. 30s stale time is enough; the cashier won't
  // sit on the form longer than that for a typical walk-in.
  const { data: machines = [] } = useQuery<Machine[]>({
    queryKey: ['laundry-machines-intake'],
    queryFn:  () => api.get('/laundry/machines').then((r) => Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
    staleTime: 30_000,
  });

  // ── Form state ──────────────────────────────────────────────────────────
  const [branchId,    setBranchId]    = useState('');
  const [customerId,  setCustomerId]  = useState('');
  const [promisedAt,  setPromisedAt]  = useState('');
  const [notes,       setNotes]       = useState('');
  const [lines,       setLines]       = useState<ServiceLine[]>([]);
  const [productLines, setProductLines] = useState<ProductLine[]>([]);

  // Sprint 11 — delivery + customer creation
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer,     setNewCustomer]     = useState({ name: '', phone: '', defaultAddress: '' });
  const [isDelivery,      setIsDelivery]      = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryFee,     setDeliveryFee]     = useState<string>('');

  // Sprint 19 — Payment-at-intake. The "Pay Now" button records intake +
  // payment in one flow; "Record Intake" alone leaves payment to be
  // collected later via /pos/laundry/[id]. Pay-now state holds the
  // already-created laundry order so we can call /pay against it after
  // the cashier confirms method + tendered.
  const [showPay,        setShowPay]        = useState(false);
  const [payMethod,      setPayMethod]      = useState<'CASH' | 'GCASH' | 'CARD'>('CASH');
  const [tendered,       setTendered]       = useState<string>('');
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

  const qc = useQueryClient();

  // When the picker selects a customer with a saved default address, prefill
  // the delivery field. Operator can still override per ticket.
  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;
  useEffect(() => {
    if (isDelivery && selectedCustomer?.defaultAddress && !deliveryAddress) {
      setDeliveryAddress(selectedCustomer.defaultAddress);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDelivery, selectedCustomer?.id]);

  const createCustomer = useMutation({
    mutationFn: (body: { name: string; contactPhone?: string; defaultAddress?: string }) =>
      api.post('/customers', body).then((r) => r.data),
    onSuccess: (c: Customer) => {
      toast.success('Customer added');
      qc.invalidateQueries({ queryKey: ['customers'] });
      setShowNewCustomer(false);
      setNewCustomer({ name: '', phone: '', defaultAddress: '' });
      setCustomerId(c.id);
      if (isDelivery && c.defaultAddress) setDeliveryAddress(c.defaultAddress);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add customer'),
  });

  useEffect(() => {
    if (!branchId && branches.length > 0) setBranchId(branches[0].id);
  }, [branchId, branches]);

  // Clear any pre-assigned machineId on a line when the branch changes —
  // a machine assignment is meaningless cross-branch and the backend
  // rejects it anyway. Keep the dropdown UX self-correcting.
  useEffect(() => {
    setLines((prev) => prev.map((l) => {
      if (!l.machineId) return l;
      const m = machines.find((mm) => mm.id === l.machineId);
      return m && m.branchId === branchId ? l : { ...l, machineId: undefined };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // Price lookup
  const priceFor = (code: ServiceCode, mode: ServiceMode): number => {
    const row = prices.find((p) => p.serviceCode === code && p.mode === mode && p.isActive);
    return row ? Number(row.unitPrice) : 0;
  };
  const productPriceFor = (id: string): number => Number(products.find((p) => p.id === id)?.price ?? 0);

  // Compute one line's total including add-ons (matches backend logic).
  function computeLineTotal(l: ServiceLine): number {
    const base = priceFor(l.serviceCode, l.mode) * l.sets;
    const addOnContrib = l.addOnIds.reduce((s, id) => {
      const a = addOnById.get(id);
      if (!a) return s;
      const per = Number(a.amount);
      return s + (a.kind === 'FLAT_FEE' ? per : per * l.sets);
    }, 0);
    return Math.round((base + addOnContrib) * 100) / 100;
  }

  // Live totals
  const { servicesSubtotal, productsSubtotal, total } = useMemo(() => {
    const svc = lines.reduce((s, l) => s + computeLineTotal(l), 0);
    const prd = productLines.reduce((s, l) => s + productPriceFor(l.productId) * l.quantity, 0);
    return {
      servicesSubtotal: Math.round(svc * 100) / 100,
      productsSubtotal: Math.round(prd * 100) / 100,
      total:            Math.round((svc + prd) * 100) / 100,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, productLines, prices, products, addons]);

  // ── Submit ──────────────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: () => api.post('/laundry/orders/v2', {
      branchId,
      customerId: customerId || undefined,
      promisedAt: promisedAt || undefined,
      notes:      notes || undefined,
      // Sprint 11 — delivery support. Walk-in tickets keep these flat off.
      isDelivery,
      deliveryAddress: isDelivery ? (deliveryAddress.trim() || undefined) : undefined,
      deliveryFee:     isDelivery && deliveryFee
                          ? Number(deliveryFee)
                          : undefined,
      lines:      lines.map((l) => ({
        serviceCode: l.serviceCode,
        mode:        l.mode,
        sets:        l.sets,
        weightKg:    l.weightKg,
        notes:       l.notes,
        addOnIds:    l.addOnIds,
        // Optional machine assignment at intake. Backend validates kind +
        // IDLE + branch and flips the machine to RUNNING.
        machineId:   l.machineId || undefined,
      })),
      productLines: productLines.length ? productLines : undefined,
    }).then((r) => r.data),
    onSuccess: (order: { id: string; claimNumber: string }) => {
      toast.success(`Intake recorded — ${order.claimNumber}`);
      router.push(`/pos/laundry/${order.id}`);
    },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  // Sprint 19 — "Record + Pay Now" path. Same body as `create`, but on
  // success we open the payment modal rather than navigating away.
  const createForPay = useMutation({
    mutationFn: () => api.post('/laundry/orders/v2', {
      branchId,
      customerId: customerId || undefined,
      promisedAt: promisedAt || undefined,
      notes:      notes || undefined,
      isDelivery,
      deliveryAddress: isDelivery ? (deliveryAddress.trim() || undefined) : undefined,
      deliveryFee:     isDelivery && deliveryFee ? Number(deliveryFee) : undefined,
      lines:      lines.map((l) => ({
        serviceCode: l.serviceCode, mode: l.mode, sets: l.sets,
        weightKg: l.weightKg, notes: l.notes, addOnIds: l.addOnIds,
        machineId: l.machineId || undefined,
      })),
      productLines: productLines.length ? productLines : undefined,
    }).then((r) => r.data),
    onSuccess: (order: { id: string; claimNumber: string }) => {
      setPendingOrderId(order.id);
      setTendered(String(total.toFixed(2)));
      setPayMethod('CASH');
      setShowPay(true);
      // Toast deferred until payment lands.
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const payNow = useMutation({
    mutationFn: () => {
      if (!pendingOrderId) throw new Error('No pending order.');
      // UI labels (CASH/GCASH/CARD) → backend PaymentMethod enum.
      const apiMethod: 'CASH' | 'GCASH_PERSONAL' | 'QR_PH' =
        payMethod === 'GCASH' ? 'GCASH_PERSONAL' :
        payMethod === 'CARD'  ? 'QR_PH' :
        'CASH';
      return api.post(`/laundry/orders/${pendingOrderId}/pay`, {
        method:    apiMethod,
        tendered:  payMethod === 'CASH' ? Math.max(Number(tendered) || 0, total) : undefined,
      }).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success('Paid. Receipt is ready.');
      const id = pendingOrderId!;
      setShowPay(false);
      setPendingOrderId(null);
      qc.invalidateQueries({ queryKey: ['laundry-orders'] });
      router.push(`/pos/laundry/${id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Payment failed.'),
  });

  // ── Line helpers ────────────────────────────────────────────────────────
  function addServiceLine(code: ServiceCode, mode: ServiceMode = 'SELF_SERVICE') {
    // Pre-select any add-ons flagged defaultOn=true.
    const defaultAddOnIds = addons.filter((a) => a.defaultOn && a.isActive).map((a) => a.id);
    setLines([...lines, { serviceCode: code, mode, sets: 1, addOnIds: defaultAddOnIds }]);
  }
  function toggleLineAddOn(idx: number, addOnId: string) {
    setLines(lines.map((l, i) => {
      if (i !== idx) return l;
      const has = l.addOnIds.includes(addOnId);
      return { ...l, addOnIds: has ? l.addOnIds.filter((x) => x !== addOnId) : [...l.addOnIds, addOnId] };
    }));
  }
  function patchLine(idx: number, p: Partial<ServiceLine>) {
    setLines(lines.map((l, i) => i === idx ? { ...l, ...p } : l));
  }
  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }

  function addProductLine() {
    // Sprint 12 fix — only add a line when we have a product to default to.
    // Previously, clicking "+ Add item" before /products finished loading
    // created a line with productId=''. The native select then displayed
    // its first option (e.g. "Water") because no matching option existed,
    // but React state stayed ''. productPriceFor('') returns 0, so the
    // line total + retail subtotal both showed ₱0.00.
    if (products.length === 0) {
      toast.error('No retail products yet — create one under Products first.');
      return;
    }
    setProductLines([...productLines, { productId: products[0].id, quantity: 1 }]);
  }
  function patchProductLine(idx: number, p: Partial<ProductLine>) {
    setProductLines(productLines.map((l, i) => i === idx ? { ...l, ...p } : l));
  }
  function removeProductLine(idx: number) {
    setProductLines(productLines.filter((_, i) => i !== idx));
  }

  // Sprint 12 fix — when /products finishes loading after the user has
  // already added retail lines (rare but possible: slow network, lines
  // restored from a draft), backfill any line with an empty productId to
  // match what the dropdown is visually showing. Without this, the line
  // total stays ₱0.00 even though the dropdown looks correct.
  useEffect(() => {
    if (products.length === 0) return;
    const needsBackfill = productLines.some((l) => !l.productId);
    if (!needsBackfill) return;
    setProductLines((lines) =>
      lines.map((l) => (l.productId ? l : { ...l, productId: products[0].id })),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

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
          <div className="flex gap-2">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="">Walk-in (anonymous)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.contactPhone ? ` · ${c.contactPhone}` : ''}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewCustomer(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs hover:bg-muted shrink-0"
              title="Add a new customer"
            >
              <UserPlus className="w-3.5 h-3.5" /> New
            </button>
          </div>
          {selectedCustomer && (selectedCustomer.loyaltyVisits ?? 0) > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              ⭐ {selectedCustomer.loyaltyVisits} previous visit{selectedCustomer.loyaltyVisits === 1 ? '' : 's'}
              {(selectedCustomer.loyaltyVisits ?? 0) % 10 === 9 && ' — next visit unlocks free wash!'}
            </p>
          )}
        </div>
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <h2 className="text-sm font-semibold">Pickup &amp; notes</h2>
          <input type="datetime-local" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Delivery toggle + address */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-2">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="w-4 h-4 text-[var(--accent)]" />
            Pickup &amp; delivery
          </span>
          <button
            type="button"
            onClick={() => setIsDelivery((v) => !v)}
            className="w-10 h-6 rounded-full transition-colors"
            style={{ background: isDelivery ? 'var(--accent)' : undefined }}
          >
            <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
              isDelivery ? 'translate-x-4' : 'translate-x-0'
            }`} />
          </button>
        </label>
        {isDelivery && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2">
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder={selectedCustomer?.defaultAddress ?? 'Delivery address'}
              rows={2}
              className="md:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
            />
            <input
              value={deliveryFee}
              onChange={(e) => setDeliveryFee(e.target.value)}
              type="number"
              min="0"
              step="0.01"
              placeholder="Delivery fee (₱)"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        )}
        {!isDelivery && (
          <p className="text-[11px] text-muted-foreground">
            Walk-in / over-the-counter. Toggle on for pickup &amp; delivery to add an address and fee.
          </p>
        )}
      </section>

      {/* No-prices banner — first thing the operator sees if Settings → Laundry
          hasn't been configured yet. Without unit prices every line is ₱0.00. */}
      {prices.filter((p) => p.isActive && Number(p.unitPrice) > 0).length === 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-amber-900 dark:text-amber-200">No service prices set yet.</p>
            <p className="text-amber-800 dark:text-amber-300/90">
              Service lines will price at ₱0.00 until you set per-kg / per-load rates in&nbsp;
              <Link href="/settings/laundry" className="underline font-medium">Settings → Laundry</Link>.
              Retail items (detergent, fabric softener) are managed in&nbsp;
              <Link href="/pos/products" className="underline font-medium">Products</Link>.
            </p>
          </div>
        </div>
      )}

      {/* Service lines */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Service lines</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/settings/laundry" className="hover:text-foreground hover:underline">
              Set prices →
            </Link>
            <span>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
          </div>
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
              const lineTotal = computeLineTotal(l);
              return (
                <div key={idx} className="rounded-lg bg-muted/30 px-3 py-2 space-y-1.5">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3 flex items-center gap-2">
                      <select
                        value={l.serviceCode}
                        onChange={(e) => {
                          const nextCode = e.target.value as ServiceCode;
                          // Clear machine if the new service can't run on it (or
                          // its kind no longer matches what we picked before).
                          const allowed = MACHINE_KINDS_FOR_SERVICE[nextCode];
                          const m = machines.find((m) => m.id === l.machineId);
                          const stillValid = !!m && !!allowed && allowed.includes(m.kind);
                          patchLine(idx, {
                            serviceCode: nextCode,
                            machineId:   stillValid ? l.machineId : undefined,
                          });
                        }}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                      >
                        {(Object.keys(SERVICE_LABEL) as ServiceCode[]).map((c) => (
                          <option key={c} value={c}>{SERVICE_LABEL[c]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 flex gap-1">
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
                    {/* Machine dropdown — only renders for service codes that
                        actually run on a machine. For DRY_CLEAN / IRON / FOLD,
                        we replace it with a non-clickable dash so the grid
                        stays aligned. Filter by IDLE + matching kind + same
                        branch + already-picked-elsewhere-in-this-form. */}
                    {(() => {
                      const allowedKinds = MACHINE_KINDS_FOR_SERVICE[l.serviceCode];
                      if (!allowedKinds) {
                        return (
                          <div className="col-span-3 text-xs text-muted-foreground italic text-center">
                            no machine
                          </div>
                        );
                      }
                      const usedElsewhere = new Set(
                        lines
                          .map((other, oi) => (oi === idx ? null : other.machineId))
                          .filter((id): id is string => !!id),
                      );
                      const eligible = machines.filter((m) =>
                        m.branchId === branchId &&
                        allowedKinds.includes(m.kind) &&
                        (m.status === 'IDLE' || m.id === l.machineId) &&
                        !usedElsewhere.has(m.id),
                      );
                      return (
                        <select
                          value={l.machineId ?? ''}
                          onChange={(e) => patchLine(idx, { machineId: e.target.value || undefined })}
                          className="col-span-3 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                          title="Assign a washer / dryer at intake"
                        >
                          <option value="">— assign later —</option>
                          {eligible.length === 0 && (
                            <option disabled value="__none__">No idle {allowedKinds.join('/').toLowerCase()} available</option>
                          )}
                          {eligible.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code} ({m.kind === 'COMBO' ? 'Combo' : m.kind === 'WASHER' ? 'Washer' : 'Dryer'})
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                    <div className="col-span-2 text-right font-semibold tabular-nums">{fmtPeso(lineTotal)}</div>
                    <button onClick={() => removeLine(idx)} className="col-span-1 text-red-500 hover:bg-red-500/10 rounded p-1.5 justify-self-end">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Add-on chips */}
                  {addons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {addons.filter((a) => a.isActive).map((a) => {
                        const selected = l.addOnIds.includes(a.id);
                        const amt      = Number(a.amount);
                        const sign     = amt < 0 ? '−' : '+';
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => toggleLineAddOn(idx, a.id)}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors ${
                              selected
                                ? amt < 0
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]'
                                : 'bg-background border-border text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            <span>{a.name}</span>
                            <span className="font-mono">{sign}{fmtPeso(Math.abs(amt))}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
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
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Link href="/pos/laundry/queue" className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</Link>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || createForPay.isPending || !branchId || (lines.length === 0 && productLines.length === 0) || total <= 0}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            title="Record the intake; payment collected later at claim"
          >
            <Receipt className="h-4 w-4" />
            {create.isPending ? 'Saving…' : 'Record Intake'}
          </button>
          <button
            onClick={() => createForPay.mutate()}
            disabled={create.isPending || createForPay.isPending || !branchId || (lines.length === 0 && productLines.length === 0) || total <= 0}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
            title="Record the intake AND collect payment now"
          >
            <Receipt className="h-4 w-4" />
            {createForPay.isPending ? 'Recording…' : 'Record + Pay Now'}
          </button>
        </div>
      </div>

      {/* ── Pay-now modal (Sprint 19) ──────────────────────────────────── */}
      {showPay && pendingOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold">Pay Now</h3>
              <button
                onClick={() => { setShowPay(false); router.push(`/pos/laundry/${pendingOrderId}`); }}
                className="text-xs text-muted-foreground hover:text-foreground"
                title="Skip payment — order is recorded but unpaid"
              >
                Skip → open ticket
              </button>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Amount due</span>
              <span className="text-xl font-bold tabular-nums">{fmtPeso(total)}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Payment method</div>
              <div className="grid grid-cols-3 gap-2">
                {(['CASH', 'GCASH', 'CARD'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPayMethod(m)}
                    className={`py-2 rounded-md text-xs font-semibold border ${
                      payMethod === m
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {m === 'CASH' ? 'Cash' : m === 'GCASH' ? 'GCash' : 'Card / QR'}
                  </button>
                ))}
              </div>
            </div>
            {payMethod === 'CASH' && (
              <label className="block">
                <span className="text-xs text-muted-foreground">Cash tendered (₱)</span>
                <input
                  type="number" step="0.01" min="0"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm font-mono"
                />
                {Number(tendered) > total && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Change: <span className="font-mono">{fmtPeso(Number(tendered) - total)}</span>
                  </p>
                )}
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowPay(false); router.push(`/pos/laundry/${pendingOrderId}`); }}
                className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted"
              >
                Skip
              </button>
              <button
                onClick={() => payNow.mutate()}
                disabled={payNow.isPending || (payMethod === 'CASH' && Number(tendered) < total)}
                className="px-5 py-2 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
              >
                {payNow.isPending ? 'Recording payment…' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New customer modal ───────────────────────────────────────── */}
      {showNewCustomer && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[var(--accent)]" /> New customer
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Saves to your customer list — autocompletes on next visit and
                accrues loyalty visits.
              </p>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="e.g. Maria Santos"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label>
                <input
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="09XX XXX XXXX"
                  inputMode="tel"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Default delivery address (optional)
                </label>
                <textarea
                  value={newCustomer.defaultAddress}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, defaultAddress: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                  placeholder="Street, Barangay, City"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Auto-fills the delivery address when this customer requests pickup &amp; delivery.
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => setShowNewCustomer(false)}
                className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newCustomer.name.trim().length < 2) {
                    toast.error('Name must be at least 2 characters');
                    return;
                  }
                  createCustomer.mutate({
                    name:           newCustomer.name.trim(),
                    contactPhone:   newCustomer.phone.trim()          || undefined,
                    defaultAddress: newCustomer.defaultAddress.trim() || undefined,
                  });
                }}
                disabled={createCustomer.isPending}
                className="text-sm px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40"
              >
                {createCustomer.isPending ? 'Saving…' : 'Add customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
