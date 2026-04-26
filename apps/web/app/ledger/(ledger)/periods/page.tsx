'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Lock, LockOpen, Plus, X, AlertTriangle,
  CheckCircle2, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';

type PeriodStatus = 'OPEN' | 'CLOSED';

interface AccountingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenedById: string | null;
  reopenReason: string | null;
  reopenCount: number;
  createdAt: string;
}

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent';
const BTN_PRIMARY =
  'flex items-center gap-2 bg-[var(--accent)] hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50';
const BTN_GHOST =
  'flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-accent/10 transition-colors';

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtFull(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function daysLeft(endDate: string) {
  const end = new Date(endDate);
  const now = new Date();
  end.setHours(23, 59, 59, 999);
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

export default function PeriodsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const isOwner = user?.role === 'BUSINESS_OWNER';

  const [showCreate, setShowCreate] = useState(false);
  const [confirmClose, setConfirmClose] = useState<AccountingPeriod | null>(null);
  const [confirmReopen, setConfirmReopen] = useState<AccountingPeriod | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: periods = [], isLoading } = useQuery<AccountingPeriod[]>({
    queryKey: ['accounting-periods'],
    queryFn: () => api.get('/accounting-periods').then((r) => r.data),
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (body: { name: string; startDate: string; endDate: string }) =>
      api.post('/accounting-periods', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounting-periods'] });
      setShowCreate(false);
      setForm({ name: '', startDate: '', endDate: '' });
      toast.success('Accounting period created.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to create period.');
    },
  });

  const closeMut = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/accounting-periods/${id}/close`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounting-periods'] });
      setConfirmClose(null);
      toast.success('Period closed. No further postings allowed.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to close period.');
    },
  });

  const reopenMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/accounting-periods/${id}/reopen`, { reason }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounting-periods'] });
      setConfirmReopen(null);
      setReopenReason('');
      toast.success('Period reopened. This action has been recorded in the audit log.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to reopen period.');
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const openPeriods   = periods.filter((p) => p.status === 'OPEN');
  const closedPeriods = periods.filter((p) => p.status === 'CLOSED');
  const currentPeriod = openPeriods.find((p) => {
    const now = new Date();
    return new Date(p.startDate) <= now && new Date(p.endDate) >= now;
  });

  // Suggest next period dates
  function suggestDates() {
    const sorted = [...periods].sort(
      (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime(),
    );
    const latest = sorted[0];
    if (!latest) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        startDate: start.toISOString().split('T')[0],
        endDate:   end.toISOString().split('T')[0],
        name:      `${start.toLocaleString('en-PH', { month: 'long', year: 'numeric' })}`,
      };
    }
    const after = new Date(latest.endDate);
    after.setDate(after.getDate() + 1);
    const end = new Date(after.getFullYear(), after.getMonth() + 1, 0);
    return {
      startDate: after.toISOString().split('T')[0],
      endDate:   end.toISOString().split('T')[0],
      name:      `${after.toLocaleString('en-PH', { month: 'long', year: 'numeric' })}`,
    };
  }

  function handleOpenCreate() {
    const suggested = suggestDates();
    setForm(suggested);
    setShowCreate(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.startDate || !form.endDate) return;
    if (form.endDate < form.startDate) {
      toast.error('End date must be after start date.');
      return;
    }
    createMut.mutate(form);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center">
            <CalendarClock className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Accounting Periods</h1>
            <p className="text-xs text-muted-foreground">
              Control which date range is open for journal postings
            </p>
          </div>
        </div>
        {isOwner && (
          <button onClick={handleOpenCreate} className={BTN_PRIMARY}>
            <Plus className="w-4 h-4" />
            New Period
          </button>
        )}
      </div>

      {/* Current period banner */}
      {currentPeriod && (() => {
        const days = daysLeft(currentPeriod.endDate);
        const urgent = days <= 5;
        return (
          <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
            urgent
              ? 'border-amber-400/40 bg-amber-500/5'
              : 'border-[var(--accent)]/30 bg-[var(--accent-soft)]'
          }`}>
            <div className={`mt-0.5 ${urgent ? 'text-amber-500' : 'text-[var(--accent)]'}`}>
              {urgent ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <div>
              <p className={`text-sm font-medium ${urgent ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--accent)]'}`}>
                {urgent
                  ? `Current Period Ending Soon — ${days} day${days !== 1 ? 's' : ''} left`
                  : 'Current Open Period'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-medium text-foreground">{currentPeriod.name}</span>
                {' · '}
                {fmt(currentPeriod.startDate)} – {fmt(currentPeriod.endDate)}
                {urgent && ' · Create the next period before this one closes.'}
              </p>
            </div>
          </div>
        );
      })()}

      {/* No periods at all */}
      {!isLoading && periods.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-12 flex flex-col items-center gap-3 text-center">
          <CalendarClock className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No accounting periods yet</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Create your first period to enable journal postings. Only entries dated
            within an <span className="font-medium text-foreground">Open</span> period can be posted.
          </p>
          {isOwner && (
            <button onClick={handleOpenCreate} className={BTN_PRIMARY + ' mt-2'}>
              <Plus className="w-4 h-4" />
              Create First Period
            </button>
          )}
        </div>
      )}

      {/* Open periods */}
      {openPeriods.length > 0 && (
        <Section title="Open Periods" count={openPeriods.length}>
          <div className="space-y-2">
            {openPeriods.map((p) => (
              <PeriodRow
                key={p.id}
                period={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                isOwner={isOwner}
                onClose={() => setConfirmClose(p)}
                onReopen={undefined}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Closed periods */}
      {closedPeriods.length > 0 && (
        <Section title="Closed Periods" count={closedPeriods.length} muted>
          <div className="space-y-2">
            {closedPeriods.map((p) => (
              <PeriodRow
                key={p.id}
                period={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                isOwner={isOwner}
                onClose={undefined}
                onReopen={() => setConfirmReopen(p)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* ── Create Modal ─────────────────────────────────────────────────── */}
      {showCreate && (
        <Modal title="New Accounting Period" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Period Name
              </label>
              <input
                className={INPUT_CLS}
                placeholder="e.g. April 2026"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  Start Date
                </label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  End Date
                </label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="rounded-lg bg-blue-500/8 border border-blue-400/20 p-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
              <p className="font-medium">What happens when a period is open?</p>
              <ul className="space-y-0.5 pl-3 list-disc text-blue-600/80 dark:text-blue-400/80">
                <li>Journal entries with dates in this range can be posted.</li>
                <li>Sales, settlements, and cost postings are gated by period status.</li>
                <li>Periods cannot overlap — the system will reject conflicting dates.</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowCreate(false)} className={BTN_GHOST}>
                Cancel
              </button>
              <button type="submit" className={BTN_PRIMARY} disabled={createMut.isPending}>
                {createMut.isPending ? 'Creating…' : 'Create Period'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Close Confirmation ───────────────────────────────────────────── */}
      {confirmClose && (
        <Modal title="Close Period" onClose={() => setConfirmClose(null)}>
          <div className="space-y-4">
            <div className="rounded-lg bg-red-500/8 border border-red-400/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                    This action locks the books for this period.
                  </p>
                  <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-1">
                    Once closed, <span className="font-medium">no journal entries</span> can be posted
                    to dates within <span className="font-medium">{confirmClose.name}</span> unless
                    you reopen it. Closing is typically done after all accruals and
                    adjustments have been recorded.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg border border-border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">{confirmClose.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date Range</span>
                <span className="font-medium">{fmt(confirmClose.startDate)} – {fmt(confirmClose.endDate)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmClose(null)} className={BTN_GHOST}>
                Cancel
              </button>
              <button
                onClick={() => closeMut.mutate(confirmClose.id)}
                disabled={closeMut.isPending}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                {closeMut.isPending ? 'Closing…' : 'Close Period'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reopen Confirmation ──────────────────────────────────────────── */}
      {confirmReopen && (
        <Modal title="Reopen Period" onClose={() => { setConfirmReopen(null); setReopenReason(''); }}>
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-500/8 border border-amber-400/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                    For corrections only — this action is audit-logged.
                  </p>
                  <p className="text-xs text-amber-600/80 dark:text-amber-400/70 mt-1">
                    Reopening <span className="font-medium">{confirmReopen.name}</span> allows
                    journal entries to be posted to past dates. The reopening event, your identity,
                    and your reason will be permanently recorded and cannot be deleted.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg border border-border p-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">{confirmReopen.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Originally Closed</span>
                <span className="font-medium">
                  {confirmReopen.closedAt ? fmtFull(confirmReopen.closedAt) : '—'}
                </span>
              </div>
              {confirmReopen.reopenCount > 0 && (
                <div className="flex justify-between pt-1 border-t border-border">
                  <span className="text-amber-600 dark:text-amber-400">Times Reopened</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {confirmReopen.reopenCount}× — BIR auditors review this
                  </span>
                </div>
              )}
            </div>

            {/* Required reason field */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Reason for Reopening <span className="text-red-500">*</span>
              </label>
              <textarea
                className={INPUT_CLS + ' resize-none h-20'}
                placeholder="e.g. Missing accrual entry for March payroll — correcting before BIR submission."
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                maxLength={500}
              />
              <p className={`text-xs mt-1 ${reopenReason.trim().length > 0 && reopenReason.trim().length < 10 ? 'text-red-500' : 'text-muted-foreground'}`}>
                {reopenReason.trim().length}/500 · minimum 10 characters required
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmReopen(null); setReopenReason(''); }} className={BTN_GHOST}>
                Cancel
              </button>
              <button
                onClick={() => reopenMut.mutate({ id: confirmReopen.id, reason: reopenReason })}
                disabled={reopenMut.isPending || reopenReason.trim().length < 10}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <LockOpen className="w-4 h-4" />
                {reopenMut.isPending ? 'Reopening…' : 'Reopen Period'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title, count, muted = false, children,
}: {
  title: string; count: number; muted?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className={`text-sm font-semibold ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>
          {title}
        </h2>
        <span className="text-xs bg-accent/10 text-muted-foreground px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function PeriodRow({
  period, expanded, onToggle, isOwner, onClose, onReopen,
}: {
  period: AccountingPeriod;
  expanded: boolean;
  onToggle: () => void;
  isOwner: boolean;
  onClose?: () => void;
  onReopen?: () => void;
}) {
  const isOpen   = period.status === 'OPEN';
  const days     = isOpen ? daysLeft(period.endDate) : null;
  const urgent   = days !== null && days <= 5;

  return (
    <div className={`rounded-xl border transition-colors ${
      isOpen
        ? 'border-[var(--accent)]/25 bg-card'
        : 'border-border bg-card/50'
    }`}>
      {/* Row header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Status icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isOpen ? 'bg-[var(--accent-soft)]' : 'bg-muted/50'
        }`}>
          {isOpen
            ? <LockOpen className="w-4 h-4 text-[var(--accent)]" />
            : <Lock className="w-4 h-4 text-muted-foreground" />}
        </div>

        {/* Name + dates */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isOpen ? 'text-foreground' : 'text-muted-foreground'}`}>
            {period.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {fmt(period.startDate)} – {fmt(period.endDate)}
          </p>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2 shrink-0">
          {isOpen ? (
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              urgent
                ? 'text-amber-600 bg-amber-500/10'
                : 'text-[var(--accent)] bg-[var(--accent-soft)]'
            }`}>
              {urgent ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              {urgent ? `${days}d left` : 'Open'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full text-muted-foreground bg-muted/60">
              <Lock className="w-3 h-3" />
              Closed
            </span>
          )}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Detail label="Status" value={isOpen ? 'Open' : 'Closed'} />
            <Detail label="Created" value={fmt(period.createdAt)} />
            {period.closedAt && (
              <Detail label="Closed At" value={fmtFull(period.closedAt)} />
            )}
            {period.closedBy && (
              <Detail label="Closed By" value={period.closedBy} />
            )}
          </div>

          {isOwner && (
            <div className="flex justify-end gap-2 pt-1">
              {isOpen && onClose && (
                <button
                  onClick={onClose}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 border border-red-400/30 hover:bg-red-500/5 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Close Period
                </button>
              )}
              {!isOpen && onReopen && (
                <button
                  onClick={onReopen}
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 border border-amber-400/30 hover:bg-amber-500/5 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <LockOpen className="w-3.5 h-3.5" />
                  Reopen Period
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground mt-0.5">{value}</p>
    </div>
  );
}

function Modal({
  title, onClose, children,
}: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-accent/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
