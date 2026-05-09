'use client';
/**
 * Service-Engine → Job Orders
 *
 * Status board for service work orders (auto repair, appliance service,
 * IT repair, watchmakers, etc.). 9-state lifecycle:
 *   DRAFT → DIAGNOSING → AWAITING_APPROVAL → AWAITING_PARTS →
 *   IN_PROGRESS → QC → READY_FOR_PICKUP → CLAIMED
 *  ↘ CANCELLED at any pre-CLAIMED step.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, ArrowLeft, Search, User as UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Status =
  | 'DRAFT' | 'DIAGNOSING' | 'AWAITING_APPROVAL' | 'AWAITING_PARTS'
  | 'IN_PROGRESS' | 'QC' | 'READY_FOR_PICKUP' | 'CLAIMED' | 'CANCELLED';

interface JobOrder {
  id:                string;
  jobNumber:         string;
  status:            Status;
  itemDescription:   string;
  customerComplaint: string | null;
  diagnosis:         string | null;
  estimateAmount:    string | null;
  totalAmount:       string;
  promisedAt:        string | null;
  customer:          { id: string; name: string } | null;
  assignedTo:        { id: string; name: string } | null;
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

function fmtPeso(n: string | number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}

export default function JobOrdersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data: jos = [] } = useQuery<JobOrder[]>({
    queryKey: ['job-orders', filter, search],
    queryFn:  () => api.get('/job-orders', {
      params: {
        ...(filter !== 'ALL' ? { status: filter } : {}),
        ...(search ? { search } : {}),
      },
    }).then((r) => r.data),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) =>
      api.patch(`/job-orders/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['job-orders'] }); toast.success('Status updated.'); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Briefcase className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Job Orders</h1>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Job Order
        </button>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search by job # or item description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(['ALL', 'DRAFT', 'DIAGNOSING', 'AWAITING_APPROVAL', 'AWAITING_PARTS', 'IN_PROGRESS', 'QC', 'READY_FOR_PICKUP', 'CLAIMED', 'CANCELLED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={
                'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ' +
                (filter === s
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-border text-muted-foreground hover:bg-muted')
              }
            >
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {jos.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              No job orders for this filter.
            </div>
          ) : (
            jos.map((jo) => (
              <div key={jo.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => router.push(`/pos/job-orders/${jo.id}`)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{jo.jobNumber}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_TINT[jo.status]}`}>
                        {jo.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">{jo.itemDescription}</div>
                    {jo.customerComplaint && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        “{jo.customerComplaint}”
                      </div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                      {jo.customer && <span><UserIcon className="h-3 w-3 inline mr-0.5" />{jo.customer.name}</span>}
                      {jo.assignedTo && <span>Tech: {jo.assignedTo.name}</span>}
                      {jo.promisedAt && <span>Promised: {new Date(jo.promisedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</span>}
                    </div>
                  </button>
                  <div className="shrink-0 text-right">
                    {jo.estimateAmount && (
                      <div className="text-[10px] text-muted-foreground">Est: <span className="font-mono">{fmtPeso(jo.estimateAmount)}</span></div>
                    )}
                    <div className="font-mono font-semibold">{fmtPeso(jo.totalAmount)}</div>
                  </div>
                </div>

                {NEXT_STATUS[jo.status] && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {NEXT_STATUS[jo.status]!.map((next) => (
                      <button
                        key={next}
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: jo.id, status: next })}
                        className={
                          'px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-50 ' +
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
              </div>
            ))
          )}
        </div>
      </div>

      {showNew && (
        <NewJobOrderModal
          onClose={() => setShowNew(false)}
          onSuccess={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ['job-orders'] });
          }}
        />
      )}
    </div>
  );
}

function NewJobOrderModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { data: branches = [] }  = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });
  const { data: customers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['customers'],
    queryFn:  () => api.get('/customers').then((r) => r.data),
  });
  const { data: users = [] }     = useQuery<{ id: string; name: string }[]>({
    queryKey: ['users'],
    queryFn:  () => api.get('/users').then((r) => r.data),
  });

  const [form, setForm] = useState({
    branchId: '', customerId: '', itemDescription: '',
    customerComplaint: '', diagnosis: '',
    assignedToId: '', estimateAmount: '',
    promisedAt: '', notes: '',
  });
  function f<K extends keyof typeof form>(k: K, v: any) { setForm((s) => ({ ...s, [k]: v })); }

  const mut = useMutation({
    mutationFn: () => api.post('/job-orders', {
      branchId:          form.branchId,
      customerId:        form.customerId || undefined,
      itemDescription:   form.itemDescription.trim(),
      customerComplaint: form.customerComplaint.trim() || undefined,
      diagnosis:         form.diagnosis.trim() || undefined,
      assignedToId:      form.assignedToId || undefined,
      estimateAmount:    form.estimateAmount ? Number(form.estimateAmount) : undefined,
      promisedAt:        form.promisedAt ? new Date(form.promisedAt).toISOString() : undefined,
      notes:             form.notes.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: () => { toast.success('Job order created.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-base font-semibold">New Job Order</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Intake form. Lines (labor / parts) are added on the job order detail after creation.</p>
        </header>

        <div className="p-5 space-y-3">
          <Sel label="Branch *" v={form.branchId} on={(v) => f('branchId', v)} opts={branches.map((b) => ({ v: b.id, l: b.name }))} />
          <Sel label="Customer" v={form.customerId} on={(v) => f('customerId', v)} opts={customers.map((c) => ({ v: c.id, l: c.name }))} optional />

          <Field label="Item description *" v={form.itemDescription} on={(v) => f('itemDescription', v)} placeholder="e.g. Toyota Vios 2018, 1.3L gas" />
          <Field label="Customer complaint" v={form.customerComplaint} on={(v) => f('customerComplaint', v)} placeholder="What's wrong?" />
          <Field label="Diagnosis (initial)" v={form.diagnosis} on={(v) => f('diagnosis', v)} placeholder="If known at intake" />

          <div className="grid grid-cols-2 gap-3">
            <Sel label="Assigned technician" v={form.assignedToId} on={(v) => f('assignedToId', v)} opts={users.map((u) => ({ v: u.id, l: u.name }))} optional />
            <Field label="Estimate ₱" v={form.estimateAmount} on={(v) => f('estimateAmount', v)} type="number" />
          </div>
          <Field label="Promised date" v={form.promisedAt} on={(v) => f('promisedAt', v)} type="date" />
          <Field label="Notes" v={form.notes} on={(v) => f('notes', v)} />
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2 sticky bottom-0 bg-card border-t border-border pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.branchId || !form.itemDescription}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Create Job Order'}
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
