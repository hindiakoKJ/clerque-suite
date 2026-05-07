'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Shirt, Phone, MapPin, Clock, CheckCircle2, ArrowRight,
  Printer, X, Banknote, CreditCard, Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type PaymentMethod = 'CASH' | 'CARD' | 'GCASH';

type LaundryStatus =
  | 'RECEIVED' | 'WASHING' | 'DRYING' | 'FOLDING' | 'READY_FOR_PICKUP'
  | 'CLAIMED' | 'CANCELLED';

interface LaundryDetail {
  id:           string;
  claimNumber:  string;
  status:       LaundryStatus;
  serviceType:  string | null;
  pricingMode:  string | null;
  weightKg:     string | null;
  loadCount:    number | null;
  pieceCount:   number | null;
  unitPrice:    string | null;
  totalAmount:  string;
  receivedAt:   string;
  promisedAt:   string | null;
  readyAt:      string | null;
  claimedAt:    string | null;
  notes:        string | null;
  customer:     { id: string; name: string; contactPhone: string | null; address: string | null } | null;
  branch:       { id: string; name: string } | null;
  order:        { id: string; orderNumber: string; totalAmount: string } | null;
  items:        Array<{ id: string; garmentType: string; quantity: number; condition: string | null; tagNumber: string | null }>;
  lines?:       Array<{
    id: string;
    serviceCode: string;
    mode: string;
    sets: number;
    unitPrice: string;
    lineTotal: string;
    machineStatus: 'NOT_STARTED' | 'RUNNING' | 'DONE';
    machine: { id: string; code: string; kind: 'WASHER' | 'DRYER' | 'COMBO' } | null;
    addOns?: Array<{ id: string; code: string; name: string; totalAmount: string }>;
  }>;
}

const FLOW: LaundryStatus[] = ['RECEIVED', 'WASHING', 'DRYING', 'FOLDING', 'READY_FOR_PICKUP'];

const LABEL: Record<LaundryStatus, string> = {
  RECEIVED: 'Received', WASHING: 'Washing', DRYING: 'Drying',
  FOLDING: 'Folding', READY_FOR_PICKUP: 'Ready for pickup',
  CLAIMED: 'Claimed', CANCELLED: 'Cancelled',
};

function fmtPeso(s: string | null) {
  if (s == null) return '—';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(s));
}
function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
}

