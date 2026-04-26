'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { DollarSign, Plus, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayRunDto {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  frequency: 'WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  employeeCount: number;
  processedAt: string | null;
  notes: string | null;
  createdAt: string;
}

type StatusFilter = 'ALL' | 'DRAFT' | 'COMPLETED' | 'CANCELLED';
type Frequency    = 'WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPeriod(start: string, end: string) {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(start)} → ${fmt(end)}`;
}

const STATUS_BADGE: Record<PayRunDto['status'], { tone: 'warn' | 'success' | 'danger'; label: string }> = {
  DRAFT:     { tone: 'warn',    label: 'Draft'     },
  COMPLETED: { tone: 'success', label: 'Completed' },
  CANCELLED: { tone: 'danger',  label: 'Cancelled' },
};

const FREQ_LABEL: Record<Frequency, string> = {
  WEEKLY:      'Weekly',
  SEMI_MONTHLY: 'Semi-Monthly',
  MONTHLY:     'Monthly',
};

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL',       label: 'All'       },
  { value: 'DRAFT',     label: 'Draft'     },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

// ── New Pay Run Form ──────────────────────────────────────────────────────────

interface NewRunForm {
  label: string;
  periodStart: string;
  periodEnd: string;
  frequency: Frequency;
  notes: string;
}

const EMPTY_FORM: NewRunForm = {
  label: '',
  periodStart: '',
  periodEnd: '',
  frequency: 'SEMI_MONTHLY',
  notes: '',
};

function NewRunModal({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<NewRunForm>(EMPTY_FORM);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: NewRunForm) => api.post('/payroll/runs', body).then((r) => r.data),
    onSuccess: () => {
      toast.success('Pay run created');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      setForm(EMPTY_FORM);
      onSuccess();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Something went wrong');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label || !form.periodStart || !form.periodEnd) {
      toast.error('Label, Period Start, and Period End are required');
      return;
    }
    mutation.mutate(form);
  }

  const field = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1 disabled:opacity-50';
  const label = 'block text-xs font-medium text-muted-foreground mb-1';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Pay Run</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={label}>Label *</label>
            <input
              className={field}
              placeholder="e.g. Semi-Monthly May 1–15 2026"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              disabled={mutation.isPending}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Period Start *</label>
              <input
                type="date"
                className={field}
                value={form.periodStart}
                onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label className={label}>Period End *</label>
              <input
                type="date"
                className={field}
                value={form.periodEnd}
                onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                disabled={mutation.isPending}
              />
            </div>
          </div>
          <div>
            <label className={label}>Frequency *</label>
            <select
              className={field}
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Frequency }))}
              disabled={mutation.isPending}
            >
              <option value="WEEKLY">Weekly</option>
              <option value="SEMI_MONTHLY">Semi-Monthly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>
          <div>
            <label className={label}>Notes (optional)</label>
            <textarea
              className={`${field} resize-none h-20`}
              placeholder="Additional notes…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              disabled={mutation.isPending}
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
              className="px-4 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Pay Run
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PayRunsPage() {
  const { user } = useAuthStore();
  const router   = useRouter();
  const qc       = useQueryClient();

  const [filter, setFilter]       = useState<StatusFilter>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const { data: runs = [], isLoading } = useQuery<PayRunDto[]>({
    queryKey: ['payroll-runs'],
    queryFn: () => api.get('/payroll/runs').then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  const filtered = filter === 'ALL' ? runs : runs.filter((r) => r.status === filter);

  async function handleProcess(id: string) {
    if (!confirm('Process this pay run? This will calculate all payslips and cannot be undone.')) return;
    setProcessing(id);
    try {
      await api.post(`/payroll/runs/${id}/process`);
      toast.success('Pay run processed successfully');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Something went wrong');
    } finally {
      setProcessing(null);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this pay run?')) return;
    try {
      await api.post(`/payroll/runs/${id}/cancel`);
      toast.success('Pay run cancelled');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Something went wrong');
    }
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Pay Runs</h1>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            <Plus className="h-4 w-4" />
            New Pay Run
          </button>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 mt-4 overflow-x-auto">
          {STATUS_TABS.map((tab) => {
            const active = filter === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {tab.label}
                {tab.value !== 'ALL' && (
                  <span className="ml-1.5 text-[10px] opacity-70">
                    {runs.filter((r) => r.status === tab.value).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 p-4 sm:p-6">
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between gap-4">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <DollarSign className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">
                {filter === 'ALL' ? 'No pay runs yet.' : `No ${filter.toLowerCase()} pay runs.`}
              </p>
              {filter === 'ALL' && (
                <p className="text-xs mt-1">Create your first pay run to get started.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Period</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Label</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Frequency</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employees</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gross Pay</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net Pay</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((run) => {
                    const sb = STATUS_BADGE[run.status];
                    const isProcessing = processing === run.id;
                    return (
                      <tr key={run.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatPeriod(run.periodStart, run.periodEnd)}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{run.label}</td>
                        <td className="px-4 py-3">
                          <Badge tone="accent">{FREQ_LABEL[run.frequency]}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={sb.tone}>{sb.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{run.employeeCount}</td>
                        <td className="px-4 py-3 text-right font-medium text-foreground">
                          {run.status === 'DRAFT' ? '—' : formatPeso(run.totalGross)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--accent)' }}>
                          {run.status === 'DRAFT' ? '—' : formatPeso(run.totalNet)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {run.status === 'DRAFT' && (
                              <>
                                <button
                                  onClick={() => handleProcess(run.id)}
                                  disabled={isProcessing}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                                  style={{ background: 'var(--accent)' }}
                                >
                                  {isProcessing
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : null}
                                  Process
                                </button>
                                <button
                                  onClick={() => handleCancel(run.id)}
                                  disabled={isProcessing}
                                  className="px-2.5 py-1 rounded text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                            {run.status === 'COMPLETED' && (
                              <button
                                onClick={() => router.push(`/payroll/payslips?payRunId=${run.id}`)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors hover:opacity-80"
                                style={{ color: 'var(--accent)' }}
                              >
                                View Payslips
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <NewRunModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={() => setModalOpen(false)}
      />
    </div>
  );
}
