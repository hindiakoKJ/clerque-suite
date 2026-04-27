'use client';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Send, Undo2, ChevronDown, ChevronRight,
  Receipt, Loader2, X,
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

const CATEGORIES = [
  'Meals',
  'Transport',
  'Accommodation',
  'Supplies',
  'Communication',
  'Other',
] as const;

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

// ── Draft item used in the create form ───────────────────────────────────────

interface DraftItem {
  category: string;
  description: string;
  amount: string;
  receiptDate: string;
  receiptRef: string;
}

function emptyItem(): DraftItem {
  return {
    category:    'Meals',
    description: '',
    amount:      '',
    receiptDate: new Date().toISOString().slice(0, 10),
    receiptRef:  '',
  };
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

// ── Create Claim Modal ────────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { title: string; description: string; items: DraftItem[] }) => void;
  isPending: boolean;
}

function CreateClaimModal({ open, onClose, onCreate, isPending }: CreateModalProps) {
  const [title, setTitle]       = useState('');
  const [description, setDesc]  = useState('');
  const [items, setItems]       = useState<DraftItem[]>([emptyItem()]);

  function reset() {
    setTitle('');
    setDesc('');
    setItems([emptyItem()]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateItem(i: number, field: keyof DraftItem, value: string) {
    setItems((prev) =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)),
    );
  }

  const total = items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);

  function handleSubmit() {
    if (!title.trim()) { toast.error('Please enter a claim title'); return; }
    for (const it of items) {
      if (!it.description.trim()) { toast.error('Each item needs a description'); return; }
      if (!it.amount || parseFloat(it.amount) <= 0) { toast.error('Each item needs a valid amount'); return; }
      if (!it.receiptDate) { toast.error('Each item needs a receipt date'); return; }
    }
    onCreate({ title: title.trim(), description: description.trim(), items });
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Expense Claim</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1">Title <span className="text-red-500">*</span></label>
            <Input
              placeholder="e.g. April Sales Trip — Cebu"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              rows={2}
              placeholder="Brief summary of the expenses..."
              value={description}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Expense Items</label>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1 text-xs text-[var(--accent)] hover:opacity-80 font-medium"
              >
                <Plus className="h-3.5 w-3.5" /> Add Item
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, i) => (
                <div key={i} className="border border-border rounded-lg p-3 bg-muted/30">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground">Item {i + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="text-red-400 hover:text-red-500"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Category */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Category</label>
                      <select
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        value={item.category}
                        onChange={(e) => updateItem(i, 'category', e.target.value)}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    {/* Amount */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Amount (₱)</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={item.amount}
                        onChange={(e) => updateItem(i, 'amount', e.target.value)}
                      />
                    </div>

                    {/* Description */}
                    <div className="col-span-2">
                      <label className="block text-xs text-muted-foreground mb-1">Description</label>
                      <Input
                        placeholder="What was this expense for?"
                        value={item.description}
                        onChange={(e) => updateItem(i, 'description', e.target.value)}
                      />
                    </div>

                    {/* Receipt Date */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Receipt Date</label>
                      <Input
                        type="date"
                        value={item.receiptDate}
                        onChange={(e) => updateItem(i, 'receiptDate', e.target.value)}
                      />
                    </div>

                    {/* Receipt Ref */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Receipt / OR # (optional)</label>
                      <Input
                        placeholder="OR-001234"
                        value={item.receiptRef}
                        onChange={(e) => updateItem(i, 'receiptRef', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Total */}
          <div className="flex justify-end">
            <div className="bg-muted/60 border border-border rounded-lg px-4 py-2 text-sm">
              <span className="text-muted-foreground">Total: </span>
              <span className="font-semibold text-foreground">{formatPeso(total)}</span>
            </div>
          </div>

          {/* TODO: Receipt file attachments will be handled by the Document Attachments module (Phase 7) */}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Button variant="outline" onClick={handleClose} disabled={isPending}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save as Draft
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Row expanded items ────────────────────────────────────────────────────────

function ItemsDetail({ claimId }: { claimId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['expense-claim', claimId],
    queryFn:  () => api.get(`/expense-claims/${claimId}`).then((r) => r.data),
  });

  if (isLoading) return <div className="py-4 text-center text-sm text-muted-foreground">Loading items…</div>;

  const items: ClaimItem[] = data?.items ?? [];
  if (!items.length) return <div className="py-3 text-sm text-muted-foreground text-center">No items found.</div>;

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

export default function MyExpensesPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage]             = useState(1);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());

  // ── Fetch claims ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<ClaimListResponse>({
    queryKey: ['my-expense-claims', page],
    queryFn:  () => api.get(`/expense-claims?page=${page}&limit=20`).then((r) => r.data),
    enabled:  !!user,
  });

  const claims = data?.data ?? [];

  // ── Summary: pending reimbursement (SUBMITTED + APPROVED) ──────────────────
  const pendingSum = claims
    .filter((c) => c.status === 'SUBMITTED' || c.status === 'APPROVED')
    .reduce((sum, c) => sum + parseFloat(c.totalAmount), 0);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (dto: object) => api.post('/expense-claims', dto),
    onSuccess: () => {
      toast.success('Claim saved as draft');
      setShowCreate(false);
      void qc.invalidateQueries({ queryKey: ['my-expense-claims'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to create claim');
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/expense-claims/${id}/submit`),
    onSuccess: () => {
      toast.success('Claim submitted for approval');
      void qc.invalidateQueries({ queryKey: ['my-expense-claims'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to submit claim');
    },
  });

  const retractMutation = useMutation({
    mutationFn: (id: string) => api.post(`/expense-claims/${id}/retract`),
    onSuccess: () => {
      toast.success('Claim retracted to draft');
      void qc.invalidateQueries({ queryKey: ['my-expense-claims'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to retract claim');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expense-claims/${id}`),
    onSuccess: () => {
      toast.success('Draft deleted');
      void qc.invalidateQueries({ queryKey: ['my-expense-claims'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to delete claim');
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

  function handleCreate(formData: { title: string; description: string; items: DraftItem[] }) {
    createMutation.mutate({
      title:       formData.title,
      description: formData.description || undefined,
      items:       formData.items.map((it) => ({
        category:    it.category,
        description: it.description,
        amount:      parseFloat(it.amount),
        receiptDate: it.receiptDate,
        receiptRef:  it.receiptRef || undefined,
      })),
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Receipt className="h-5 w-5 text-[var(--accent)]" />
            My Expense Claims
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Submit and track your reimbursement requests
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-1.5" />
          New Claim
        </Button>
      </div>

      {/* ── Summary Strip ───────────────────────────────────────────────────── */}
      {pendingSum > 0 && (
        <div className="rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">Pending Reimbursement</p>
            <p className="text-2xl font-bold text-amber-800 dark:text-amber-300 mt-0.5">{formatPeso(pendingSum)}</p>
          </div>
          <div className="text-xs text-amber-600 dark:text-amber-500">
            Submitted + Approved claims
          </div>
        </div>
      )}

      {/* ── Claims List ─────────────────────────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : claims.length === 0 ? (
          <div className="py-16 text-center">
            <Receipt className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No expense claims yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Click &ldquo;New Claim&rdquo; to submit your first expense</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs w-8"></th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Claim #</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Title</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Total</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claims.map((claim) => {
                  const isExpanded = expanded.has(claim.id);
                  return (
                    <React.Fragment key={claim.id}>
                      <tr className="hover:bg-muted/30 transition-colors">
                        {/* Expand toggle */}
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
                          <div className="font-medium text-foreground">{claim.title}</div>
                          {claim.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">{claim.description}</div>
                          )}
                          {claim.reviewNotes && claim.status === 'REJECTED' && (
                            <div className="text-xs text-red-500 mt-0.5">Note: {claim.reviewNotes}</div>
                          )}
                        </td>

                        <td className="px-4 py-3"><StatusBadge status={claim.status} /></td>

                        <td className="px-4 py-3 text-right font-semibold">
                          {formatPeso(parseFloat(claim.totalAmount))}
                        </td>

                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                          {new Date(claim.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 justify-end">
                            {claim.status === 'DRAFT' && (
                              <>
                                <button
                                  onClick={() => submitMutation.mutate(claim.id)}
                                  disabled={submitMutation.isPending}
                                  title="Submit for approval"
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 font-medium"
                                >
                                  <Send className="h-3 w-3" />
                                  Submit
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm('Delete this draft?')) deleteMutation.mutate(claim.id);
                                  }}
                                  disabled={deleteMutation.isPending}
                                  title="Delete draft"
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </>
                            )}
                            {claim.status === 'SUBMITTED' && (
                              <button
                                onClick={() => retractMutation.mutate(claim.id)}
                                disabled={retractMutation.isPending}
                                title="Retract to draft"
                                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
                              >
                                <Undo2 className="h-3 w-3" />
                                Retract
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded items row */}
                      {isExpanded && (
                        <tr key={`${claim.id}-items`} className="bg-muted/20">
                          <td colSpan={7} className="px-6 py-3">
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
          <span>Page {data.page} of {data.pages} ({data.total} claims)</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── Create Modal ─────────────────────────────────────────────────────── */}
      <CreateClaimModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        isPending={createMutation.isPending}
      />
    </div>
  );
}
