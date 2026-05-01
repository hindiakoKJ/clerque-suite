'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Banknote, CheckCircle2, AlertTriangle, Clock,
  ChevronRight, ChevronLeft, RefreshCw, Plus, X
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from 'sonner';

type SettlementStatus = 'PENDING' | 'SETTLED' | 'RECONCILED' | 'DISPUTED';
type PaymentMethod = 'GCASH_PERSONAL' | 'GCASH_BUSINESS' | 'MAYA_PERSONAL' | 'MAYA_BUSINESS' | 'QR_PH';

interface SettlementBatch {
  id: string;
  method: PaymentMethod;
  referenceNumber: string | null;
  expectedAmount: number | string;
  actualAmount: number | string | null;
  variance: number | string | null;
  periodStart: string;
  periodEnd: string;
  settledAt: string | null;
  bankReference: string | null;
  status: SettlementStatus;
  notes: string | null;
  _count: { items: number };
}

interface PendingSummary {
  method: PaymentMethod;
  pendingCount: number;
  pendingAmount: number;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  GCASH_PERSONAL:  'GCash (Personal)',
  GCASH_BUSINESS:  'GCash (Business)',
  MAYA_PERSONAL:   'Maya (Personal)',
  MAYA_BUSINESS:   'Maya (Business)',
  QR_PH:           'QR Ph',
};

const METHOD_COLORS: Record<PaymentMethod, string> = {
  GCASH_PERSONAL:  '#0d6efd',
  GCASH_BUSINESS:  '#0a58ca',
  MAYA_PERSONAL:   '#198754',
  MAYA_BUSINESS:   '#146c43',
  QR_PH:           '#6f42c1',
};

const STATUS_CONFIG: Record<SettlementStatus, { label: string; color: string; Icon: React.ElementType }> = {
  PENDING:    { label: 'Pending',    color: 'text-amber-600 bg-amber-500/10',  Icon: Clock },
  SETTLED:    { label: 'Settled',    color: 'text-green-600 bg-green-500/10',  Icon: CheckCircle2 },
  RECONCILED: { label: 'Reconciled', color: 'text-[var(--accent)] bg-[var(--accent-soft)]', Icon: CheckCircle2 },
  DISPUTED:   { label: 'Disputed',   color: 'text-red-500 bg-red-500/10',     Icon: AlertTriangle },
};

const INPUT_CLS = 'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent';

