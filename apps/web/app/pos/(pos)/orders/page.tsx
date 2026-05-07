'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Ban, Receipt, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import DocumentAttachments from '@/components/shared/DocumentAttachments';
import { Spinner } from '@/components/ui/Spinner';

interface Payment { method: string; amount: number | string; reference?: string; }
interface ItemRefund {
  id:           string;
  quantity:     number | string;
  refundAmount: number | string;
  reason:       string;
  refundMethod: string;
  restocked:    boolean;
  createdAt:    string;
  refundedBy?:  { id: string; name: string };
}
interface OrderItem {
  id?:           string;
  productName:   string;
  quantity:      number | string;
  unitPrice:     number | string;
  lineTotal:     number | string;
  refundedQty?:  number | string;
  refunds?:      ItemRefund[];
}
interface Order {
  id: string;
  orderNumber: string;
  // Sprint 7: PAID = paid, still in production (bar/kitchen). Auto-promotes
  // to COMPLETED when the last prep item is bumped READY by KDS.
  status: 'PAID' | 'COMPLETED' | 'VOIDED';
  totalAmount: number | string;
  createdAt: string;
  paidAt?: string;
  readyAt?: string;
  completedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  isPwdScDiscount: boolean;
  items: OrderItem[];
  payments: Payment[];
  createdBy?: { id: string; name: string };
  voidedBy?: { id: string; name: string };
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash', GCASH_PERSONAL: 'GCash Personal', GCASH_BUSINESS: 'GCash Business',
  MAYA_PERSONAL: 'Maya Personal', MAYA_BUSINESS: 'Maya Business', QR_PH: 'QR Ph',
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function OrdersPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voidModal, setVoidModal] = useState<Order | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidPin, setVoidPin] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Item-level refund state
  const [refundCtx, setRefundCtx] = useState<{ order: Order; item: OrderItem } | null>(null);
  const [refundQty, setRefundQty] = useState('1');
  const [refundReason, setRefundReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [refundRestock, setRefundRestock] = useState(true);
  const [refundPin, setRefundPin] = useState('');
  const [refunding, setRefunding] = useState(false);

  // Cashiers can INITIATE a void but a supervisor must enter their PIN.
  // Direct-void roles (Owner / Branch Manager / Sales Lead / Super Admin)
  // skip the PIN step.
  const canInitiateVoid =
    user?.role === 'CASHIER' || user?.role === 'SALES_LEAD' ||
    user?.role === 'BRANCH_MANAGER' || user?.role === 'BUSINESS_OWNER' ||
    user?.role === 'SUPER_ADMIN';
  const needsSupervisorPin = user?.role === 'CASHIER';
  // Backwards-compat alias for existing UI bindings below.
  const canVoid = canInitiateVoid;

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['orders', user?.branchId],
    queryFn: () =>
      api.get(`/orders?branchId=${user!.branchId}&take=200`).then((r) => {
        // Endpoint shape: { data, total, take, skip }. Accept the legacy
        // bare-array shape too for backward-compat with older deploys.
        const d = r.data;
        return Array.isArray(d) ? d : (d?.data ?? []);
      }),
    enabled: !!user?.branchId,
    staleTime: 15_000,
    // Poll every 15s while the page is open so PAID->COMPLETED transitions
    // and the live "PREPARING · Xm" wait counter feel responsive.
    refetchInterval: 15_000,
  });

  const filtered = orders.filter(
    (o) =>
      o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
      (o.createdBy?.name ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  async function handleRefund() {
    if (!refundCtx) return;
    const qty = parseFloat(refundQty);
    if (!qty || qty <= 0) { toast.error('Enter a quantity to refund.'); return; }
    if (!refundReason.trim()) { toast.error('Reason is required.'); return; }
    if (needsSupervisorPin && !/^\d{4,6}$/.test(refundPin.trim())) {
      toast.error('Supervisor PIN must be 4-6 digits.'); return;
    }
    setRefunding(true);
    try {
      let supervisorId: string | undefined;
      if (needsSupervisorPin) {
        try {
          const { data } = await api.post('/auth/verify-supervisor-pin', { pin: refundPin.trim() });
          supervisorId = data.userId;
        } catch (e: unknown) {
          const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
          toast.error(msg ?? 'Supervisor PIN rejected.');
          return;
        }
      }
      await api.post(`/orders/${refundCtx.order.id}/items/${refundCtx.item.id}/refund`, {
        quantity:     qty,
        reason:       refundReason.trim(),
        refundMethod,
        restock:      refundRestock,
        supervisorId,
      });
      toast.success(`Refunded ${qty} of ${refundCtx.item.productName}.`);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['products-pos'] });
      setRefundCtx(null);
      setRefundQty('1'); setRefundReason(''); setRefundPin(''); setRefundMethod('CASH'); setRefundRestock(true);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Refund failed.');
    } finally {
      setRefunding(false);
    }
  }

  async function handleVoid() {
    if (!voidModal || !voidReason.trim()) { toast.error('Please enter a void reason.'); return; }
    if (needsSupervisorPin && !/^\d{4,6}$/.test(voidPin.trim())) {
      toast.error('Supervisor PIN must be 4-6 digits.');
      return;
    }
    setVoiding(true);
    try {
      let supervisorId: string | undefined;
      let supervisorName: string | undefined;

      // Cashier path: verify the supervisor's PIN first to get their userId,
      // then attach to the void call. The backend re-validates everything.
      if (needsSupervisorPin) {
        try {
          const { data } = await api.post('/auth/verify-supervisor-pin', { pin: voidPin.trim() });
          supervisorId   = data.userId;
          supervisorName = data.name;
        } catch (e: unknown) {
          const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
          toast.error(msg ?? 'Supervisor PIN rejected.');
          return;
        }
      }

      await api.post(`/orders/${voidModal.id}/void`, {
        reason:       voidReason.trim(),
        supervisorId,
      });
      toast.success(
        supervisorName
          ? `Order ${voidModal.orderNumber} voided — authorised by ${supervisorName}.`
          : `Order ${voidModal.orderNumber} voided.`,
      );
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['products-pos'] });
      setVoidModal(null);
      setVoidReason('');
      setVoidPin('');
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to void order.');
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-muted/30 overflow-auto">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-4 bg-background border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Order History</h1>
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order # or cashier…"
            className="pl-8 pr-3 py-1.5 text-sm border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent w-full sm:w-60 transition-shadow"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center"><Spinner size="lg" message="Loading orders…" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Receipt className="h-10 w-10 opacity-30" />
          <p className="text-sm">No orders found.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="overflow-x-auto min-w-full">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-6" />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Order #</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cashier</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  {canVoid && (
                    <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((o) => (
                  <>
                    <tr
                      key={o.id}
                      className={`hover:bg-muted/40 transition-colors cursor-pointer ${o.status === 'VOIDED' ? 'opacity-50' : ''}`}
                      onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                    >
                      <td className="px-6 py-3 text-muted-foreground">
                        {expanded === o.id
                          ? <ChevronUp className="h-3.5 w-3.5" />
                          : <ChevronDown className="h-3.5 w-3.5" />}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-foreground">
                        {o.orderNumber}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {fmtDate(o.paidAt ?? o.completedAt ?? o.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {o.createdBy?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                        {formatPeso(Number(o.totalAmount))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* Sprint 7: render PAID as amber 'Preparing' with a
                            tiny live wait-time counter so the cashier can see
                            at a glance which orders are still in production. */}
                        {(() => {
                          if (o.status === 'PAID') {
                            const paidAt = o.paidAt ? new Date(o.paidAt).getTime() : Date.now();
                            const waitMin = Math.max(0, Math.floor((Date.now() - paidAt) / 60000));
                            return (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                PREPARING · {waitMin}m
                              </span>
                            );
                          }
                          if (o.status === 'COMPLETED') {
                            return (
                              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
                                COMPLETED
                              </span>
                            );
                          }
                          return (
                            <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">
                              {o.status}
                            </span>
                          );
                        })()}
                        {o.isPwdScDiscount && (
                          <span className="ml-1 inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500">
                            PWD/SC
                          </span>
                        )}
                      </td>
                      {canVoid && (
                        <td className="px-6 py-3 text-right">
                          {(o.status === 'COMPLETED' || o.status === 'PAID') && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setVoidReason(''); setVoidModal(o); }}
                              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors ml-auto"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Void
                            </button>
                          )}
                          {o.status === 'VOIDED' && (
                            <span className="text-xs text-muted-foreground">
                              voided by {o.voidedBy?.name ?? '?'}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>

                    {/* Expanded detail row */}
                    {expanded === o.id && (
                      <tr key={`${o.id}-detail`} className="bg-[var(--accent-soft)]/30">
                        <td colSpan={canVoid ? 7 : 6} className="px-8 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div>
                              <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-2">Items</p>
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b border-border">
                                    <th className="text-left pb-1 text-muted-foreground font-medium">Product</th>
                                    <th className="text-right pb-1 text-muted-foreground font-medium">Qty</th>
                                    <th className="text-right pb-1 text-muted-foreground font-medium">Unit</th>
                                    <th className="text-right pb-1 text-muted-foreground font-medium">Total</th>
                                    {canVoid && o.status === 'COMPLETED' && (
                                      <th className="text-right pb-1 text-muted-foreground font-medium w-20"></th>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.items.map((item, i) => {
                                    const refundedQty = Number(item.refundedQty ?? 0);
                                    const remaining   = Number(item.quantity) - refundedQty;
                                    const fullyRefunded = remaining <= 0.0001;
                                    return (
                                      <tr key={i} className={`border-b border-border/50 ${fullyRefunded ? 'opacity-50' : ''}`}>
                                        <td className="py-1 text-foreground">
                                          {item.productName}
                                          {refundedQty > 0 && (
                                            <span className="ml-2 text-[10px] text-amber-600">
                                              {refundedQty} refunded
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-1 text-right text-muted-foreground">{Number(item.quantity)}</td>
                                        <td className="py-1 text-right text-muted-foreground">{formatPeso(Number(item.unitPrice))}</td>
                                        <td className="py-1 text-right font-medium text-foreground">{formatPeso(Number(item.lineTotal))}</td>
                                        {canVoid && o.status === 'COMPLETED' && (
                                          <td className="py-1 text-right">
                                            {item.id && !fullyRefunded ? (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setRefundCtx({ order: o, item });
                                                  setRefundQty(String(Math.min(1, remaining)));
                                                  setRefundReason('');
                                                  setRefundPin('');
                                                }}
                                                className="text-[10px] text-amber-600 hover:text-amber-700 underline"
                                              >
                                                Refund
                                              </button>
                                            ) : null}
                                          </td>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payments</p>
                                {o.payments.map((p, i) => (
                                  <div key={i} className="flex justify-between">
                                    <span className="text-muted-foreground">
                                      {METHOD_LABELS[p.method] ?? p.method}
                                      {p.reference && <span className="text-muted-foreground/60 ml-1">({p.reference})</span>}
                                    </span>
                                    <span className="font-medium text-foreground">{formatPeso(Number(p.amount))}</span>
                                  </div>
                                ))}
                              </div>
                              {o.status === 'VOIDED' && (
                                <div className="bg-red-500/10 border border-red-200 dark:border-red-900 rounded-lg p-3">
                                  <p className="font-semibold text-red-500 mb-1">VOIDED</p>
                                  <p className="text-muted-foreground">By: {o.voidedBy?.name ?? '?'} @ {fmtDate(o.voidedAt)}</p>
                                  {o.voidReason && <p className="text-muted-foreground">Reason: {o.voidReason}</p>}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Document attachments — read-only for cashiers */}
                          <div className="mt-4 border-t border-border pt-4">
                            <DocumentAttachments
                              entityType="Order"
                              entityId={o.id}
                              canManage={false}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Void confirmation modal */}
      {voidModal && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Void Order</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {voidModal.orderNumber} · {formatPeso(Number(voidModal.totalAmount))}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-red-500/10 border border-red-200 dark:border-red-900 rounded-xl p-3 text-xs text-red-600 dark:text-red-400">
                ⚠️ This will reverse the sale and restore inventory. Voids are only allowed on same-day orders. This action cannot be undone.
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Reason <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  rows={3}
                  className="w-full border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                  placeholder="e.g. Customer cancelled order, Wrong order entered…"
                  autoFocus
                />
              </div>

              {needsSupervisorPin && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                  <div className="text-xs font-medium text-amber-900">
                    Supervisor authorisation required
                  </div>
                  <p className="text-[11px] text-amber-800 leading-snug">
                    Hand the device to your manager. They enter their 4-6 digit PIN
                    here. The void is logged with both your names.
                  </p>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4,6}"
                    maxLength={6}
                    autoComplete="off"
                    value={voidPin}
                    onChange={(e) => setVoidPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full h-11 text-center text-xl tracking-[0.5em] font-bold border border-amber-300 bg-white text-amber-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="• • • •"
                  />
                </div>
              )}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => { setVoidModal(null); setVoidReason(''); setVoidPin(''); }}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleVoid}
                disabled={voiding || !voidReason.trim()}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl py-2 text-sm font-medium transition-colors"
              >
                {voiding ? 'Voiding…' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item refund modal */}
      {refundCtx && (() => {
        const item = refundCtx.item;
        const refundedQty = Number(item.refundedQty ?? 0);
        const remaining = Number(item.quantity) - refundedQty;
        const qty = parseFloat(refundQty) || 0;
        const proRated = qty > 0 ? (qty / Number(item.quantity)) * Number(item.lineTotal) : 0;
        return (
          <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="font-semibold text-foreground">Refund Item</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {refundCtx.order.orderNumber} · {item.productName}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Sold: {Number(item.quantity)} · Already refunded: {refundedQty} · Remaining: {remaining}
                </p>
              </div>

              <div className="p-6 space-y-3">
                <div className="bg-amber-500/10 border border-amber-300 rounded-xl p-3 text-xs text-amber-800">
                  ⚠️ Refunds reverse a portion of revenue + COGS. The customer must be paid back the
                  amount shown. Inventory restock is optional (uncheck if the item is unsellable).
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Quantity to refund *</label>
                  <input
                    type="number" step="0.01" min={0.01} max={remaining}
                    value={refundQty}
                    onChange={(e) => setRefundQty(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    autoFocus
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Pro-rated refund amount: <strong>{formatPeso(proRated)}</strong>
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Reason *</label>
                  <textarea
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                    placeholder="e.g. Customer changed mind, item damaged, wrong size…"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Refund method *</label>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
                  >
                    <option value="CASH">Cash</option>
                    <option value="GCASH_PERSONAL">GCash (personal)</option>
                    <option value="GCASH_BUSINESS">GCash (business)</option>
                    <option value="MAYA_PERSONAL">Maya (personal)</option>
                    <option value="MAYA_BUSINESS">Maya (business)</option>
                    <option value="QR_PH">QR Ph / Bank Transfer</option>
                  </select>
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={refundRestock} onChange={(e) => setRefundRestock(e.target.checked)} />
                  Restock inventory (uncheck for damaged / unsellable items)
                </label>

                {needsSupervisorPin && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                    <div className="text-xs font-medium text-amber-900">Supervisor authorisation required</div>
                    <input
                      type="password" inputMode="numeric" pattern="\d{4,6}" maxLength={6}
                      autoComplete="off"
                      value={refundPin}
                      onChange={(e) => setRefundPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full h-11 text-center text-xl tracking-[0.5em] font-bold border border-amber-300 bg-white text-amber-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="• • • •"
                    />
                  </div>
                )}
              </div>

              <div className="px-6 pb-5 flex gap-3">
                <button
                  onClick={() => { setRefundCtx(null); setRefundQty('1'); setRefundReason(''); setRefundPin(''); }}
                  className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRefund}
                  disabled={refunding || !refundReason.trim() || qty <= 0 || qty > remaining + 0.0001}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl py-2 text-sm font-medium transition-colors"
                >
                  {refunding ? 'Refunding…' : 'Confirm Refund'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
