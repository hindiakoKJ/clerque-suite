'use client';
/**
 * Job Order detail — header, status timeline, line editor.
 *
 * Lines have 4 kinds:
 *   LABOR       — billable technician time (technicianId optional, productId N/A)
 *   PART        — physical part installed (productId required)
 *   CONSUMABLE  — minor materials like grease/wipes (productId required)
 *   SUBLET      — outsourced work to a third-party shop (no product)
 *
 * Locked once status reaches CLAIMED or CANCELLED.
 */
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Briefcase, Plus, Trash2,
  Wrench, Package, Sparkles, ExternalLink, Receipt,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Status =
  | 'DRAFT' | 'DIAGNOSING' | 'AWAITING_APPROVAL' | 'AWAITING_PARTS'
  | 'IN_PROGRESS' | 'QC' | 'READY_FOR_PICKUP' | 'CLAIMED' | 'CANCELLED';

type LineKind = 'LABOR' | 'PART' | 'CONSUMABLE' | 'SUBLET';

interface JobOrderLine {
  id:           string;
  kind:         LineKind;
  description:  string;
  quantity:     string;
  unitPrice:    string;
  lineTotal:    string;
  notes:        string | null;
  product:      { id: string; name: string; sku: string | null } | null;
  technician:   { id: string; name: string } | null;
}

interface JobOrderDetail {
  id:                string;
  jobNumber:         string;
  status:            Status;
  itemDescription:   string;
  customerComplaint: string | null;
  diagnosis:         string | null;
  estimateAmount:    string | null;
  totalAmount:       string;
  promisedAt:        string | null;
  startedAt:         string | null;
  completedAt:       string | null;
  claimedAt:         string | null;
  estimateApprovedAt:string | null;
  notes:             string | null;
  branch:            { id: string; name: string } | null;
  customer:          { id: string; name: string } | null;
  assignedTo:        { id: string; name: string } | null;
  order:             { id: string; orderNumber: string; status: string } | null;
  lines:             JobOrderLine[];
}

const STATUS_TINT: Record<Status, string> = {
  DRAFT:             'bg-muted text-muted-foreground',
  DIAGNOSING:        'bg-blue-500/15 text-blue-600',
  AWAITING_APPROVAL: 'bg-amber-500/15 text-amber-700',
  AWAITING_PARTS:    'bg-orange-500/15 text-orange-700',
  IN_PROGRESS:       'bg-purple-500/15 text-purple-700',
  QC:                'bg-cyan-500/15 text-cyan-700',
  READY_FOR_PICKUP:  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  CLAIMED:           'bg-foreground/10 text-foreground',
  CANCELLED:         'bg-red-500/10 text-red-600',
};

const NEXT_STATUS: Partial<Record<Status, Status[]>> = {
  DRAFT:             ['DIAGNOSING', 'CANCELLED'],
  DIAGNOSING:        ['AWAITING_APPROVAL', 'CANCELLED'],
  AWAITING_APPROVAL: ['AWAITING_PARTS', 'IN_PROGRESS', 'CANCELLED'],
  AWAITING_PARTS:    ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS:       ['QC', 'CANCELLED'],
  QC:                ['READY_FOR_PICKUP', 'IN_PROGRESS'],
  READY_FOR_PICKUP:  ['CLAIMED'],
};

const KIND_ICON: Record<LineKind, React.ReactNode> = {
  LABOR:      <Wrench className="h-3.5 w-3.5" />,
  PART:       <Package className="h-3.5 w-3.5" />,
  CONSUMABLE: <Sparkles className="h-3.5 w-3.5" />,
  SUBLET:     <ExternalLink className="h-3.5 w-3.5" />,
};

const KIND_TINT: Record<LineKind, string> = {
  LABOR:      'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  PART:       'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  CONSUMABLE: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400',
  SUBLET:     'bg-amber-500/15 text-amber-700 dark:text-amber-400',
};

