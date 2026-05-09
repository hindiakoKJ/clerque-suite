'use client';
/**
 * Sync (Payroll) → Requests inbox (manager / owner view).
 *
 * Approver-side counterpart to /payroll/me/requests. Shows the cross-tenant
 * queue of pending COA / Schedule / OB / OT / UT requests with one-click
 * approve / reject. Filterable by kind + status.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Inbox, CheckCircle2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Kind = 'COA' | 'SCHEDULE' | 'OB' | 'OT' | 'UT';
type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface Req {
  id:              string;
  kind:            Kind;
  status:          Status;
  forDate:         string;
  reason:          string;
  payload:         Record<string, any>;
  rejectionReason: string | null;
  createdAt:       string;
  user:            { id: string; name: string; email: string };
  approver:        { id: string; name: string } | null;
}

const KIND_LABEL: Record<Kind, string> = {
  COA: 'COA', SCHEDULE: 'Schedule', OB: 'OB', OT: 'OT', UT: 'UT',
};

const KIND_TINT: Record<Kind, string> = {
  COA:      'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  SCHEDULE: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  OB:       'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400',
  OT:       'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  UT:       'bg-orange-500/15 text-orange-700 dark:text-orange-400',
};

const STATUS_TINT: Record<Status, string> = {
  PENDING:   'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  APPROVED:  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REJECTED:  'bg-red-500/15 text-red-600',
  CANCELLED: 'bg-muted text-muted-foreground',
};

function summarizePayload(kind: Kind, payload: Record<string, any>): string {
  const fmt = (t?: string) => t ? new Date(t).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—';
  switch (kind) {
    case 'COA':
      return [payload.clockIn && `In ${fmt(payload.clockIn)}`, payload.clockOut && `Out ${fmt(payload.clockOut)}`]
        .filter(Boolean).join(' · ');
    case 'SCHEDULE':
      return `${payload.newStart ?? '—'} → ${payload.newEnd ?? '—'}`;
    case 'OB':
      return `${fmt(payload.startTime)} → ${fmt(payload.endTime)} @ ${payload.location ?? '—'}`;
    case 'OT':
      return `${fmt(payload.startTime)} → ${fmt(payload.endTime)} (${payload.hoursClaimed ?? '—'}h)`;
    case 'UT':
      return `Out ${fmt(payload.earlyOutAt)} (${payload.hoursMissed ?? '—'}h short)`;
  }
}

export default function ApproverRequestsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [kindFilter, setKindFilter] = useState<Kind | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<Status | 'ALL'>('PENDING');

  const { data: requests = [], isLoading } = useQuery<Req[]>({
    queryKey: ['employee-requests', kindFilter, statusFilter],
    queryFn:  () => api.get('/employee-requests', {
      params: {
        ...(kindFilter !== 'ALL' ? { kind: kindFilter } : {}),
        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
      },
    }).then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/employee-requests/${id}/approve`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-requests'] });
      toast.success('Request approved.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/employee-requests/${id}/reject`, { rejectionReason: reason }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-requests'] });
      toast.success('Request rejected.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Inbox className="h-6 w-6 text-[var(--accent)]" />
          Request Inbox
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approve or reject employee self-service requests.
        </p>
      </header>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">Type:</span>
          {(['ALL', 'COA', 'SCHEDULE', 'OB', 'OT', 'UT'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={
                'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ' +
                (kindFilter === k
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-border text-muted-foreground hover:bg-muted')
              }
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">Status:</span>
          {(['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ' +
                (statusFilter === s
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-border text-muted-foreground hover:bg-muted')
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <section className="space-y-2">
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No requests for this filter.
          </div>
        ) : (
          requests.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${KIND_TINT[r.kind]}`}>
                      {KIND_LABEL[r.kind]}
                    </span>
                    <span className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${STATUS_TINT[r.status]}`}>
                      {r.status}
                    </span>
                    <span className="text-sm font-semibold">{r.user.name}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-sm">
                      {new Date(r.forDate).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                    </span>
                  </div>
                  <div className="mt-1 text-sm">{summarizePayload(r.kind, r.payload)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{r.reason}</div>
                  {r.rejectionReason && (
                    <div className="mt-1 text-xs text-red-600">
                      <span className="font-semibold">Rejection note:</span> {r.rejectionReason}
                    </div>
                  )}
                  {r.approver && r.status !== 'PENDING' && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.status === 'APPROVED' ? 'Approved' : r.status === 'REJECTED' ? 'Rejected' : 'Reviewed'} by {r.approver.name}
                    </div>
                  )}
                </div>

                {r.status === 'PENDING' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        if (window.confirm(`Approve ${r.user.name}'s ${KIND_LABEL[r.kind]} request?`)) approve.mutate(r.id);
                      }}
                      disabled={approve.isPending || reject.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => {
                        const reason = window.prompt('Reject — please give a reason:');
                        if (reason && reason.trim()) reject.mutate({ id: r.id, reason: reason.trim() });
                      }}
                      disabled={approve.isPending || reject.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-red-300 text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
