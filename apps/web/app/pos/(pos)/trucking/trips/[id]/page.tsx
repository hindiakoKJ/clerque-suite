'use client';
/**
 * Trip Ticket detail — header + cargo + financials + liquidation receipts.
 *
 * Liquidation upload flow:
 *   1. (optional) POST /documents/upload  → returns { url } for the receipt image
 *   2. POST /trucking/trips/:id/liquidation { category, amount, description, receiptImageUrl }
 *      Service-side recomputes receiptsTotal + variance.
 */
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Truck, MapPin, ChevronRight, User as UserIcon,
  Receipt, Plus, Image as ImageIcon, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type TripStatus =
  | 'DRAFT' | 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED'
  | 'RETURNED' | 'LIQUIDATED' | 'CANCELLED';

interface LiquidationItem {
  id: string;
  category: string;
  amount: string;
  description: string | null;
  receiptImageUrl: string | null;
  createdAt: string;
}

interface TripDetail {
  id:                  string;
  tripNumber:          string;
  status:              TripStatus;
  originLabel:         string;
  destinationLabel:    string;
  cargoDescription:    string | null;
  cargoWeightKg:       string | null;
  freightAmount:       string;
  cashAdvance:         string;
  receiptsTotal:       string;
  liquidationVariance: string | null;
  notes:               string | null;
  dispatchedAt:        string | null;
  deliveredAt:         string | null;
  liquidatedAt:        string | null;
  createdAt:           string;
  fleetAsset:          { id: string; plateNumber: string; kind: string; mileageKm: number | null };
  driver:              { id: string; name: string };
  helper:              { id: string; name: string } | null;
  customer:            { id: string; name: string } | null;
  branch:              { id: string; name: string } | null;
  liquidation:         LiquidationItem[];
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

const CATEGORIES = ['FUEL', 'TOLL', 'MEALS', 'PARKING', 'REPAIR', 'OTHER'] as const;

function fmtPeso(n: string | number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function TripDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const qc = useQueryClient();

  const { data: trip, isLoading } = useQuery<TripDetail>({
    queryKey: ['trip', id],
    queryFn:  () => api.get(`/trucking/trips/${id}`).then((r) => r.data),
    enabled:  !!id,
  });

  const setStatus = useMutation({
    mutationFn: (status: TripStatus) =>
      api.patch(`/trucking/trips/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip', id] });
      qc.invalidateQueries({ queryKey: ['trucking-trips'] });
      toast.success('Trip status updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  if (isLoading) {
    return <div className="p-10 text-sm text-muted-foreground">Loading trip…</div>;
  }
  if (!trip) {
    return <div className="p-10 text-sm text-muted-foreground">Trip not found.</div>;
  }

  const variance = trip.liquidationVariance != null ? Number(trip.liquidationVariance) : null;
  const isOver = variance != null && variance < 0;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Truck className="h-5 w-5 text-muted-foreground shrink-0" />
          <h1 className="text-xl font-semibold font-mono truncate">{trip.tripNumber}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_TINT[trip.status]}`}>
            {trip.status.replace('_', ' ')}
          </span>
        </div>

        {NEXT_STATUS[trip.status] && (
          <div className="flex items-center gap-2 flex-wrap">
            {NEXT_STATUS[trip.status]!.map((next) => (
              <button
                key={next}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate(next)}
                className={
                  'px-2.5 py-1.5 rounded text-xs font-medium border transition-colors disabled:opacity-50 ' +
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
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        {/* Route + cargo */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span className="font-medium text-foreground">{trip.originLabel}</span>
            <ChevronRight className="h-4 w-4" />
            <span className="font-medium text-foreground">{trip.destinationLabel}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Vehicle" value={trip.fleetAsset.plateNumber} mono />
            <Stat label="Driver" value={trip.driver.name} icon={<UserIcon className="h-3 w-3" />} />
            {trip.helper && <Stat label="Helper" value={trip.helper.name} />}
            {trip.customer && <Stat label="Customer" value={trip.customer.name} />}
            {trip.branch && <Stat label="Branch" value={trip.branch.name} />}
            {trip.cargoDescription && <Stat label="Cargo" value={trip.cargoDescription} />}
            {trip.cargoWeightKg && <Stat label="Weight" value={`${trip.cargoWeightKg} kg`} />}
          </div>
          {trip.notes && (
            <div className="text-xs text-muted-foreground border-t border-border pt-2">
              <span className="font-medium">Notes:</span> {trip.notes}
            </div>
          )}
        </div>

        {/* Financials */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Receipt className="h-4 w-4" /> Financials
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Money label="Freight" value={trip.freightAmount} />
            <Money label="Cash advance" value={trip.cashAdvance} />
            <Money label="Receipts total" value={trip.receiptsTotal} />
            <Money
              label={isOver ? 'OVERSPEND' : 'Cash on hand'}
              value={variance != null ? Math.abs(variance) : null}
              tone={isOver ? 'red' : variance != null && variance > 0 ? 'green' : undefined}
            />
          </div>
          <div className="text-xs text-muted-foreground border-t border-border pt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>Created: {fmtDate(trip.createdAt)}</span>
            {trip.dispatchedAt && <span>Dispatched: {fmtDate(trip.dispatchedAt)}</span>}
            {trip.deliveredAt && <span>Delivered: {fmtDate(trip.deliveredAt)}</span>}
            {trip.liquidatedAt && <span>Liquidated: {fmtDate(trip.liquidatedAt)}</span>}
          </div>
        </div>

        {/* Liquidation */}
        <LiquidationSection
          tripId={trip.id}
          status={trip.status}
          items={trip.liquidation}
          onChange={() => qc.invalidateQueries({ queryKey: ['trip', id] })}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, mono, icon }: {
  label: string; value: string; mono?: boolean; icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={'text-sm font-medium flex items-center gap-1 ' + (mono ? 'font-mono' : '')}>
        {icon}{value}
      </div>
    </div>
  );
}

function Money({ label, value, tone }: {
  label: string;
  value: string | number | null;
  tone?: 'red' | 'green';
}) {
  const cls =
    tone === 'red' ? 'text-red-600' :
    tone === 'green' ? 'text-emerald-700 dark:text-emerald-400' :
    'text-foreground';
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-mono font-semibold ${cls}`}>{fmtPeso(value)}</div>
    </div>
  );
}

function LiquidationSection({
  tripId, status, items, onChange,
}: {
  tripId: string;
  status: TripStatus;
  items: LiquidationItem[];
  onChange: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const canAdd = status !== 'LIQUIDATED' && status !== 'CANCELLED';

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Receipt className="h-4 w-4" /> Liquidation receipts ({items.length})
        </h3>
        {canAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Add Receipt
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          No receipts yet. Drivers add fuel/toll/meals receipts here for liquidation.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((it) => (
            <div key={it.id} className="py-2.5 flex items-start gap-3">
              {it.receiptImageUrl ? (
                <a
                  href={it.receiptImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 h-12 w-12 rounded-md border border-border bg-muted/30 flex items-center justify-center hover:bg-muted overflow-hidden"
                  title="Open receipt image"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.receiptImageUrl} alt="receipt" className="h-full w-full object-cover" />
                </a>
              ) : (
                <div className="shrink-0 h-12 w-12 rounded-md border border-dashed border-border bg-muted/20 flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded">
                    {it.category}
                  </span>
                  <span className="text-sm font-mono font-semibold">{fmtPeso(it.amount)}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(it.createdAt)}</span>
                </div>
                {it.description && (
                  <div className="text-xs text-muted-foreground mt-0.5">{it.description}</div>
                )}
              </div>
              {it.receiptImageUrl && (
                <a
                  href={it.receiptImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title="View receipt"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddLiquidationModal
          tripId={tripId}
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); onChange(); }}
        />
      )}
    </div>
  );
}

function AddLiquidationModal({
  tripId, onClose, onSuccess,
}: {
  tripId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [category, setCategory] = useState<typeof CATEGORIES[number] | string>('FUEL');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const num = Number(amount);
    if (!num || num <= 0) {
      toast.error('Amount must be greater than 0.');
      return;
    }
    setBusy(true);
    try {
      let receiptImageUrl: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('entityType', 'TripTicket');
        fd.append('entityId',   tripId);
        fd.append('label',      `${category} receipt`);
        const up = await api.post('/documents/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        }).then((r) => r.data);
        receiptImageUrl = up?.url ?? up?.fileUrl ?? up?.publicUrl;
      }

      await api.post(`/trucking/trips/${tripId}/liquidation`, {
        category,
        amount: num,
        description: description.trim() || undefined,
        receiptImageUrl,
      });
      toast.success('Receipt added.');
      onSuccess();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to add receipt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">Add liquidation receipt</h3>
        </header>

        <div className="p-5 space-y-3">
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Category *</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Amount ₱ *</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          </label>

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Description</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Petron NLEX, OR #12345"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Receipt image (optional)</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full text-xs"
            />
            {file && (
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
            )}
          </label>
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2 border-t border-border pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !amount}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Add Receipt'}
          </button>
        </footer>
      </div>
    </div>
  );
}
