'use client';

/**
 * Sprint 25 — Void approvals review UI (maker-checker).
 *
 * Lists pending VoidApproval rows. Supervisor (BUSINESS_OWNER / BRANCH_MANAGER)
 * approves or rejects each request. Approve/Reject mutations call
 * /void-approvals/:id/approve and /reject. SOD is enforced server-side:
 * the user who initiated the void cannot approve their own request.
 *
 * Mirrors the payments-pending admin page pattern.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type VoidApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface VoidApproval {
  id:             string;
  tenantId:       string;
  orderId:        string;
  orderItemId:    string | null;
  amountCents:    number;
  reason:         string;
  initiatedById:  string;
  initiatedAt:    string;
  status:         VoidApprovalStatus;
  approvedById:   string | null;
  approvedAt:     string | null;
  rejectionReason: string | null;
}

function fmtPhp(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_COLORS: Record<VoidApprovalStatus, string> = {
  PENDING:  'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
};

export default function VoidApprovalsPage() {
  const [statusFilter, setStatusFilter] = useState<VoidApprovalStatus>('PENDING');
  const qc = useQueryClient();

  const { data: rows, isLoading, refetch } = useQuery<VoidApproval[]>({
    queryKey: ['void-approvals', statusFilter],
    queryFn:  () => api.get(`/void-approvals?status=${statusFilter}`).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const counts = useMemo(() => ({ items: rows?.length ?? 0 }), [rows]);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-6 py-5 shrink-0">
        <h1 className="text-xl font-bold text-foreground">Void Approvals</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Maker-checker review of void/refund requests above the tenant threshold. Approving here unlocks the void at POS.
        </p>
      </div>

      <div className="p-4 sm:p-6 max-w-5xl">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                statusFilter === s ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:border-foreground/40'
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-secondary inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && rows && rows.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No void approvals with status {statusFilter}.</p>
          </div>
        )}

        <div className="space-y-3">
          {rows?.map((row) => (
            <ApprovalCard
              key={row.id}
              row={row}
              onUpdated={() => qc.invalidateQueries({ queryKey: ['void-approvals'] })}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground mt-6">
          Showing {counts.items} requests. Pulls every 30 seconds.
        </p>
      </div>
    </div>
  );
}

function ApprovalCard({ row, onUpdated }: { row: VoidApproval; onUpdated: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason,    setReason]    = useState('');

  const approveMut = useMutation({
    mutationFn: () => api.patch(`/void-approvals/${row.id}/approve`, {}),
    onSuccess: () => { toast.success('Void approval granted. Cashier can now retry the void.'); onUpdated(); },
    onError:   (err: any) => toast.error(err?.response?.data?.message ?? 'Could not approve request.'),
  });

  const rejectMut = useMutation({
    mutationFn: () => api.patch(`/void-approvals/${row.id}/reject`, { rejectionReason: reason.trim() }),
    onSuccess: () => { toast.success('Request rejected.'); setRejecting(false); setReason(''); onUpdated(); },
    onError:   (err: any) => toast.error(err?.response?.data?.message ?? 'Could not reject request.'),
  });

  const statusClass = STATUS_COLORS[row.status];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-mono text-sm text-foreground">Order {row.orderId.slice(-8)}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${statusClass}`}>{row.status}</span>
              {row.orderItemId && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 uppercase font-semibold">
                  Line item
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Initiated by {row.initiatedById.slice(-6)} · {fmtDate(row.initiatedAt)}</p>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold font-mono text-foreground">{fmtPhp(row.amountCents)}</div>
          </div>
        </div>

        <div className="rounded-lg bg-muted/40 p-3 text-xs mb-3">
          <div className="text-muted-foreground mb-0.5">Reason</div>
          <div className="text-foreground">{row.reason}</div>
        </div>

        {row.rejectionReason && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs mb-3">
            <div className="text-red-900 font-semibold mb-0.5">Rejection reason</div>
            <div className="text-red-700">{row.rejectionReason}</div>
          </div>
        )}

        {row.status === 'PENDING' && (
          <div className="flex items-center gap-2 flex-wrap">
            {!rejecting && (
              <>
                <button
                  onClick={() => approveMut.mutate()}
                  disabled={approveMut.isPending}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: '#10b981' }}
                >
                  <CheckCircle2 className="h-4 w-4" /> {approveMut.isPending ? 'Approving…' : 'Approve'}
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5"
                >
                  <X className="h-4 w-4" /> Reject
                </button>
              </>
            )}
            {rejecting && (
              <div className="w-full mt-2 p-3 rounded-lg bg-red-50 border border-red-200 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-red-900 mb-1">
                    Reason for rejection <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    minLength={5}
                    placeholder="e.g., 'Customer agreed to keep the order — no void needed.'"
                    className="w-full px-3 py-2 rounded-md border border-red-300 bg-white text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => rejectMut.mutate()}
                    disabled={rejectMut.isPending || reason.trim().length < 5}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-red-600 disabled:opacity-50"
                  >
                    {rejectMut.isPending ? 'Rejecting…' : 'Reject request'}
                  </button>
                  <button
                    onClick={() => { setRejecting(false); setReason(''); }}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