function fmtPeso(n: string | number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function JobOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const qc = useQueryClient();

  const { data: jo, isLoading } = useQuery<JobOrderDetail>({
    queryKey: ['job-order', id],
    queryFn:  () => api.get(`/job-orders/${id}`).then((r) => r.data),
    enabled:  !!id,
  });

  const setStatus = useMutation({
    mutationFn: (status: Status) =>
      api.patch(`/job-orders/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-order', id] });
      qc.invalidateQueries({ queryKey: ['job-orders'] });
      toast.success('Status updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  if (isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  if (!jo)        return <div className="p-10 text-sm text-muted-foreground">Job order not found.</div>;

  const locked = jo.status === 'CLAIMED' || jo.status === 'CANCELLED';

  const totals = jo.lines.reduce(
    (acc, l) => {
      acc[l.kind] = (acc[l.kind] ?? 0) + Number(l.lineTotal);
      return acc;
    },
    {} as Record<LineKind, number>,
  );

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Briefcase className="h-5 w-5 text-muted-foreground shrink-0" />
          <h1 className="text-xl font-semibold font-mono truncate">{jo.jobNumber}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_TINT[jo.status]}`}>
            {jo.status.replace(/_/g, ' ')}
          </span>
        </div>

        {NEXT_STATUS[jo.status] && (
          <div className="flex items-center gap-2 flex-wrap">
            {NEXT_STATUS[jo.status]!.map((next) => (
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
                → {next.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        {/* Item + complaint */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Item</div>
            <div className="text-base font-medium">{jo.itemDescription}</div>
          </div>
          {jo.customerComplaint && (
            <div className="text-sm">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Customer complaint</div>
              <p className="italic text-muted-foreground">"{jo.customerComplaint}"</p>
            </div>
          )}
          {jo.diagnosis && (
            <div className="text-sm">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Diagnosis</div>
              <p>{jo.diagnosis}</p>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm border-t border-border pt-3">
            {jo.customer && <Stat label="Customer" value={jo.customer.name} />}
            {jo.branch && <Stat label="Branch" value={jo.branch.name} />}
            {jo.assignedTo && <Stat label="Technician" value={jo.assignedTo.name} />}
            {jo.promisedAt && <Stat label="Promised" value={fmtDate(jo.promisedAt)} />}
            {jo.estimateAmount && <Stat label="Estimate" value={fmtPeso(jo.estimateAmount)} mono />}
            {jo.order && (
              <Stat label="Linked invoice" value={jo.order.orderNumber} mono />
            )}
          </div>
          {jo.notes && (
            <div className="text-xs text-muted-foreground border-t border-border pt-2">
              <span className="font-medium">Notes:</span> {jo.notes}
            </div>
          )}
        </div>

        {/* Lines */}
        <LinesEditor
          jobOrderId={jo.id}
          lines={jo.lines}
          locked={locked}
          totals={totals}
          totalAmount={jo.totalAmount}
          onChange={() => qc.invalidateQueries({ queryKey: ['job-order', id] })}
        />

        {/* Timeline footer */}
        <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          {jo.estimateApprovedAt && <span>Estimate approved: {fmtDate(jo.estimateApprovedAt)}</span>}
          {jo.startedAt && <span>Started: {fmtDate(jo.startedAt)}</span>}
          {jo.completedAt && <span>Completed: {fmtDate(jo.completedAt)}</span>}
          {jo.claimedAt && <span>Claimed: {fmtDate(jo.claimedAt)}</span>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={'text-sm font-medium ' + (mono ? 'font-mono' : '')}>{value}</div>
    </div>
  );
}

function LinesEditor({
  jobOrderId, lines, locked, totals, totalAmount, onChange,
}: {
  jobOrderId: string;
  lines: JobOrderLine[];
  locked: boolean;
  totals: Record<LineKind, number>;
  totalAmount: string;
  onChange: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const qc = useQueryClient();

  const del = useMutation({
    mutationFn: (lineId: string) =>
      api.delete(`/job-orders/${jobOrderId}/lines/${lineId}`).then((r) => r.data),
    onSuccess: () => { onChange(); toast.success('Line removed.'); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Receipt className="h-4 w-4" /> Lines ({lines.length})
        </h3>
        {!locked && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Add Line
          </button>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          No lines yet. Add labor, parts, consumables, or sublet work.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {lines.map((l) => (
            <div key={l.id} className="py-2.5 flex items-start gap-3">
              <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${KIND_TINT[l.kind]}`}>
                {KIND_ICON[l.kind]}{l.kind}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{l.description}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {l.quantity} × {fmtPeso(l.unitPrice)}
                  {l.product && <span className="ml-1">· {l.product.name}</span>}
                  {l.technician && <span className="ml-1">· {l.technician.name}</span>}
                </div>
                {l.notes && (
                  <div className="text-[11px] text-muted-foreground italic mt-0.5">{l.notes}</div>
                )}
              </div>
              <div className="font-mono font-semibold text-sm shrink-0">{fmtPeso(l.lineTotal)}</div>
              {!locked && (
                <button
                  onClick={() => {
                    if (window.confirm('Remove this line?')) del.mutate(l.id);
                  }}
                  disabled={del.isPending}
                  className="text-muted-foreground hover:text-red-600 shrink-0 disabled:opacity-50"
                  title="Remove line"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Totals breakdown */}
      <div className="border-t border-border pt-3 space-y-1 text-sm">
        {(['LABOR', 'PART', 'CONSUMABLE', 'SUBLET'] as LineKind[]).map((k) =>
          totals[k] ? (
            <div key={k} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{k} subtotal</span>
              <span className="font-mono">{fmtPeso(totals[k])}</span>
            </div>
          ) : null,
        )}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="font-semibold">Total</span>
          <span className="font-mono font-bold text-base">{fmtPeso(totalAmount)}</span>
        </div>
      </div>

      {showAdd && (
        <AddLineModal
          jobOrderId={jobOrderId}
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); onChange(); }}
        />
      )}
    </div>
  );
}

function AddLineModal({
  jobOrderId, onClose, onSuccess,
}: {
  jobOrderId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [kind, setKind] = useState<LineKind>('LABOR');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [productId, setProductId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: products = [] } = useQuery<Array<{ id: string; name: string; sku: string | null; price: string }>>({
    queryKey: ['products-for-jo'],
    queryFn:  () => api.get('/products', { params: { take: 500 } }).then((r) => Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
    enabled:  kind === 'PART' || kind === 'CONSUMABLE',
  });

  const { data: users = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['users'],
    queryFn:  () => api.get('/users').then((r) => r.data),
    enabled:  kind === 'LABOR',
  });

  const mut = useMutation({
    mutationFn: () => {
      const qty = Number(quantity);
      const price = Number(unitPrice);
      if (!(qty > 0)) throw new Error('Quantity must be greater than 0.');
      if (price < 0)  throw new Error('Unit price cannot be negative.');
      if (!description.trim()) throw new Error('Description is required.');
      if ((kind === 'PART' || kind === 'CONSUMABLE') && !productId) {
        throw new Error(`${kind} lines require a product.`);
      }
      return api.post(`/job-orders/${jobOrderId}/lines`, {
        kind,
        description: description.trim(),
        quantity: qty,
        unitPrice: price,
        productId: productId || undefined,
        technicianId: kind === 'LABOR' ? (technicianId || undefined) : undefined,
        notes: notes.trim() || undefined,
      }).then((r) => r.data);
    },
    onSuccess: () => { toast.success('Line added.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? e?.message ?? 'Failed.'),
  });

  // Auto-fill price + description when a product is selected.
  function onProductChange(pid: string) {
    setProductId(pid);
    const p = products.find((x) => x.id === pid);
    if (p) {
      if (!description) setDescription(p.name);
      if (!unitPrice) setUnitPrice(String(p.price));
    }
  }

  const total = (Number(quantity) || 0) * (Number(unitPrice) || 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-auto rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-base font-semibold">Add line</h3>
        </header>

        <div className="p-5 space-y-3">
          {/* Kind selector */}
          <div className="grid grid-cols-4 gap-2">
            {(['LABOR', 'PART', 'CONSUMABLE', 'SUBLET'] as LineKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { setKind(k); setProductId(''); }}
                className={
                  'inline-flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-[11px] font-medium border transition-colors ' +
                  (kind === k
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                    : 'border-border text-muted-foreground hover:bg-muted')
                }
              >
                {KIND_ICON[k]}
                <span>{k}</span>
              </button>
            ))}
          </div>

          {(kind === 'PART' || kind === 'CONSUMABLE') && (
            <label className="text-sm block">
              <span className="text-xs text-muted-foreground">Product *</span>
              <select
                value={productId}
                onChange={(e) => onProductChange(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— select product —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.sku ? ` (${p.sku})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kind === 'LABOR' && (
            <label className="text-sm block">
              <span className="text-xs text-muted-foreground">Technician (optional)</span>
              <select
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Description *</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                kind === 'LABOR'    ? 'e.g. Replace water pump (3 hrs)' :
                kind === 'PART'     ? 'e.g. OEM water pump' :
                kind === 'CONSUMABLE' ? 'e.g. Coolant flush' :
                'e.g. Body shop — bumper repaint'
              }
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm block">
              <span className="text-xs text-muted-foreground">Quantity *</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="text-sm block">
              <span className="text-xs text-muted-foreground">Unit price ₱ *</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
              />
            </label>
          </div>

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <div className="rounded-lg bg-muted/40 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Line total</span>
            <span className="font-mono font-bold">{fmtPeso(total)}</span>
          </div>
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2 border-t border-border pt-4 sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Add Line'}
          </button>
        </footer>
      </div>
    </div>
  );
}
