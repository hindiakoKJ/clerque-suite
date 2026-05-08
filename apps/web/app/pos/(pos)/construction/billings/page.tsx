'use client';
/**
 * Construction → Progress Billings
 *
 * Progress billings issued against a Project. Lifecycle:
 *   DRAFT → ISSUED → PAID  (or CANCELLED)
 *
 * Each billing carries gross / retention / net amounts. Retention is held
 * back until project completion, then released via the Retention Release
 * action. Backed by /construction/progress-billings + /retention-releases
 * endpoints.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Plus, ArrowLeft, FileBadge, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Status = 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED';

interface Project { id: string; name: string; projectCode: string; status: string }

interface Billing {
  id:               string;
  billingNumber:    string;
  stageDescription: string;
  percentComplete:  string;
  grossAmount:      string;
  retentionPercent: string;
  retentionAmount:  string;
  netAmount:        string;
  status:           Status;
  issuedAt:         string | null;
  paidAt:           string | null;
  notes:            string | null;
  project:          { id: string; name: string; projectCode: string };
}

const STATUS_TINT: Record<Status, string> = {
  DRAFT:     'bg-muted text-muted-foreground',
  ISSUED:    'bg-blue-500/15 text-blue-600',
  PAID:      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  CANCELLED: 'bg-red-500/10 text-red-600',
};

function fmtPeso(n: string | number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}

export default function ProgressBillingsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL');
  const [showNew, setShowNew] = useState(false);
  const [releasing, setReleasing] = useState<Billing | null>(null);

  const { data: billings = [] } = useQuery<Billing[]>({
    queryKey: ['construction-billings', filter],
    queryFn:  () => api.get('/construction/progress-billings', {
      params: filter !== 'ALL' ? { status: filter } : {},
    }).then((r) => r.data),
  });

  const issue = useMutation({
    mutationFn: (id: string) => api.patch(`/construction/progress-billings/${id}/issue`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['construction-billings'] }); toast.success('Issued.'); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });
  const markPaid = useMutation({
    mutationFn: (id: string) => api.patch(`/construction/progress-billings/${id}/mark-paid`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['construction-billings'] }); toast.success('Marked paid.'); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Receipt className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Progress Billings</h1>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Billing
        </button>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        <div className="flex items-center gap-2 flex-wrap">
          {(['ALL', 'DRAFT', 'ISSUED', 'PAID', 'CANCELLED'] as const).map((s) => (
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
          {billings.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              No billings for this filter.
            </div>
          ) : (
            billings.map((b) => (
              <div key={b.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{b.billingNumber}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_TINT[b.status]}`}>
                        {b.status}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">{b.stageDescription}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <FileBadge className="h-3 w-3" />
                      {b.project.projectCode} · {b.project.name} · {Number(b.percentComplete).toFixed(0)}% complete
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-mono font-semibold">{fmtPeso(b.grossAmount)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Retention {Number(b.retentionPercent).toFixed(0)}%: <span className="font-mono">{fmtPeso(b.retentionAmount)}</span>
                    </div>
                    <div className="text-xs">
                      Net (now): <span className="font-mono font-semibold">{fmtPeso(b.netAmount)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {b.status === 'DRAFT' && (
                    <button
                      onClick={() => issue.mutate(b.id)}
                      disabled={issue.isPending}
                      className="px-2.5 py-1 rounded text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
                    >
                      Issue
                    </button>
                  )}
                  {b.status === 'ISSUED' && (
                    <button
                      onClick={() => markPaid.mutate(b.id)}
                      disabled={markPaid.isPending}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      Mark paid
                    </button>
                  )}
                  {b.status === 'PAID' && Number(b.retentionAmount) > 0 && (
                    <button
                      onClick={() => setReleasing(b)}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-purple-500/15 text-purple-700 hover:bg-purple-500/25 inline-flex items-center gap-1"
                    >
                      <Wallet className="h-3 w-3" /> Release retention
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showNew && (
        <NewBillingModal
          onClose={() => setShowNew(false)}
          onSuccess={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ['construction-billings'] });
          }}
        />
      )}

      {releasing && (
        <ReleaseRetentionModal
          billing={releasing}
          onClose={() => setReleasing(null)}
          onSuccess={() => {
            setReleasing(null);
            qc.invalidateQueries({ queryKey: ['construction-billings'] });
          }}
        />
      )}
    </div>
  );
}

function NewBillingModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn:  () => api.get('/projects').then((r) => r.data),
  });

  const [form, setForm] = useState({
    projectId: '', stageDescription: '',
    percentComplete: '', grossAmount: '', retentionPercent: '10',
    notes: '',
  });
  function f<K extends keyof typeof form>(k: K, v: any) { setForm((s) => ({ ...s, [k]: v })); }

  const gross     = Number(form.grossAmount) || 0;
  const retention = Math.round(gross * (Number(form.retentionPercent) || 0)) / 100;
  const net       = +(gross - retention).toFixed(2);

  const mut = useMutation({
    mutationFn: () => api.post('/construction/progress-billings', {
      projectId:        form.projectId,
      stageDescription: form.stageDescription.trim(),
      percentComplete:  Number(form.percentComplete),
      grossAmount:      gross,
      retentionPercent: Number(form.retentionPercent),
      notes:            form.notes.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: () => { toast.success('Draft billing created.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">New Progress Billing</h3>
        </header>

        <div className="p-5 space-y-3">
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Project *</span>
            <select
              value={form.projectId}
              onChange={(e) => f('projectId', e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— select —</option>
              {projects.filter((p) => p.status !== 'CANCELLED').map((p) => (
                <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>
              ))}
            </select>
          </label>

          <Field label="Stage description *" v={form.stageDescription} on={(v) => f('stageDescription', v)} placeholder="e.g. Foundation works completed" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="% complete *" v={form.percentComplete} on={(v) => f('percentComplete', v)} type="number" placeholder="25" />
            <Field label="Retention %" v={form.retentionPercent} on={(v) => f('retentionPercent', v)} type="number" />
          </div>
          <Field label="Gross amount ₱ *" v={form.grossAmount} on={(v) => f('grossAmount', v)} type="number" />

          {gross > 0 && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Gross</span><span className="font-mono">{fmtPeso(gross)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Retention {Number(form.retentionPercent).toFixed(0)}%</span><span className="font-mono">−{fmtPeso(retention)}</span></div>
              <div className="flex justify-between font-semibold border-t border-border pt-1"><span>Billable now</span><span className="font-mono">{fmtPeso(net)}</span></div>
            </div>
          )}

          <Field label="Notes" v={form.notes} on={(v) => f('notes', v)} />
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.projectId || !form.stageDescription || !form.percentComplete || !form.grossAmount}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Create Draft'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ReleaseRetentionModal({ billing, onClose, onSuccess }: {
  billing: Billing; onClose: () => void; onSuccess: () => void;
}) {
  const [method, setMethod] = useState<'AR_CREDIT' | 'CASH'>('AR_CREDIT');
  const [notes,  setNotes]  = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/construction/retention-releases', {
      progressBillingId: billing.id,
      releasedAmount:    Number(billing.retentionAmount),
      releaseMethod:     method,
      notes:             notes.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: () => { toast.success('Retention released.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">Release Retention</h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{billing.billingNumber}</p>
        </header>

        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Project</span><span>{billing.project.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Retention held</span><span className="font-mono font-semibold">{fmtPeso(billing.retentionAmount)}</span></div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">Release method</span>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" checked={method === 'AR_CREDIT'} onChange={() => setMethod('AR_CREDIT')} className="mt-0.5" />
              <div>
                <div className="text-sm">Add to AR (default)</div>
                <div className="text-xs text-muted-foreground">Customer now owes this amount; collect via normal AR flow.</div>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" checked={method === 'CASH'} onChange={() => setMethod('CASH')} className="mt-0.5" />
              <div>
                <div className="text-sm">Customer paid in cash</div>
                <div className="text-xs text-muted-foreground">Final settlement received directly.</div>
              </div>
            </label>
          </div>

          <Field label="Notes" v={notes} on={setNotes} />
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Releasing…' : 'Release'}
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
