'use client';

/**
 * Clerque Cloud — Rentals (DME / Medical Equipment)
 *
 * Lease workflow for serialized equipment (wheelchairs, CPAP machines,
 * hospital beds, etc.). Lists every open + overdue rental, lets the
 * front desk open new rentals against IN_STOCK units and return them.
 *
 * V1 (this page):
 *   • List with status filter + branch filter
 *   • Open rental drawer (customer, unit, rate, deposit, due date)
 *   • Return rental (damage fee + refund computation)
 *   • Mark lost
 *
 * Cash flow for V1: deposit is rung as a normal Counter sale on the till
 * BEFORE opening the rental (cashier picks a "Wheelchair deposit" service
 * line). After tendering, the cashier copies the OR# into the depositOrderId
 * field here. V2 will bake this into a one-tap "Take deposit + Open rental"
 * cart row.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Wrench, CheckCircle2, X, AlertTriangle, Clock, Package,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';

interface Branch    { id: string; name: string; }
interface Customer  { id: string; name: string; contactPhone: string | null; }
interface UnitLite  {
  id: string;
  serialNumber: string;
  status: 'IN_STOCK' | 'SOLD' | 'ON_RENT' | 'IN_REPAIR' | 'RETIRED';
  product: { id: string; name: string; sku: string | null; price: number | string };
  branch: { id: string; name: string };
}

interface Rental {
  id: string;
  status: 'OPEN' | 'RETURNED' | 'OVERDUE' | 'LOST';
  rentalRate: number | string;
  rateUnit: string;
  depositCents: number;
  damageFeeCents: number;
  refundCents: number;
  startedAt: string;
  dueAt: string;
  returnedAt: string | null;
  intakeNotes: string | null;
  returnNotes: string | null;
  depositOrderId: string | null;
  returnOrderId: string | null;
  customer: { id: string; name: string; contactPhone: string | null };
  serializedUnit: {
    id: string;
    serialNumber: string;
    product: { id: string; name: string };
  };
  createdBy: { id: string; name: string };
}

interface OpenDraft {
  branchId: string;
  customerId: string;
  serializedUnitId: string;
  rentalRate: string;
  rateUnit: 'day' | 'week' | 'month';
  depositCents: string;     // pesos
  dueAt: string;            // YYYY-MM-DD
  intakeNotes: string;
  depositOrderId: string;
}

interface ReturnDraft {
  damageFeeCents: string;
  returnNotes: string;
  returnOrderId: string;
}

const EMPTY_OPEN: OpenDraft = {
  branchId: '',
  customerId: '',
  serializedUnitId: '',
  rentalRate: '',
  rateUnit: 'day',
  depositCents: '',
  dueAt: '',
  intakeNotes: '',
  depositOrderId: '',
};
const EMPTY_RETURN: ReturnDraft = {
  damageFeeCents: '',
  returnNotes: '',
  returnOrderId: '',
};

export default function RentalsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userBranchId = user?.branchId ?? undefined;

  const [showOpenDrawer, setShowOpenDrawer]   = useState(false);
  const [returningRental, setReturningRental] = useState<Rental | null>(null);
  const [openDraft,   setOpenDraft]   = useState<OpenDraft>(EMPTY_OPEN);
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>(EMPTY_RETURN);
  const [saving, setSaving] = useState(false);

  const branchesQ = useQuery<Branch[]>({
    queryKey: ['rentals', 'branches'],
    queryFn: () => api.get('/branches').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const customersQ = useQuery<Customer[]>({
    queryKey: ['rentals', 'customers'],
    queryFn: () => api.get('/customers').then((r) => r.data),
    staleTime: 60_000,
  });
  const unitsQ = useQuery<UnitLite[]>({
    queryKey: ['rentals', 'units', 'in-stock'],
    queryFn: () => api.get('/serialized-units', {
      params: { status: 'IN_STOCK' },
    }).then((r) => r.data),
    staleTime: 30_000,
  });
  const rentalsQ = useQuery<Rental[]>({
    queryKey: ['rentals', 'list'],
    queryFn: () => api.get('/rentals').then((r) => r.data),
    staleTime: 30_000,
  });

  const openCount    = useMemo(() => (rentalsQ.data ?? []).filter((r) => r.status === 'OPEN').length, [rentalsQ.data]);
  const overdueCount = useMemo(() => (rentalsQ.data ?? []).filter((r) => r.status === 'OVERDUE').length, [rentalsQ.data]);
  const expectedRefundable = useMemo(
    () => (rentalsQ.data ?? [])
      .filter((r) => r.status === 'OPEN' || r.status === 'OVERDUE')
      .reduce((a, r) => a + r.depositCents, 0),
    [rentalsQ.data],
  );

  const startNew = () => {
    setOpenDraft({
      ...EMPTY_OPEN,
      branchId: userBranchId ?? branchesQ.data?.[0]?.id ?? '',
      dueAt: tomorrowYmd(),
    });
    setShowOpenDrawer(true);
  };

  const saveOpen = async () => {
    if (!openDraft.serializedUnitId) { toast.error('Pick a unit to rent out.'); return; }
    if (!openDraft.customerId) { toast.error('Renter is required.'); return; }
    if (!openDraft.dueAt) { toast.error('Due date is required.'); return; }
    setSaving(true);
    try {
      await api.post('/rentals', {
        branchId:         openDraft.branchId,
        customerId:       openDraft.customerId,
        serializedUnitId: openDraft.serializedUnitId,
        rentalRate:       Number(openDraft.rentalRate) || 0,
        rateUnit:         openDraft.rateUnit,
        depositCents:     Math.round((Number(openDraft.depositCents) || 0) * 100),
        dueAt:            openDraft.dueAt,
        intakeNotes:      openDraft.intakeNotes || undefined,
        depositOrderId:   openDraft.depositOrderId || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['rentals'] });
      toast.success('Rental opened');
      setShowOpenDrawer(false);
      setOpenDraft(EMPTY_OPEN);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open rental');
    } finally {
      setSaving(false);
    }
  };

  const startReturn = (r: Rental) => {
    setReturningRental(r);
    setReturnDraft({
      damageFeeCents: '',
      returnNotes:    '',
      returnOrderId:  '',
    });
  };

  const saveReturn = async () => {
    if (!returningRental) return;
    setSaving(true);
    try {
      await api.post(`/rentals/${returningRental.id}/return`, {
        damageFeeCents: Math.round((Number(returnDraft.damageFeeCents) || 0) * 100),
        returnNotes:    returnDraft.returnNotes || undefined,
        returnOrderId:  returnDraft.returnOrderId || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['rentals'] });
      toast.success(`Returned · refund ${formatPeso(refundPreview())}`);
      setReturningRental(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Return failed');
    } finally {
      setSaving(false);
    }
  };

  const refundPreview = (): number => {
    if (!returningRental) return 0;
    const damage = Math.round((Number(returnDraft.damageFeeCents) || 0) * 100);
    return Math.max(0, returningRental.depositCents - damage);
  };

  const markLost = async (r: Rental) => {
    if (!window.confirm(`Mark "${r.serializedUnit.serialNumber}" as lost? Deposit is forfeited and the unit retires.`)) return;
    try {
      await api.post(`/rentals/${r.id}/mark-lost`);
      await qc.invalidateQueries({ queryKey: ['rentals'] });
      toast.success('Marked lost');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6 text-purple-600" />
            Rentals
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            DME lease workflow — wheelchairs, CPAP machines, hospital beds, anything serialized.
            Open a rental against an IN_STOCK unit, capture deposit, return when due.
          </p>
        </div>
        <button
          onClick={startNew}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Open rental
        </button>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Currently out" value={String(openCount)} icon={<Wrench className="w-4 h-4 text-purple-600" />} />
        <StatCard label="Overdue"        value={String(overdueCount)} tone={overdueCount > 0 ? 'warning' : 'default'} icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} />
        <StatCard label="Deposits held"   value={formatPeso(expectedRefundable)} icon={<Clock className="w-4 h-4 text-blue-600" />} />
      </div>

      {/* List */}
      {rentalsQ.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (rentalsQ.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No rentals yet. Tap <b>Open rental</b> to start one.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {rentalsQ.data!.map((r) => (
            <RentalRow
              key={r.id}
              rental={r}
              onReturn={() => startReturn(r)}
              onLost={() => void markLost(r)}
            />
          ))}
        </div>
      )}

      {/* Open drawer */}
      {showOpenDrawer ? (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setShowOpenDrawer(false)}>
          <div className="bg-white w-full max-w-lg h-full overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Open rental</h3>
              <button onClick={() => setShowOpenDrawer(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600 mb-4">
              <b>Cashflow order:</b> ring the deposit on the till FIRST (as a service line),
              then enter the resulting OR# below. We open the rental against the receipt.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
              <Field label="Branch">
                <select value={openDraft.branchId} onChange={(e) => setOpenDraft({ ...openDraft, branchId: e.target.value })} className="w-full border rounded px-2 py-1.5">
                  <option value="">Select…</option>
                  {branchesQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Renter">
                <select value={openDraft.customerId} onChange={(e) => setOpenDraft({ ...openDraft, customerId: e.target.value })} className="w-full border rounded px-2 py-1.5">
                  <option value="">Select customer…</option>
                  {customersQ.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Unit to rent (IN_STOCK only)">
              <select value={openDraft.serializedUnitId} onChange={(e) => setOpenDraft({ ...openDraft, serializedUnitId: e.target.value })} className="w-full border rounded px-2 py-1.5 text-sm">
                <option value="">Select unit…</option>
                {unitsQ.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.product.name} · SN {u.serialNumber} · {u.branch.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
              <Field label="Rental rate (₱)">
                <input type="number" min="0" step="0.01" value={openDraft.rentalRate} onChange={(e) => setOpenDraft({ ...openDraft, rentalRate: e.target.value })} className="w-full border rounded px-2 py-1.5 font-mono text-right" placeholder="500" />
              </Field>
              <Field label="Per">
                <select value={openDraft.rateUnit} onChange={(e) => setOpenDraft({ ...openDraft, rateUnit: e.target.value as OpenDraft['rateUnit'] })} className="w-full border rounded px-2 py-1.5">
                  <option value="day">day</option>
                  <option value="week">week</option>
                  <option value="month">month</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
              <Field label="Deposit (₱)">
                <input type="number" min="0" step="1" value={openDraft.depositCents} onChange={(e) => setOpenDraft({ ...openDraft, depositCents: e.target.value })} className="w-full border rounded px-2 py-1.5 font-mono text-right" placeholder="3000" />
              </Field>
              <Field label="Due date">
                <input type="date" value={openDraft.dueAt} onChange={(e) => setOpenDraft({ ...openDraft, dueAt: e.target.value })} className="w-full border rounded px-2 py-1.5" />
              </Field>
            </div>

            <div className="mt-3 text-sm">
              <Field label="Deposit OR# (optional, links the receipt)">
                <input value={openDraft.depositOrderId} onChange={(e) => setOpenDraft({ ...openDraft, depositOrderId: e.target.value })} placeholder="e.g. ORD-2026-000123 (paste after ringing)" className="w-full border rounded px-2 py-1.5 font-mono" />
              </Field>
            </div>

            <div className="mt-3 text-sm">
              <Field label="Intake condition notes">
                <textarea rows={2} value={openDraft.intakeNotes} onChange={(e) => setOpenDraft({ ...openDraft, intakeNotes: e.target.value })} placeholder="Working condition. Includes charger. Minor scuff on left arm." className="w-full border rounded px-2 py-1.5" />
              </Field>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowOpenDrawer(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Cancel</button>
              <button onClick={saveOpen} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Open rental'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Return drawer */}
      {returningRental ? (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setReturningRental(null)}>
          <div className="bg-white w-full max-w-md h-full overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Return rental</h3>
              <button onClick={() => setReturningRental(null)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-gray-50 rounded p-3 text-sm mb-4 space-y-1">
              <div><b>Unit:</b> {returningRental.serializedUnit.product.name} (SN {returningRental.serializedUnit.serialNumber})</div>
              <div><b>Renter:</b> {returningRental.customer.name}</div>
              <div><b>Deposit:</b> <span className="font-mono">{formatPeso(returningRental.depositCents)}</span></div>
              <div><b>Due:</b> {new Date(returningRental.dueAt).toLocaleDateString()}</div>
            </div>

            <Field label="Damage fee (₱) — deducted from deposit">
              <input type="number" min="0" step="1" value={returnDraft.damageFeeCents} onChange={(e) => setReturnDraft({ ...returnDraft, damageFeeCents: e.target.value })} placeholder="0" className="w-full border rounded px-2 py-1.5 font-mono text-right" />
            </Field>
            <Field label="Return condition notes">
              <textarea rows={2} value={returnDraft.returnNotes} onChange={(e) => setReturnDraft({ ...returnDraft, returnNotes: e.target.value })} className="w-full border rounded px-2 py-1.5" />
            </Field>
            <Field label="Damage-fee OR# (optional)">
              <input value={returnDraft.returnOrderId} onChange={(e) => setReturnDraft({ ...returnDraft, returnOrderId: e.target.value })} placeholder="Paste after ringing the damage fee" className="w-full border rounded px-2 py-1.5 font-mono" />
            </Field>

            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm mt-4">
              <div className="flex justify-between font-bold">
                <span>Refund to renter</span>
                <span className="font-mono">{formatPeso(refundPreview())}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setReturningRental(null)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Cancel</button>
              <button onClick={saveReturn} disabled={saving} className="bg-green-700 hover:bg-green-800 text-white px-4 py-2 rounded font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Confirm return'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function tomorrowYmd(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  return d.toISOString().slice(0, 10);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm block mb-2">
      <span className="block text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function StatCard({
  label, value, icon, tone = 'default',
}: { label: string; value: string; icon: React.ReactNode; tone?: 'default' | 'warning' }) {
  return (
    <div className={`p-4 rounded-lg border ${tone === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-700">{icon}{label}</div>
      <div className="text-2xl font-extrabold mt-1 font-mono">{value}</div>
    </div>
  );
}

function RentalRow({
  rental, onReturn, onLost,
}: {
  rental: Rental;
  onReturn: () => void;
  onLost: () => void;
}) {
  const isReturned = rental.status === 'RETURNED' || rental.status === 'LOST';
  const overdueDays = rental.status === 'OVERDUE'
    ? Math.floor((Date.now() - new Date(rental.dueAt).getTime()) / (24 * 3600_000))
    : 0;
  return (
    <div className="p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[260px]">
        <div className="flex items-center gap-2">
          <StatusBadge status={rental.status} />
          <span className="text-xs text-gray-500 font-mono">
            SN {rental.serializedUnit.serialNumber}
          </span>
          {overdueDays > 0 ? <span className="text-xs text-amber-700 font-semibold">+{overdueDays} day{overdueDays === 1 ? '' : 's'}</span> : null}
        </div>
        <div className="font-medium mt-1">{rental.serializedUnit.product.name}</div>
        <div className="text-xs text-gray-600 mt-0.5">
          Renter: <b>{rental.customer.name}</b>
          {rental.customer.contactPhone ? <span className="ml-2">{rental.customer.contactPhone}</span> : null}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {formatPeso(Math.round(Number(rental.rentalRate) * 100))} / {rental.rateUnit}
          {' · '}due {new Date(rental.dueAt).toLocaleDateString()}
        </div>
        {rental.intakeNotes ? <div className="text-xs italic text-gray-500 mt-1">"{rental.intakeNotes}"</div> : null}
      </div>
      <div className="text-right">
        <div className="text-xs text-gray-500">Deposit</div>
        <div className="font-mono font-bold">{formatPeso(rental.depositCents)}</div>
        {isReturned ? (
          <div className="text-xs text-gray-500 mt-0.5">refund {formatPeso(rental.refundCents)}</div>
        ) : null}
      </div>
      {!isReturned ? (
        <div className="flex gap-1">
          <button
            onClick={onReturn}
            className="bg-green-700 hover:bg-green-800 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Return
          </button>
          <button onClick={onLost} className="text-xs text-red-700 hover:text-red-900 px-2">Mark lost</button>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: Rental['status'] }) {
  const map: Record<Rental['status'], { label: string; cls: string }> = {
    OPEN:     { label: 'Open',     cls: 'bg-purple-100 text-purple-800' },
    OVERDUE:  { label: 'Overdue',  cls: 'bg-amber-100 text-amber-800' },
    RETURNED: { label: 'Returned', cls: 'bg-green-100 text-green-800' },
    LOST:     { label: 'Lost',     cls: 'bg-red-100 text-red-800' },
  };
  const t = map[status];
  return <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${t.cls}`}>{t.label}</span>;
}
