'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plane, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Leave {
  id:        string;
  type:      string;
  status:    'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  startDate: string;
  endDate:   string;
  daysCount: string;
  reason:    string;
  rejectionReason?: string | null;
  user:      { id: string; name: string; email: string };
  approver?: { id: string; name: string } | null;
}

const TINT: Record<string, string> = {
  PENDING:   'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  APPROVED:  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REJECTED:  'bg-red-500/15 text-red-600',
  CANCELLED: 'bg-muted text-muted-foreground',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

export default function LeavesAdminPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: leaves = [], isLoading } = useQuery<Leave[]>({
    queryKey: ['hr-leaves', filter],
    queryFn:  () => api.get(`/payroll/leaves${filter !== 'ALL' ? `?status=${filter}` : ''}`).then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/payroll/leaves/${id}/approve`).then((r) => r.data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['hr-leaves'] }); toast.success('Leave approved.'); },
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/payroll/leaves/${id}/reject`, { reason }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leaves'] });
      toast.success('Leave rejected.');
      setRejectingId(null);
      setRejectReason('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Plane className="h-6 w-6 text-[var(--accent)]" />
          Leave Management
        </h1>
        <p className="text-sm text-muted-foreground">Approve or reject leave requests submitted by employees.</p>
      </header>

      <div className="flex gap-2">
        {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-[var(--accent)] text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {f.toLowerCase()}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground text-center">Loading…</div>
        ) : leaves.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">No requests in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Employee</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Period</th>
                <th className="text-right px-4 py-2 font-medium">Days</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Reason</th>
                <th className="text-center px-4 py-2 font-medium">Status</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={l.id} className="border-t border-border/40">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{l.user.name}</div>
                    <div className="text-xs text-muted-foreground">{l.user.email}</div>
                  </td>
                  <td className="px-4 py-2.5 capitalize">{l.type.toLowerCase()}</td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                    {fmt(l.startDate)} → {fmt(l.endDate)}
                  </td>
                  <td className="px-4 py-2.5 text-right">{Number(l.daysCount).toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground italic hidden lg:table-cell max-w-[200px] truncate">{l.reason}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${TINT[l.status]}`}>
                      {l.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">
                    {l.status === 'PENDING' && (
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => approve.mutate(l.id)}
                          disabled={approve.isPending}
                          className="p-1.5 rounded text-emerald-700 hover:bg-emerald-500/15"
                          title="Approve"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setRejectingId(l.id)}
                          disabled={reject.isPending}
                          className="p-1.5 rounded text-red-600 hover:bg-red-500/15"
                          title="Reject"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Reject modal */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3">
            <h2 className="font-semibold">Reject leave request</h2>
            <p className="text-sm text-muted-foreground">Add a brief reason — visible to the employee.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Needed at the till on those dates."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
              <button
                onClick={() => rejectingId && reject.mutate({ id: rejectingId, reason: rejectReason })}
                disabled={reject.isPending || !rejectReason.trim()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-500 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