export default function SettlementPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const branchId = user?.branchId ?? '';
  const canManage = user?.role === 'BUSINESS_OWNER' || user?.role === 'BRANCH_MANAGER';

  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<SettlementStatus | ''>('');
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [confirmForm, setConfirmForm] = useState({ actualAmount: '', settledAt: '', bankReference: '' });
  const [newBatch, setNewBatch] = useState({ method: 'GCASH_BUSINESS' as PaymentMethod, referenceNumber: '', periodStart: '', periodEnd: '', notes: '' });

  // Pending summary — amounts waiting to be matched
  const { data: summary = [] } = useQuery<PendingSummary[]>({
    queryKey: ['settlement-summary', branchId],
    queryFn: () => api.get(`/settlement/pending-summary?branchId=${branchId}`).then((r) => r.data),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  // Batch list
  const { data: batchData, isLoading } = useQuery<{ data: SettlementBatch[]; total: number; pages: number }>({
    queryKey: ['settlement-batches', branchId, page, filterStatus],
    queryFn: () => {
      const params = new URLSearchParams({ branchId, page: String(page) });
      if (filterStatus) params.set('status', filterStatus);
      return api.get(`/settlement/batches?${params}`).then((r) => r.data);
    },
    enabled: !!branchId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const batches = batchData?.data ?? [];
  const pages = batchData?.pages ?? 1;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['settlement-batches'] });
    qc.invalidateQueries({ queryKey: ['settlement-summary'] });
  };

  const { mutate: createBatch, isPending: creating } = useMutation({
    mutationFn: () => api.post('/settlement/batches', { ...newBatch, branchId }).then((r) => r.data),
    onSuccess: () => { toast.success('Batch created.'); setShowNewBatch(false); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create batch'),
  });

  const { mutate: confirmBatch, isPending: confirming } = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/settlement/batches/${id}/confirm`, {
        actualAmount: parseFloat(confirmForm.actualAmount),
        settledAt: confirmForm.settledAt,
        bankReference: confirmForm.bankReference || undefined,
      }).then((r) => r.data),
    onSuccess: () => { toast.success('Settlement confirmed.'); setSelectedBatch(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to confirm'),
  });

  const { mutate: reconcileBatch } = useMutation({
    mutationFn: (id: string) => api.patch(`/settlement/batches/${id}/reconcile`).then((r) => r.data),
    onSuccess: () => { toast.success('Batch reconciled.'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to reconcile'),
  });

  const totalPending = summary.reduce((s, r) => s + r.pendingAmount, 0);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Settlement Tracking</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Match GCash / Maya bank credits to your POS transactions
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">

        {/* Pending summary cards */}
        {summary.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Awaiting Settlement
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {summary.map((s) => (
                <div key={s.method} className="bg-muted/40 border border-border rounded-xl p-4">
                  <p className="text-xs font-medium" style={{ color: METHOD_COLORS[s.method] }}>
                    {METHOD_LABELS[s.method]}
                  </p>
                  <p className="text-lg font-bold text-foreground mt-1">{formatPeso(s.pendingAmount)}</p>
                  <p className="text-xs text-muted-foreground">{s.pendingCount} transaction{s.pendingCount !== 1 ? 's' : ''}</p>
                </div>
              ))}
              <div className="bg-[var(--accent-soft)] border border-[var(--accent)]/20 rounded-xl p-4">
                <p className="text-xs font-medium text-[var(--accent)]">Total Pending</p>
                <p className="text-lg font-bold text-[var(--accent)] mt-1">{formatPeso(totalPending)}</p>
                <p className="text-xs text-muted-foreground">across all methods</p>
              </div>
            </div>
          </div>
        )}

        {/* Batch list header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Settlement Batches</h2>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value as any); setPage(1); }}
              className="text-xs border border-border bg-background rounded-lg px-2 py-1 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="SETTLED">Settled</option>
              <option value="DISPUTED">Disputed</option>
              <option value="RECONCILED">Reconciled</option>
            </select>
          </div>
          {canManage && (
            <button
              onClick={() => setShowNewBatch(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white hover:opacity-90 transition-opacity"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="h-3.5 w-3.5" /> New Batch
            </button>
          )}
        </div>

        {/* Batch table */}
        {isLoading ? (
          <Spinner size="lg" message="Loading settlement batches…" />
        ) : batches.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-12">
            <Banknote className="h-8 w-8 mx-auto mb-2 opacity-30" />
            No settlement batches yet.
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left">Method</th>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Actual</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  <th className="px-4 py-3 text-center">Txns</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {batches.map((b) => {
                  const cfg = STATUS_CONFIG[b.status];
                  const variance = b.variance != null ? Number(b.variance) : null;
                  return (
                    <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold" style={{ color: METHOD_COLORS[b.method] }}>
                          {METHOD_LABELS[b.method]}
                        </span>
                        {b.referenceNumber && (
                          <p className="text-[10px] text-muted-foreground font-mono">{b.referenceNumber}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(b.periodStart).toLocaleDateString('en-PH')} –{' '}
                        {new Date(b.periodEnd).toLocaleDateString('en-PH')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {formatPeso(Number(b.expectedAmount))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">
                        {b.actualAmount != null ? formatPeso(Number(b.actualAmount)) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {variance != null ? (
                          <span className={variance === 0 ? 'text-green-600' : 'text-red-500'}>
                            {variance >= 0 ? '+' : ''}{formatPeso(variance)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground text-xs">
                        {b._count.items}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>
                          <cfg.Icon className="h-3 w-3" />
                          {cfg.label}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          {b.status === 'PENDING' && (
                            <button
                              onClick={() => { setSelectedBatch(b.id); setConfirmForm({ actualAmount: String(Number(b.expectedAmount)), settledAt: new Date().toISOString().slice(0, 10), bankReference: '' }); }}
                              className="text-xs font-medium px-2 py-1 rounded transition-colors hover:opacity-80"
                              style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}
                            >
                              Confirm
                            </button>
                          )}
                          {(b.status === 'SETTLED' || b.status === 'DISPUTED') && (
                            <button
                              onClick={() => reconcileBatch(b.id)}
                              className="text-xs font-medium px-2 py-1 rounded transition-colors hover:opacity-80 text-green-600 bg-green-500/10"
                            >
                              Reconcile
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground">Page {page} of {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* New Batch Modal */}
      {showNewBatch && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">New Settlement Batch</h2>
              <button onClick={() => setShowNewBatch(false)}><X className="h-5 w-5 text-muted-foreground" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Payment Method</label>
                <select value={newBatch.method} onChange={(e) => setNewBatch((f) => ({ ...f, method: e.target.value as PaymentMethod }))} className={INPUT_CLS}>
                  <option value="GCASH_BUSINESS">GCash (Business)</option>
                  <option value="GCASH_PERSONAL">GCash (Personal)</option>
                  <option value="MAYA_BUSINESS">Maya (Business)</option>
                  <option value="MAYA_PERSONAL">Maya (Personal)</option>
                  <option value="QR_PH">QR Ph</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Period Start</label>
                  <input type="date" value={newBatch.periodStart} onChange={(e) => setNewBatch((f) => ({ ...f, periodStart: e.target.value }))} className={INPUT_CLS} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Period End</label>
                  <input type="date" value={newBatch.periodEnd} onChange={(e) => setNewBatch((f) => ({ ...f, periodEnd: e.target.value }))} className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Gateway Reference No. (optional)</label>
                <input value={newBatch.referenceNumber} onChange={(e) => setNewBatch((f) => ({ ...f, referenceNumber: e.target.value }))} placeholder="e.g. GCash batch #12345" className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Notes (optional)</label>
                <textarea rows={2} value={newBatch.notes} onChange={(e) => setNewBatch((f) => ({ ...f, notes: e.target.value }))} className={`${INPUT_CLS} resize-none`} />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setShowNewBatch(false)} className="flex-1 border border-border rounded-xl py-2 text-sm text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={() => createBatch()} disabled={!newBatch.periodStart || !newBatch.periodEnd || creating}
                className="flex-1 rounded-xl py-2 text-sm font-medium text-white disabled:opacity-40 hover:opacity-90"
                style={{ background: 'var(--accent)' }}>
                {creating ? 'Creating…' : 'Create Batch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Settlement Modal */}
      {selectedBatch && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Confirm Bank Receipt</h2>
              <button onClick={() => setSelectedBatch(null)}><X className="h-5 w-5 text-muted-foreground" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground">Enter the actual amount that arrived in your bank account and the date you saw it.</p>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Actual Amount Received (₱)</label>
                <input type="number" step="0.01" value={confirmForm.actualAmount} onChange={(e) => setConfirmForm((f) => ({ ...f, actualAmount: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Date Received</label>
                <input type="date" value={confirmForm.settledAt} onChange={(e) => setConfirmForm((f) => ({ ...f, settledAt: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Bank Reference (optional)</label>
                <input value={confirmForm.bankReference} onChange={(e) => setConfirmForm((f) => ({ ...f, bankReference: e.target.value }))} placeholder="Bank transaction ref / OR number" className={INPUT_CLS} />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setSelectedBatch(null)} className="flex-1 border border-border rounded-xl py-2 text-sm text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={() => confirmBatch(selectedBatch)} disabled={!confirmForm.actualAmount || !confirmForm.settledAt || confirming}
                className="flex-1 rounded-xl py-2 text-sm font-medium text-white disabled:opacity-40 hover:opacity-90"
                style={{ background: 'var(--accent)' }}>
                {confirming ? 'Saving…' : 'Confirm Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
