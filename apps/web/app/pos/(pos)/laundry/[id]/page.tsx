'use client';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Shirt, Phone, MapPin, Clock, CheckCircle2, ArrowRight,
  Printer, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type LaundryStatus =
  | 'RECEIVED' | 'WASHING' | 'DRYING' | 'FOLDING' | 'READY_FOR_PICKUP'
  | 'CLAIMED' | 'CANCELLED';

interface LaundryDetail {
  id:           string;
  claimNumber:  string;
  status:       LaundryStatus;
  serviceType:  string;
  pricingMode:  string;
  weightKg:     string | null;
  loadCount:    number | null;
  pieceCount:   number | null;
  unitPrice:    string;
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

  // Claim → create POS Order, then link.
  const claim = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      // Create a POS order matching the laundry total. Single line item describing the service.
      const posOrder = await api.post('/orders', {
        order: {
          branchId:   order.branch!.id,
          customerId: order.customer?.id ?? null,
          subtotal:   Number(order.totalAmount),
          discountAmount: 0,
          vatAmount:  0,
          totalAmount: Number(order.totalAmount),
          notes:      `Laundry claim ${order.claimNumber}`,
          items: [{
            productName: `Laundry · ${order.serviceType.replace(/_/g, ' ')}`,
            quantity:    1,
            unitPrice:   Number(order.totalAmount),
            lineTotal:   Number(order.totalAmount),
          }],
          payments: [{ method: 'CASH', amount: Number(order.totalAmount) }],
        },
      }).then((r) => r.data);

      // Link the POS Order back to the laundry order.
      return api.post(`/laundry/orders/${id}/claim`, { orderId: posOrder.id ?? posOrder.data?.id }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-order', id] });
      toast.success('Claimed. Receipt is ready to print.');
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
            {order.serviceType.replace(/_/g, ' ').toLowerCase()} · {order.branch?.name ?? '—'}
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
              onClick={() => claim.mutate()}
              disabled={claim.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {claim.isPending ? 'Claiming…' : 'Claim & Pay'}
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
            <div className="text-muted-foreground">Mode</div>
            <div>{order.pricingMode.replace(/_/g, ' ').toLowerCase()}</div>
            {order.weightKg && (<><div className="text-muted-foreground">Weight</div><div>{Number(order.weightKg).toFixed(2)} kg</div></>)}
            {order.loadCount != null && (<><div className="text-muted-foreground">Loads</div><div>{order.loadCount}</div></>)}
            {order.pieceCount != null && (<><div className="text-muted-foreground">Pieces</div><div>{order.pieceCount}</div></>)}
            <div className="text-muted-foreground">Unit price</div>
            <div>{fmtPeso(order.unitPrice)}</div>
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
    </div>
  );
}
