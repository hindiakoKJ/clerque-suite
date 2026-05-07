'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plane, ArrowLeft, Plus, Calendar } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const TYPES = ['VACATION', 'SICK', 'EMERGENCY', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER'] as const;
type LeaveType = typeof TYPES[number];

interface MyLeave {
  id:        string;
  type:      LeaveType;
  status:    'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  startDate: string;
  endDate:   string;
  daysCount: string;
  reason:    string;
  rejectionReason?: string | null;
  approver?: { name: string } | null;
}

const STATUS_TINT: Record<string, string> = {
  PENDING:   'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  APPROVED:  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REJECTED:  'bg-red-500/15 text-red-600',
  CANCELLED: 'bg-muted text-muted-foreground',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

function daysBetween(a: string, b: string) {
  if (!a || !b) return 0;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / 86_400_000) + 1);
}

export default function MyLeavesPage() {
  const qc = useQueryClient();

  const { data: leaves = [] } = useQuery<MyLeave[]>({
    queryKey: ['payroll-me-leaves'],
    queryFn:  () => api.get('/payroll/me/leaves').then((r) => r.data),
  });

  const [showForm,  setShowForm]  = useState(false);
  const [type,      setType]      = useState<LeaveType>('VACATION');
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [reason,    setReason]    = useState('');
  const days = daysBetween(startDate, endDate);

  const create = useMutation({
    mutationFn: () => api.post('/payroll/leaves', {
      type, startDate, endDate, daysCount: days, reason,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-me-leaves'] });
      toast.success('Leave request submitted.');
      setShowForm(false);
      setType('VACATION'); setStartDate(''); setEndDate(''); setReason('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not submit.'),
  });

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href="/payroll/me" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Plane className="h-6 w-6 text-[var(--accent)]" />
            My Leave Requests
          </h1>
          <p className="text-sm text-muted-foreground">Submit a request and check approval status.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New
        </button>
      </header>

      {showForm && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Submit a request</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value as LeaveType)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                {TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Days (auto)</span>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{days}</div>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">End date</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="text-sm block">
            <span className="block text-xs text-muted-foreground mb-1">Reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Brief reason for the leave"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending || !startDate || !endDate || !reason || days <= 0}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">History</h2>
        </header>
        {leaves.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No leave requests yet.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {leaves.map((l) => (
              <li key={l.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {l.type.toLowerCase()} · {Number(l.daysCount).toFixed(1)} days
                  </div>
                  <div className="text-xs text-muted-foreground">{fmt(l.startDate)} → {fmt(l.endDate)}</div>
                  <div className="text-xs text-muted-foreground italic mt-0.5">{l.reason}</div>
                  {l.rejectionReason && (
                    <div className="text-xs text-red-600 mt-1">Rejected: {l.rejectionReason}</div>
                  )}
                </div>
                <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${STATUS_TINT[l.status]}`}>
                  {l.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
