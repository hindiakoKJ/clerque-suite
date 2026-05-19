'use client';

/**
 * Clerque Cloud — Pre-orders
 *
 * Bakery custom-cake reservation manager. Replaces the paper logbook that
 * captures who's picking up what, when, with what inscription, and how
 * much deposit was paid.
 *
 * Layout:
 *   • Top: "Today's pickups" hero card (count + ₱ balance due)
 *   • Date filter (Today / Tomorrow / This week / Custom)
 *   • List of pre-orders grouped by pickup date
 *   • New / edit drawer with line items + inscription + deposit fields
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Calendar, Cake, Phone, CheckCircle2, X, ChevronRight, Pencil,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';

interface Branch  { id: string; name: string; }
interface Customer { id: string; name: string; contactPhone: string | null; }
interface ProductLite { id: string; name: string; price: number | string; }

interface Modifier {
  modifierGroupId:  string;
  modifierOptionId: string;
  groupName:        string;
  optionName:       string;
  priceAdjustment:  number;
}

interface Item {
  productId:        string;
  productName:      string;
  quantity:         number;
  unitPriceCents:   number;
  modifierAddCents: number;
  lineTotalCents:   number;
  notes?:           string;
  modifiers:        Modifier[];
}

interface PreOrder {
  id:                 string;
  preOrderNumber:     string;
  status:             'DRAFT' | 'DEPOSIT_PAID' | 'READY' | 'PICKED_UP' | 'CANCELLED';
  pickupDate:         string;
  pickupTime:         string | null;
  inscription:        string | null;
  notes:              string | null;
  subtotalCents:      number;
  discountCents:      number;
  totalCents:         number;
  depositCents:       number;
  balanceCents:       number;
  customer:           Customer | null;
  createdBy:          { id: string; name: string };
  items:              Item[];
}

interface DraftLine {
  productId:        string;
  quantity:         string;
  notes?:           string;
}

interface DraftPreOrder {
  branchId:       string;
  customerId:     string;
  pickupDate:     string;
  pickupTime:     string;
  inscription:    string;
  notes:          string;
  depositCents:   string;   // pesos as string for the input
  discountCents:  string;
  items:          DraftLine[];
}

/** Today (PH time) YYYY-MM-DD */
function todayYmdPh(): string {
  const off = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + off).toISOString().slice(0, 10);
}

const EMPTY_DRAFT: DraftPreOrder = {
  branchId:      '',
  customerId:    '',
  pickupDate:    todayYmdPh(),
  pickupTime:    '',
  inscription:   '',
  notes:         '',
  depositCents:  '',
  discountCents: '',
  items:         [{ productId: '', quantity: '1' }],
};

