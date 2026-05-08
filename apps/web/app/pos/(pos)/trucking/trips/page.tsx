'use client';
/**
 * Trucking → Trip Tickets
 *
 * Lifecycle:  DRAFT → DISPATCHED → IN_TRANSIT → DELIVERED → LIQUIDATED
 *                  ↘ CANCELLED at any pre-LIQ step.
 *
 * Status board with column filter; click a trip to see liquidation receipts +
 * variance. Status transitions from inline action buttons.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, ArrowLeft, ChevronRight, MapPin, User as UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type TripStatus =
  | 'DRAFT' | 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED'
  | 'RETURNED' | 'LIQUIDATED' | 'CANCELLED';

interface Trip {
  id:                string;
  tripNumber:        string;
  status:            TripStatus;
  originLabel:       string;
  destinationLabel:  string;
  cargoDescription:  string | null;
  freightAmount:     string;
  cashAdvance:       string;
  receiptsTotal:     string;
  liquidationVariance: string | null;
  dispatchedAt:      string | null;
  deliveredAt:       string | null;
  liquidatedAt:      string | null;
  fleetAsset:        { plateNumber: string };
  driver:            { id: string; name: string };
}

const STATUS_TINT: Record<TripStatus, string> = {
  DRAFT:       'bg-muted text-muted-foreground',
  DISPATCHED:  'bg-blue-500/15 text-blue-600',
  IN_TRANSIT:  'bg-purple-500/15 text-purple-600',
  DELIVERED:   'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  RETURNED:    'bg-amber-500/15 text-amber-700',
  LIQUIDATED:  'bg-foreground/10 text-foreground',
  CANCELLED:   'bg-red-500/10 text-red-600',
};

const NEXT_STATUS: Partial<Record<TripStatus, TripStatus[]>> = {
  DRAFT:      ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'RETURNED', 'CANCELLED'],
  DELIVERED:  ['LIQUIDATED'],
  RETURNED:   ['LIQUIDATED'],
};

function fmtPeso(n: string | number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}

export default function TripsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<TripStatus | 'ALL'>('ALL');
  const [showNew, setShowNew] = useState(false);

  const { data: trips = [] } = useQuery<Trip[]>({
    queryKey: ['trucking-trips', filter],
    queryFn:  () => api.get('/trucking/trips', { params: filter !== 'ALL' ? { status: filter } : {} }).then((r) => r.data),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TripStatus }) =>
      api.patch(`/trucking/trips/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trucking-trips'] });
      toast.success('Trip status updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Truck className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Trip Tickets</h1>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Trip
        </button>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        <div className="flex items-center gap-2 flex-wrap">
          {(['ALL', 'DRAFT', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'LIQUIDATED', 'CANCELLED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={
                'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ' +
                (filter === s
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-border text-muted-foreground hover:bg-muted')
              }
            >
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {trips.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              No trips for this filter.
            </div>
          ) : (
            trips.map((t) => (
              <div key={t.id} className="rounded-xl border border-border bg-card p-4 hover:bg-muted/20 transition-colors">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{t.tripNumber}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_TINT[t.status]}`}>
                        {t.status.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">{t.fleetAsset.plateNumber}</span>
                    </div>
                    <div className="mt-1.5 text-sm flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>{t.originLabel}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                      <span>{t.destinationLabel}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                      <span><UserIcon className="h-3 w-3 inline mr-0.5" />{t.driver.name}</span>
                      {t.cargoDescription && <span>· {t.cargoDescription}</span>}
                    </div>
                  </div>

                  <div className="flex items-end flex-col gap-1 shrink-0">
                    <div className="text-sm">
                      <span className="text-muted-foreground text-xs">Freight: </span>
                      <span className="font-mono font-semibold">{fmtPeso(t.freightAmount)}</span>
                    </div>
                    {Number(t.cashAdvance) > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Adv: <span className="font-mono">{fmtPeso(t.cashAdvance)}</span>
                        {' · '}
                        Receipts: <span className="font-mono">{fmtPeso(t.receiptsTotal)}</span>
                        {t.liquidationVariance != null && (
                          <span className={
                            'ml-1 ' + (Number(t.liquidationVariance) < 0 ? 'text-red-600 font-semibold' : '')
                          }>
                            ({Number(t.liquidationVariance) < 0 ? 'OVER' : 'left'} {fmtPeso(Math.abs(Number(t.liquidationVariance)))})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {NEXT_STATUS[t.status] && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {NEXT_STATUS[t.status]!.map((next) => (
                      <button
                        key={next}
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: t.id, status: next })}
                        className={
                          'px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-50 ' +
                          (next === 'CANCELLED'
                            ? 'border-red-300 text-red-600 hover:bg-red-500/10'
                            : 'border-border hover:bg-muted')
                        }
                      >
                        → {next.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showNew && (
        <NewTripModal
          onClose={() => setShowNew(false)}
          onSuccess={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ['trucking-trips'] });
          }}
        />
      )}
    </div>
  );
}

function NewTripModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { data: assets = [] }   = useQuery<{ id: string; plateNumber: string }[]>({
    queryKey: ['trucking-assets'],
    queryFn:  () => api.get('/trucking/assets', { params: { activeOnly: 'true' } }).then((r) => r.data),
  });
  const { data: users = [] }    = useQuery<{ id: string; name: string }[]>({
    queryKey: ['users'],
    queryFn:  () => api.get('/users').then((r) => r.data),
  });
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });

  const [form, setForm] = useState({
    branchId: '', fleetAssetId: '', driverId: '', helperId: '',
    originLabel: '', destinationLabel: '',
    cargoDescription: '', cargoWeightKg: '',
    freightAmount: '', cashAdvance: '0',
    notes: '',
  });
  function f<K extends keyof typeof form>(k: K, v: any) { setForm((s) => ({ ...s, [k]: v })); }

  const mut = useMutation({
    mutationFn: () => api.post('/trucking/trips', {
      branchId:         form.branchId,
      fleetAssetId:     form.fleetAssetId,
      driverId:         form.driverId,
      helperId:         form.helperId || undefined,
      originLabel:      form.originLabel.trim(),
      destinationLabel: form.destinationLabel.trim(),
      cargoDescription: form.cargoDescription.trim() || undefined,
      cargoWeightKg:    form.cargoWeightKg ? Number(form.cargoWeightKg) : undefined,
      freightAmount:    Number(form.freightAmount),
      cashAdvance:      Number(form.cashAdvance) || 0,
      notes:            form.notes.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: () => { toast.success('Trip created.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-base font-semibold">New Trip Ticket</h3>
        </header>

        <div className="p-5 space-y-3">
          <Sel label="Branch *" v={form.branchId} on={(v) => f('branchId', v)} opts={branches.map((b) => ({ v: b.id, l: b.name }))} />
          <Sel label="Vehicle *" v={form.fleetAssetId} on={(v) => f('fleetAssetId', v)} opts={assets.map((a) => ({ v: a.id, l: a.plateNumber }))} />
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Driver *" v={form.driverId} on={(v) => f('driverId', v)} opts={users.map((u) => ({ v: u.id, l: u.name }))} />
            <Sel label="Helper" v={form.helperId} on={(v) => f('helperId', v)} opts={users.map((u) => ({ v: u.id, l: u.name }))} optional />
          </div>
          <Field label="Origin *" v={form.originLabel} on={(v) => f('originLabel', v)} placeholder="e.g. Manila Warehouse" />
          <Field label="Destination *" v={form.destinationLabel} on={(v) => f('destinationLabel', v)} placeholder="e.g. Cebu Distribution Center" />
          <Field label="Cargo description" v={form.cargoDescription} on={(v) => f('cargoDescription', v)} />
          <Field label="Cargo weight (kg)" v={form.cargoWeightKg} on={(v) => f('cargoWeightKg', v)} type="number" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Freight ₱ *" v={form.freightAmount} on={(v) => f('freightAmount', v)} type="number" />
            <Field label="Cash advance ₱" v={form.cashAdvance} on={(v) => f('cashAdvance', v)} type="number" />
          </div>
          <Field label="Notes" v={form.notes} on={(v) => f('notes', v)} />
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2 sticky bottom-0 bg-card border-t border-border pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.branchId || !form.fleetAssetId || !form.driverId || !form.originLabel || !form.destinationLabel || !form.freightAmount}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Create Trip'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, v, on, type = 'text', placeholder }: {
  label: string; v: string; on: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="text-sm block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type} value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

function Sel({ label, v, on, opts, optional }: {
  label: string; v: string; on: (v: string) => void; opts: { v: string; l: string }[]; optional?: boolean;
}) {
  return (
    <label className="text-sm block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select value={v} onChange={(e) => on(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
        <option value="">{optional ? '— none —' : '— select —'}</option>
        {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