export default function LaundryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: order, isLoading } = useQuery<LaundryDetail>({
    queryKey: ['laundry-order', id],
    queryFn:  () => api.get(`/laundry/orders/${id}`).then((r) => r.data),
    enabled:  !!id,
  });

  const advance = useMutation({
    mutationFn: (status: LaundryStatus) =>
      api.patch(`/laundry/orders/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-order', id] });
      qc.invalidateQueries({ queryKey: ['laundry-orders'] });
      toast.success('Status updated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed.'),
  });

  // ── Claim & Pay modal ────────────────────────────────────────────────────
  const [showPay,   setShowPay]   = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [tendered,  setTendered]  = useState<string>('');

  function openPay() {
    if (!order) return;
    setPayMethod('CASH');
    setTendered(String(Number(order.totalAmount).toFixed(2)));
    setShowPay(true);
  }

  // Claim → create POS Order with the chosen payment, then link.
  const claim = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      const total      = Number(order.totalAmount);
      const tenderNum  = Number(tendered) || total;
      const change     = payMethod === 'CASH' ? Math.max(0, tenderNum - total) : 0;

      const posOrder = await api.post('/orders', {
        order: {
          branchId:       order.branch!.id,
          customerId:     order.customer?.id ?? null,
          subtotal:       total,
          discountAmount: 0,
          vatAmount:      0,
          totalAmount:    total,
          notes:          `Laundry claim ${order.claimNumber}`,
          items: [{
            productName: `Laundry · ${order.claimNumber}`,
            quantity:    1,
            unitPrice:   total,
            lineTotal:   total,
          }],
          payments: [{
            method:   payMethod,
            amount:   payMethod === 'CASH' ? Math.max(tenderNum, total) : total,
            ...(change > 0 ? { change } : {}),
          }],
        },
      }).then((r) => r.data);

      return api.post(`/laundry/orders/${id}/claim`, { orderId: posOrder.id ?? posOrder.data?.id }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-order', id] });
      qc.invalidateQueries({ queryKey: ['laundry-orders'] });
      toast.success('Claimed. Receipt is ready to print.');
      setShowPay(false);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Claim failed.'),
  });

  if (isLoading || !order) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const currentIdx = FLOW.indexOf(order.status);
  const next = currentIdx >= 0 && currentIdx < FLOW.length - 1 ? FLOW[currentIdx + 1] : null;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href="/pos/laundry/queue" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Queue
      </Link>

      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <Shirt className="h-7 w-7 text-[var(--accent)]" />
            <h1 className="text-2xl font-semibold tracking-tight font-mono">{order.claimNumber}</h1>
            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
              order.status === 'CLAIMED'   ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' :
              order.status === 'CANCELLED' ? 'bg-red-500/15 text-red-600' :
              'bg-[var(--accent)]/15 text-[var(--accent)]'
            }`}>
              {LABEL[order.status]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {order.serviceType ? order.serviceType.replace(/_/g, ' ').toLowerCase() + ' · ' : ''}{order.branch?.name ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {next && order.status !== 'CANCELLED' && (
            <button
              onClick={() => advance.mutate(next)}
              disabled={advance.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {LABEL[next]} <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {order.status === 'READY_FOR_PICKUP' && (
            <button
              onClick={openPay}
              disabled={claim.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              Claim &amp; Pay
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Printer className="h-4 w-4" /> Print
          </button>
          {!['CLAIMED', 'CANCELLED'].includes(order.status) && (
            <button
              onClick={() => advance.mutate('CANCELLED')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/40 text-red-600 px-3 py-1.5 text-sm hover:bg-red-500/10"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          )}
        </div>
      </header>

      {/* Currently using — prominent machine assignment banner */}
      {order.lines && order.lines.some((l) => l.machine) && (
        <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Currently using
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {order.lines.filter((l) => l.machine).map((l) => {
                  const tint =
                    l.machineStatus === 'RUNNING' ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40' :
                    l.machineStatus === 'DONE'    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40' :
                                                     'bg-muted text-foreground border-border';
                  return (
                    <span
                      key={l.id}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm font-bold font-mono ${tint}`}
                    >
                      {l.machine!.code}
                      <span className="text-[10px] uppercase tracking-wide opacity-70 font-sans">
                        {l.machineStatus.toLowerCase().replace('_', ' ')}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Service lines (v2 multi-line tickets) */}
      {order.lines && order.lines.length > 0 && (
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Service lines</h2>
          </header>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Service</th>
                <th className="text-left px-4 py-2 font-medium">Mode</th>
                <th className="text-right px-4 py-2 font-medium">Sets</th>
                <th className="text-right px-4 py-2 font-medium">Unit</th>
                <th className="text-left px-4 py-2 font-medium">Add-ons</th>
                <th className="text-center px-4 py-2 font-medium">Machine</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id} className="border-t border-border/40">
                  <td className="px-4 py-2.5 capitalize">{l.serviceCode.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.mode === 'SELF_SERVICE' ? 'self' : 'full'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{l.sets}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtPeso(l.unitPrice)}</td>
                  <td className="px-4 py-2.5">
                    {(l.addOns ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(l.addOns ?? []).map((a) => (
                          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                            {a.name}
                            <span className="font-mono">
                              {Number(a.totalAmount) < 0 ? '−' : '+'}{fmtPeso(String(Math.abs(Number(a.totalAmount))))}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {l.machine ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-mono font-bold">
                        {l.machine.code}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtPeso(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Customer */}
        <section className="p-4 rounded-xl border border-border bg-card space-y-2">
          <h2 className="text-sm font-semibold">Customer</h2>
          {order.customer ? (
            <>
              <div className="font-medium">{order.customer.name}</div>
              {order.customer.contactPhone && (
                <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" /> {order.customer.contactPhone}
                </div>
              )}
              {order.customer.address && (
                <div className="text-sm text-muted-foreground flex items-start gap-1.5">
                  <MapPin className="h-3.5 w-3.5 mt-0.5" /> {order.customer.address}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground italic">Walk-in (anonymous)</div>
          )}
        </section>

        {/* Pricing */}
        <section className="p-4 rounded-xl border border-border bg-card space-y-2">
          <h2 className="text-sm font-semibold">Pricing</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {order.pricingMode && (
              <>
                <div className="text-muted-foreground">Mode</div>
                <div>{order.pricingMode.replace(/_/g, ' ').toLowerCase()}</div>
              </>
            )}
            {order.weightKg && (<><div className="text-muted-foreground">Weight</div><div>{Number(order.weightKg).toFixed(2)} kg</div></>)}
            {order.loadCount != null && (<><div className="text-muted-foreground">Loads</div><div>{order.loadCount}</div></>)}
            {order.pieceCount != null && (<><div className="text-muted-foreground">Pieces</div><div>{order.pieceCount}</div></>)}
            {order.unitPrice && (
              <>
                <div className="text-muted-foreground">Unit price</div>
                <div>{fmtPeso(order.unitPrice)}</div>
              </>
            )}
            <div className="text-muted-foreground font-semibold">Total</div>
            <div className="font-semibold">{fmtPeso(order.totalAmount)}</div>
            {order.order && (
              <>
                <div className="text-muted-foreground">POS Receipt</div>
                <Link href={`/pos/orders/${order.order.id}`} className="text-[var(--accent)] hover:underline">
                  {order.order.orderNumber}
                </Link>
              </>
            )}
          </div>
        </section>

        {/* Timeline */}
        <section className="p-4 rounded-xl border border-border bg-card space-y-2 md:col-span-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5"><Clock className="h-4 w-4" /> Timeline</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div className="space-y-0.5"><div className="text-muted-foreground text-xs">Received</div><div>{fmtTime(order.receivedAt)}</div></div>
            <div className="space-y-0.5"><div className="text-muted-foreground text-xs">Promised</div><div>{fmtTime(order.promisedAt)}</div></div>
            <div className="space-y-0.5"><div className="text-muted-foreground text-xs">Ready at</div><div>{fmtTime(order.readyAt)}</div></div>
            <div className="space-y-0.5"><div className="text-muted-foreground text-xs">Claimed</div><div>{fmtTime(order.claimedAt)}</div></div>
          </div>
          {order.notes && (
            <div className="pt-2 border-t border-border text-sm">
              <div className="text-xs text-muted-foreground">Notes</div>
              <div>{order.notes}</div>
            </div>
          )}
        </section>

        {/* Items */}
        {order.items.length > 0 && (
          <section className="p-4 rounded-xl border border-border bg-card space-y-2 md:col-span-2">
            <h2 className="text-sm font-semibold">Garments</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-1.5 pr-3">Garment</th>
                    <th className="py-1.5 pr-3">Qty</th>
                    <th className="py-1.5 pr-3">Condition</th>
                    <th className="py-1.5">Tag #</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.id} className="border-b border-border/40">
                      <td className="py-1.5 pr-3">{it.garmentType}</td>
                      <td className="py-1.5 pr-3">{it.quantity}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{it.condition ?? '—'}</td>
                      <td className="py-1.5 font-mono text-xs">{it.tagNumber ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* ── Claim & Pay modal ─────────────────────────────────────────────── */}
      {showPay && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <header className="px-5 pt-5 pb-3 flex items-start justify-between gap-2 border-b border-border">
              <div>
                <h2 className="font-semibold">Claim &amp; Pay</h2>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">{order.claimNumber}</p>
              </div>
              <button onClick={() => setShowPay(false)} className="text-muted-foreground hover:text-foreground p-1 rounded">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="px-5 py-4 space-y-4">
              {/* Total */}
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Amount due</span>
                <span className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
                  {fmtPeso(order.totalAmount)}
                </span>
              </div>

              {/* Method picker */}
              <div>
                <span className="text-xs text-muted-foreground mb-2 block">Payment method</span>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { v: 'CASH',  label: 'Cash',  Icon: Banknote   },
                    { v: 'GCASH', label: 'GCash', Icon: Smartphone },
                    { v: 'CARD',  label: 'Card',  Icon: CreditCard },
                  ] as const).map(({ v, label, Icon }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPayMethod(v)}
                      className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg text-xs font-medium border transition-colors ${
                        payMethod === v
                          ? 'bg-[var(--accent)] text-white border-transparent'
                          : 'bg-background border-border hover:bg-muted'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tendered (cash only) */}
              {payMethod === 'CASH' && (
                <label className="text-sm block">
                  <span className="text-xs text-muted-foreground">Cash tendered (₱)</span>
                  <input
                    type="number" step="0.01" inputMode="decimal"
                    value={tendered}
                    onChange={(e) => setTendered(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-base"
                    autoFocus
                  />
                  {Number(tendered) > Number(order.totalAmount) && (
                    <span className="text-xs text-muted-foreground mt-1 block">
                      Change: {fmtPeso(String(Number(tendered) - Number(order.totalAmount)))}
                    </span>
                  )}
                </label>
              )}
            </div>

            <footer className="px-5 pb-5 flex justify-end gap-2">
              <button
                onClick={() => setShowPay(false)}
                className="px-4 py-2 rounded-lg text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => claim.mutate()}
                disabled={
                  claim.isPending ||
                  (payMethod === 'CASH' && Number(tendered) < Number(order.totalAmount))
                }
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
              >
                {claim.isPending ? 'Claiming…' : 'Confirm &amp; Print Receipt'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