export default function PreOrdersPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userBranchId = user?.branchId ?? undefined;

  // Date filter — sensible default of today + next 14 days.
  const [from, setFrom] = useState(todayYmdPh());
  const [to,   setTo]   = useState(() => {
    const d = new Date(Date.now() + 14 * 24 * 3600_000);
    return d.toISOString().slice(0, 10);
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<PreOrder | null>(null);
  const [draft, setDraft]           = useState<DraftPreOrder>(EMPTY_DRAFT);
  const [saving, setSaving]         = useState(false);

  const branchesQ = useQuery<Branch[]>({
    queryKey: ['pre-orders', 'branches'],
    queryFn: () => api.get('/branches').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const customersQ = useQuery<Customer[]>({
    queryKey: ['pre-orders', 'customers'],
    queryFn: () => api.get('/customers').then((r) => r.data),
    staleTime: 60_000,
  });
  const productsQ = useQuery<ProductLite[]>({
    queryKey: ['pre-orders', 'products'],
    queryFn: () => api.get('/products').then((r) => r.data),
    staleTime: 60_000,
  });

  const preOrdersQ = useQuery<PreOrder[]>({
    queryKey: ['pre-orders', from, to, userBranchId],
    queryFn: () => api.get('/pre-orders', {
      params: {
        ...(userBranchId ? { branchId: userBranchId } : {}),
        from,
        to,
      },
    }).then((r) => r.data),
    staleTime: 30_000,
  });

  const todayList = useMemo(() => {
    const today = todayYmdPh();
    return (preOrdersQ.data ?? []).filter(
      (p) => p.pickupDate.slice(0, 10) === today && p.status !== 'CANCELLED' && p.status !== 'PICKED_UP',
    );
  }, [preOrdersQ.data]);

  const todayBalanceDue = todayList.reduce((acc, p) => acc + p.balanceCents, 0);

  // Group by date for the main list
  const grouped = useMemo(() => {
    const out: Record<string, PreOrder[]> = {};
    for (const p of preOrdersQ.data ?? []) {
      const k = p.pickupDate.slice(0, 10);
      out[k] = out[k] || [];
      out[k].push(p);
    }
    return out;
  }, [preOrdersQ.data]);

  // ─── Draft helpers ─────────────────────────────────────────────────────

  const startNew = () => {
    setEditing(null);
    setDraft({
      ...EMPTY_DRAFT,
      branchId: userBranchId ?? branchesQ.data?.[0]?.id ?? '',
    });
    setDrawerOpen(true);
  };

  const startEdit = (p: PreOrder) => {
    setEditing(p);
    setDraft({
      branchId:      userBranchId ?? branchesQ.data?.[0]?.id ?? '',
      customerId:    p.customer?.id ?? '',
      pickupDate:    p.pickupDate.slice(0, 10),
      pickupTime:    p.pickupTime ?? '',
      inscription:   p.inscription ?? '',
      notes:         p.notes ?? '',
      depositCents:  String(p.depositCents / 100),
      discountCents: String(p.discountCents / 100),
      items:         p.items.map((i) => ({
        productId: i.productId,
        quantity:  String(i.quantity),
        notes:     i.notes,
      })),
    });
    setDrawerOpen(true);
  };

  const addLine    = () => setDraft({ ...draft, items: [...draft.items, { productId: '', quantity: '1' }] });
  const removeLine = (idx: number) => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== idx) });
  const patchLine  = (idx: number, patch: Partial<DraftLine>) => setDraft({
    ...draft,
    items: draft.items.map((row, i) => i === idx ? { ...row, ...patch } : row),
  });

  // Live totals preview
  const draftTotal = useMemo(() => {
    let subtotal = 0;
    for (const row of draft.items) {
      const p = productsQ.data?.find((pp) => pp.id === row.productId);
      if (!p) continue;
      const qty   = Number(row.quantity) || 0;
      const price = Math.round(Number(p.price) * 100);
      subtotal += qty * price;
    }
    const discount = Math.max(0, Math.round((Number(draft.discountCents) || 0) * 100));
    const total    = Math.max(0, subtotal - discount);
    const deposit  = Math.min(Math.max(0, Math.round((Number(draft.depositCents) || 0) * 100)), total);
    return { subtotal, discount, total, deposit, balance: total - deposit };
  }, [draft, productsQ.data]);

  const save = async () => {
    if (!draft.branchId) { toast.error('Pick a branch.'); return; }
    if (!draft.pickupDate) { toast.error('Pickup date is required.'); return; }
    if (draft.items.some((i) => !i.productId || Number(i.quantity) <= 0)) {
      toast.error('Every line needs a product + positive quantity.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        branchId:      draft.branchId,
        customerId:    draft.customerId || undefined,
        pickupDate:    draft.pickupDate,
        pickupTime:    draft.pickupTime || undefined,
        inscription:   draft.inscription || undefined,
        notes:         draft.notes || undefined,
        discountCents: Math.round((Number(draft.discountCents) || 0) * 100),
        depositCents:  Math.round((Number(draft.depositCents) || 0) * 100),
        items: draft.items.map((row) => {
          const p = productsQ.data!.find((pp) => pp.id === row.productId)!;
          const qty = Number(row.quantity);
          return {
            productId:      row.productId,
            productName:    p.name,
            quantity:       qty,
            unitPriceCents: Math.round(Number(p.price) * 100),
            notes:          row.notes,
          };
        }),
      };

      if (editing) {
        await api.patch(`/pre-orders/${editing.id}`, payload);
        toast.success(`Updated ${editing.preOrderNumber}`);
      } else {
        await api.post('/pre-orders', payload);
        toast.success('Pre-order created');
      }
      await qc.invalidateQueries({ queryKey: ['pre-orders'] });
      setDrawerOpen(false);
      setEditing(null);
      setDraft(EMPTY_DRAFT);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const markReady = async (p: PreOrder) => {
    try {
      await api.post(`/pre-orders/${p.id}/mark-ready`);
      await qc.invalidateQueries({ queryKey: ['pre-orders'] });
      toast.success(`${p.preOrderNumber} marked ready`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not mark ready';
      toast.error(msg);
    }
  };

  const cancel = async (p: PreOrder) => {
    const reason = window.prompt('Cancellation reason?', '');
    if (reason === null) return;
    try {
      await api.post(`/pre-orders/${p.id}/cancel`, { reason });
      await qc.invalidateQueries({ queryKey: ['pre-orders'] });
      toast.success(`${p.preOrderNumber} cancelled`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Cancel failed';
      toast.error(msg);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cake className="w-6 h-6 text-purple-600" />
            Pre-orders
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Custom cake reservations + advance orders. Deposits become real
            sales the moment they're paid; balances settle at pickup on Counter.
          </p>
        </div>
        <button
          onClick={startNew}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New pre-order
        </button>
      </header>

      {/* Today's pickups hero */}
      <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl p-5 text-white mb-6">
        <div className="text-xs uppercase tracking-wider opacity-80 font-bold">Today&apos;s pickups</div>
        <div className="flex items-baseline gap-4 mt-1">
          <div className="text-3xl font-extrabold tabular-nums">{todayList.length}</div>
          <div className="text-sm opacity-90">
            {todayList.length === 1 ? 'reservation' : 'reservations'} · balance due{' '}
            <span className="font-semibold tabular-nums">{formatPeso(todayBalanceDue)}</span>
          </div>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex flex-wrap gap-3 items-center mb-6 text-sm">
        <label className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-gray-700">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-700">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" />
        </label>
      </div>

      {/* Main list */}
      {preOrdersQ.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (preOrdersQ.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No pre-orders in this date window. Tap <b>New pre-order</b> to create one.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => (
            <section key={date}>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                {new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
                  weekday: 'short', month: 'short', day: 'numeric',
                })}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                {list.map((p) => <PreOrderRow
                  key={p.id}
                  preOrder={p}
                  onEdit={() => startEdit(p)}
                  onMarkReady={() => markReady(p)}
                  onCancel={() => cancel(p)}
                />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Drawer / Sheet */}
      {drawerOpen ? (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setDrawerOpen(false)}>
          <div className="bg-white w-full max-w-xl h-full overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editing ? `Edit ${editing.preOrderNumber}` : 'New pre-order'}</h3>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Header fields */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Branch</span>
                <select
                  value={draft.branchId}
                  onChange={(e) => setDraft({ ...draft, branchId: e.target.value })}
                  className="w-full border rounded px-2 py-1.5"
                >
                  <option value="">Select branch…</option>
                  {branchesQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Customer</span>
                <select
                  value={draft.customerId}
                  onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}
                  className="w-full border rounded px-2 py-1.5"
                >
                  <option value="">Walk-in / unknown</option>
                  {customersQ.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Pickup date</span>
                <input
                  type="date"
                  value={draft.pickupDate}
                  onChange={(e) => setDraft({ ...draft, pickupDate: e.target.value })}
                  className="w-full border rounded px-2 py-1.5"
                />
              </label>
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Pickup time (optional)</span>
                <input
                  type="time"
                  value={draft.pickupTime}
                  onChange={(e) => setDraft({ ...draft, pickupTime: e.target.value })}
                  className="w-full border rounded px-2 py-1.5"
                />
              </label>
            </div>

            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Inscription (cake message)</span>
              <input
                type="text"
                placeholder='e.g. "Happy Birthday Maria"'
                value={draft.inscription}
                onChange={(e) => setDraft({ ...draft, inscription: e.target.value })}
                className="w-full border rounded px-2 py-1.5"
              />
            </label>

            <label className="text-sm block mb-4">
              <span className="block text-gray-600 mb-1">Notes (allergies, colour, photo ref)</span>
              <textarea
                rows={2}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                className="w-full border rounded px-2 py-1.5"
              />
            </label>

            {/* Line items */}
            <h4 className="text-sm font-bold text-gray-700 mb-2">Items</h4>
            <div className="space-y-2 mb-4">
              {draft.items.map((row, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select
                    value={row.productId}
                    onChange={(e) => patchLine(idx, { productId: e.target.value })}
                    className="flex-1 border rounded px-2 py-1.5 text-sm bg-white"
                  >
                    <option value="">Select product…</option>
                    {productsQ.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input
                    type="number"
                    min="0.001"
                    step="0.01"
                    value={row.quantity}
                    onChange={(e) => patchLine(idx, { quantity: e.target.value })}
                    placeholder="qty"
                    className="w-20 border rounded px-2 py-1.5 text-sm font-mono text-right"
                  />
                  <button
                    onClick={() => removeLine(idx)}
                    disabled={draft.items.length === 1}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-30 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button onClick={addLine} className="text-purple-600 hover:text-purple-800 text-xs font-semibold flex items-center gap-1">
                <Plus className="w-3 h-3" />
                Add another item
              </button>
            </div>

            {/* Discount + deposit */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Discount (₱)</span>
                <input
                  type="number" min="0" step="1"
                  value={draft.discountCents}
                  onChange={(e) => setDraft({ ...draft, discountCents: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 font-mono text-right"
                  placeholder="0"
                />
              </label>
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Deposit (₱)</span>
                <input
                  type="number" min="0" step="1"
                  value={draft.depositCents}
                  onChange={(e) => setDraft({ ...draft, depositCents: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 font-mono text-right"
                  placeholder="0"
                />
              </label>
            </div>

            {/* Totals preview */}
            <div className="bg-gray-50 rounded p-3 text-sm space-y-1 mb-4">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{formatPeso(draftTotal.subtotal)}</span></div>
              {draftTotal.discount > 0 ? (
                <div className="flex justify-between text-green-700"><span>Discount</span><span className="font-mono">− {formatPeso(draftTotal.discount)}</span></div>
              ) : null}
              <div className="flex justify-between font-bold pt-1 border-t border-gray-300"><span>Total</span><span className="font-mono">{formatPeso(draftTotal.total)}</span></div>
              {draftTotal.deposit > 0 ? (
                <>
                  <div className="flex justify-between text-purple-700"><span>Deposit paid</span><span className="font-mono">− {formatPeso(draftTotal.deposit)}</span></div>
                  <div className="flex justify-between font-bold"><span>Balance due on pickup</span><span className="font-mono">{formatPeso(draftTotal.balance)}</span></div>
                </>
              ) : null}
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setDrawerOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create pre-order'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreOrderRow({
  preOrder, onEdit, onMarkReady, onCancel,
}: {
  preOrder: PreOrder;
  onEdit: () => void;
  onMarkReady: () => void;
  onCancel: () => void;
}) {
  const isReady     = preOrder.status === 'READY';
  const isDone      = preOrder.status === 'PICKED_UP';
  const isCancelled = preOrder.status === 'CANCELLED';
  return (
    <div className="p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-gray-700">{preOrder.preOrderNumber}</span>
          <StatusBadge status={preOrder.status} />
          {preOrder.pickupTime ? (
            <span className="text-xs text-gray-500 font-mono">{preOrder.pickupTime}</span>
          ) : null}
        </div>
        <div className="text-sm font-medium mt-1">
          {preOrder.customer?.name ?? <span className="text-gray-400 italic">Walk-in</span>}
          {preOrder.customer?.contactPhone ? (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-500">
              <Phone className="w-3 h-3" />{preOrder.customer.contactPhone}
            </span>
          ) : null}
        </div>
        {preOrder.inscription ? (
          <div className="text-xs text-gray-600 mt-0.5 italic">&ldquo;{preOrder.inscription}&rdquo;</div>
        ) : null}
        <div className="text-xs text-gray-500 mt-1">
          {preOrder.items.map((i) => `${Number(i.quantity)}× ${i.productName}`).join(' · ')}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-bold font-mono">{formatPeso(preOrder.totalCents)}</div>
        {preOrder.depositCents > 0 && !isDone ? (
          <div className="text-xs text-gray-500">
            Balance{' '}
            <span className="font-mono text-purple-700 font-semibold">{formatPeso(preOrder.balanceCents)}</span>
          </div>
        ) : null}
      </div>
      <div className="flex gap-1">
        {!isDone && !isCancelled ? (
          <>
            {!isReady ? (
              <button
                onClick={onMarkReady}
                title="Mark ready for pickup"
                className="p-2 rounded hover:bg-green-50 text-green-700"
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
            ) : null}
            <button onClick={onEdit} title="Edit" className="p-2 rounded hover:bg-gray-100 text-gray-700">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={onCancel} title="Cancel" className="p-2 rounded hover:bg-red-50 text-red-700">
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-300" />
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: PreOrder['status'] }) {
  const map: Record<PreOrder['status'], { label: string; cls: string }> = {
    DRAFT:        { label: 'Draft',         cls: 'bg-gray-100 text-gray-700' },
    DEPOSIT_PAID: { label: 'Deposit paid',  cls: 'bg-amber-100 text-amber-800' },
    READY:        { label: 'Ready',         cls: 'bg-green-100 text-green-800' },
    PICKED_UP:    { label: 'Picked up',     cls: 'bg-blue-100 text-blue-800' },
    CANCELLED:    { label: 'Cancelled',     cls: 'bg-red-100 text-red-800' },
  };
  const t = map[status];
  return (
    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${t.cls}`}>
      {t.label}
    </span>
  );
}
