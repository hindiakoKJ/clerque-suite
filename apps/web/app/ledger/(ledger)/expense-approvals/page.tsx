'use client';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, XCircle, Banknote, ChevronDown, ChevronRight,
  Loader2, ClipboardCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

// ── Types ─────────────────────────────────────────────────────────────────────

type ClaimStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';

const APPROVER_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'FINANCE_LEAD', 'ACCOUNTANT'];
const PAY_ROLES      = ['BUSINESS_OWNER', 'FINANCE_LEAD'];

interface Submitter {
  id: string;
  name: string;
  email: string;
}

interface ClaimItem {
  id: string;
  category: string;
  description: string;
  amount: string;
  receiptDate: string;
  receiptRef: string | null;
}

interface ExpenseClaim {
  id: string;
  claimNumber: string;
  title: string;
  description: string | null;
  totalAmount: string;
  status: ClaimStatus;
  submittedById: string;
  submittedBy: Submitter | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  createdAt: string;
  items?: ClaimItem[];
  _count?: { items: number };
}

interface ClaimListResponse {
  data: ExpenseClaim[];
  total: number;
  page: number;
  pages: number;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ClaimStatus }) {
  const map: Record<ClaimStatus, { tone: 'default' | 'warn' | 'success' | 'danger' | 'accent'; label: string }> = {
    DRAFT:     { tone: 'default',  label: 'Draft' },
    SUBMITTED: { tone: 'warn',     label: 'Pending' },
    APPROVED:  { tone: 'success',  label: 'Approved' },
    REJECTED:  { tone: 'danger',   label: 'Rejected' },
    PAID:      { tone: 'accent',   label: 'Paid' },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

// ── Filter Tab ────────────────────────────────────────────────────────────────

type TabFilter = 'ALL' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';

const TABS: { label: string; value: TabFilter }[] = [
  { label: 'All',      value: 'ALL' },
  { label: 'Pending',  value: 'SUBMITTED' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Paid',     value: 'PAID' },
];

// ── Review Modal ──────────────────────────────────────────────────────────────

interface ReviewModalProps {
  claim: ExpenseClaim | null;
  action: 'APPROVE' | 'REJECT' | null;
  onClose: () => void;
  onConfirm: (reviewNotes: string) => void;
  isPending: boolean;
}

function ReviewModal({ claim, action, onClose, onConfirm, isPending }: ReviewModalProps) {
  const [notes, setNotes] = useState('');

  function handleClose() {
    setNotes('');
    onClose();
  }

  function handleConfirm() {
    if (action === 'REJECT' && !notes.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    onConfirm(notes.trim());
    setNotes('');
  }

  const isApprove = action === 'APPROVE';

  return (
    <Dialog open={!!claim && !!action} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={isApprove ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
            {isApprove ? 'Approve Claim' : 'Reject Claim'}
          </DialogTitle>
        </DialogHeader>

        {claim && (
          <div className="space-y-4 pt-1">
            {/* Claim summary */}
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">{claim.claimNumber}</div>
              <div className="text-muted-foreground mt-0.5">{claim.title}</div>
              <div className="text-muted-foreground text-xs mt-1">
                Submitted by: {claim.submittedBy?.name ?? 'Unknown'}
              </div>
              <div className="font-semibold text-foreground mt-1.5">
                {formatPeso(parseFloat(claim.totalAmount))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1">
                {isApprove ? 'Notes (optional)' : 'Reason for rejection'}
                {!isApprove && <span className="text-red-500 ml-1">*</span>}
              </label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder={isApprove ? 'All receipts verified…' : 'Please explain why this claim is being rejected…'}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={handleClose} disabled={isPending}>Cancel</Button>
              <Button
                onClick={handleConfirm}
                disabled={isPending}
                className={isApprove
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-red-600 hover:bg-red-700 text-white'}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                {isApprove ? 'Approve' : 'Reject'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Pay Modal ─────────────────────────────────────────────────────────────────

interface PayModalProps {
  claim: ExpenseClaim | null;
  onClose: () => void;
  onConfirm: (paymentRef: string) => void;
  isPending: boolean;
}

function PayModal({ claim, onClose, onConfirm, isPending }: PayModalProps) {
  const [paymentRef, setPaymentRef] = useState('');

  function handleClose() {
    setPaymentRef('');
    onClose();
  }

  return (
    <Dialog open={!!claim} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Paid</DialogTitle>
        </DialogHeader>
        {claim && (
          <div className="space-y-4 pt-1">
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">{claim.claimNumber}</div>
              <div className="text-muted-foreground mt-0.5">{claim.title}</div>
              <div className="text-muted-foreground text-xs mt-1">
                Payee: {claim.submittedBy?.name ?? 'Unknown'}
              </div>
              <div className="font-semibold text-foreground mt-1.5">
                {formatPeso(parseFloat(claim.totalAmount))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Payment Reference (optional)</label>
              <Input
                placeholder="e.g. TXN-20260427-001 or cheque number"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
              />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={handleClose} disabled={isPending}>Cancel</Button>
              <Button onClick={() => { onConfirm(paymentRef.trim()); setPaymentRef(''); }} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Banknote className="h-4 w-4 mr-1.5" />}
                Mark as Paid
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Expanded Items ────────────────────────────────────────────────────────────

function ItemsDetail({ claimId }: { claimId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['expense-claim-mgr', claimId],
    queryFn:  () => api.get(`/expense-claims/${claimId}`).then((r) => r.data),
  });

  if (isLoading) return <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>;

  const items: ClaimItem[] = data?.items ?? [];
  if (!items.length) return <div className="py-3 text-sm text-muted-foreground text-center">No items.</div>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground border-b border-border">
          <th className="text-left py-1.5 pr-3 font-medium">Category</th>
          <th className="text-left py-1.5 pr-3 font-medium">Description</th>
          <th className="text-left py-1.5 pr-3 font-medium">Date</th>
          <th className="text-left py-1.5 pr-3 font-medium">Receipt #</th>
          <th className="text-right py-1.5 font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-border/50 last:border-0">
            <td className="py-1.5 pr-3 text-muted-foreground">{item.category}</td>
            <td className="py-1.5 pr-3">{item.description}</td>
            <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
              {new Date(item.receiptDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
            </td>
            <td className="py-1.5 pr-3 text-muted-foreground">{item.receiptRef ?? '—'}</td>
            <td className="py-1.5 text-right font-medium">{formatPeso(parseFloat(item.amount))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExpenseApprovalsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const role = user?.role ?? '';
  const isUnauthorised = !!user && !APPROVER_ROLES.includes(role);
  const canPay = PAY_ROLES.includes(role);

  // All hooks must be declared before any conditional return (Rules of Hooks).
  const [tab, setTab]             = useState<TabFilter>('SUBMITTED');
  const [page, setPage]           = useState(1);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  // Review modal state
  const [reviewClaim,  setReviewClaim]  = useState<ExpenseClaim | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT' | null>(null);

  // Pay modal state
  const [payClaim, setPayClaim] = useState<ExpenseClaim | null>(null);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const statusParam = tab === 'ALL' ? '' : `&status=${tab}`;
  const { data, isLoading } = useQuery<ClaimListResponse>({
    queryKey: ['expense-claims-mgr', tab, page],
    queryFn:  () =>
      api.get(`/expense-claims?page=${page}&limit=20${statusParam}`).then((r) => r.data),
    enabled:  !!user,
  });

  const claims = data?.data ?? [];

  // ── Mutations ───────────────────────────────────────────────────────────────
  const reviewMutation = useMutation({
    mutationFn: ({ id, action, reviewNotes }: { id: string; action: 'APPROVE' | 'REJECT'; reviewNotes: string }) =>
      api.post(`/expense-claims/${id}/review`, { action, reviewNotes: reviewNotes || undefined }),
    onSuccess: (_data, vars) => {
      toast.success(vars.action === 'APPROVE' ? 'Claim approved' : 'Claim rejected');
      setReviewClaim(null);
      setReviewAction(null);
      void qc.invalidateQueries({ queryKey: ['expense-claims-mgr'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to review claim');
    },
  });

  const payMutation = useMutation({
    mutationFn: ({ id, paymentRef }: { id: string; paymentRef: string }) =>
      api.post(`/expense-claims/${id}/pay`, { paymentRef: paymentRef || undefined }),
    onSuccess: () => {
      toast.success('Claim marked as paid');
      setPayClaim(null);
      void qc.invalidateQueries({ queryKey: ['expense-claims-mgr'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to mark as paid');
    },
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Route guard — runs after all hooks to satisfy Rules of Hooks.
  if (isUnauthorised) {
    router.replace('/ledger/dashboard');
    return null;
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-[var(--accent)]" />
          Expense Approvals
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review and approve employee expense reimbursement claims
        </p>
      </div>

      {/* ── Filter Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => { setTab(t.value); setPage(1); setExpanded(new Set()); }}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.value
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Claims Table ─────────────────────────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : claims.length === 0 ? (
          <div className="py-16 text-center">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No expense claims in this category</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs w-8"></th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Claim #</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Submitted By</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Title</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Total</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Submitted</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claims.map((claim) => {
                  const isExpanded = expanded.has(claim.id);
                  const isOwn = claim.submittedById === user?.sub;

                  return (
                    <React.Fragment key={claim.id}>
                      <tr className="hover:bg-muted/30 transition-colors">
                        {/* Expand */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleExpand(claim.id)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>

                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{claim.claimNumber}</td>

                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{claim.submittedBy?.name ?? '—'}</div>
                          <div className="text-xs text-muted-foreground">{claim.submittedBy?.email ?? ''}</div>
                        </td>

                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{claim.title}</div>
                          {claim.reviewNotes && (
                            <div className="text-xs text-muted-foreground mt-0.5 max-w-[180px] truncate" title={claim.reviewNotes}>
                              Note: {claim.reviewNotes}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right font-semibold">
                          {formatPeso(parseFloat(claim.totalAmount))}
                        </td>

                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                          {claim.submittedAt
                            ? new Date(claim.submittedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                            : '—'}
                        </td>

                        <td className="px-4 py-3"><StatusBadge status={claim.status} /></td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 justify-end flex-wrap">
                            {claim.status === 'SUBMITTED' && !isOwn && (
                              <>
                                <button
                                  onClick={() => { setReviewClaim(claim); setReviewAction('APPROVE'); }}
                                  title="Approve claim"
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 font-medium"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Approve
                                </button>
                                <button
                                  onClick={() => { setReviewClaim(claim); setReviewAction('REJECT'); }}
                                  title="Reject claim"
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 font-medium"
                                >
                                  <XCircle className="h-3 w-3" />
                                  Reject
                                </button>
                              </>
                            )}
                            {claim.status === 'SUBMITTED' && isOwn && (
                              <span className="text-xs text-muted-foreground italic">Your claim</span>
                            )}
                            {claim.status === 'APPROVED' && canPay && (
                              <button
                                onClick={() => setPayClaim(claim)}
                                title="Mark as paid"
                                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-foreground hover:bg-muted font-medium"
                              >
                                <Banknote className="h-3 w-3" />
                                Mark Paid
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded items */}
                      {isExpanded && (
                        <tr key={`${claim.id}-items`} className="bg-muted/20">
                          <td colSpan={8} className="px-6 py-3">
                            <ItemsDetail claimId={claim.id} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {data.page} of {data.pages} ({data.total} total)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* ── Review Modal ─────────────────────────────────────────────────────── */}
      <ReviewModal
        claim={reviewClaim}
        action={reviewAction}
        onClose={() => { setReviewClaim(null); setReviewAction(null); }}
        onConfirm={(reviewNotes) => {
          if (!reviewClaim || !reviewAction) return;
          reviewMutation.mutate({ id: reviewClaim.id, action: reviewAction, reviewNotes });
        }}
        isPending={reviewMutation.isPending}
      />

      {/* ── Pay Modal ────────────────────────────────────────────────────────── */}
      <PayModal
        claim={payClaim}
        onClose={() => setPayClaim(null)}
        onConfirm={(paymentRef) => {
          if (!payClaim) return;
          payMutation.mutate({ id: payClaim.id, paymentRef });
        }}
        isPending={payMutation.isPending}
      />
    </div>
  );
}
