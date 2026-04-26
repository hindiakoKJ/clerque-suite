'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown, ChevronRight, Plus, X, Receipt,
  RotateCcw, CheckCircle2, Clock, FileText, AlertTriangle, Download, Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { downloadAuthFile } from '@/lib/utils';
import { toast } from 'sonner';
import { ReceiptModal, type ReceiptData } from '@/components/pos/ReceiptModal';
import { ImportModal } from '@/components/ui/ImportModal';

function fmtPeso(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface JournalLine {
  id: string;
  description?: string;
  debit: string;
  credit: string;
  account: { code: string; name: string; type: string };
}

interface LinkedEntry { id: string; entryNumber: string }

interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;           // Document Date
  postingDate?: string;   // Posting Date (period-locked)
  createdAt: string;      // Entry Date (system auto)
  description: string;
  reference?: string;     // External ref: invoice #, voucher #, etc.
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  source: 'MANUAL' | 'SYSTEM' | 'AP' | 'AR';
  createdBy?: string;
  postedBy?: string;
  postedAt?: string;
  lines: JournalLine[];
  accountingEvent?: { type: string; orderId?: string } | null;
  reversalOf?: LinkedEntry | null;
  reversedBy?: LinkedEntry | null;
}

interface JournalResponse {
  data: JournalEntry[];
  total: number;
  page: number;
  pages: number;
}

interface AccountOption { id: string; code: string; name: string; postingControl: string }

const INPUT_CLS = 'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

const STATUS_CONFIG = {
  DRAFT:  { label: 'Draft',  color: 'bg-muted text-muted-foreground',                                    Icon: FileText    },
  POSTED: { label: 'Posted', color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',                   Icon: CheckCircle2 },
  VOIDED: { label: 'Voided', color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',                   Icon: AlertTriangle },
};

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  SYSTEM: 'System',
  AP:     'AP Module',
  AR:     'AR Module',
};

export default function JournalPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canEdit = user?.role === 'BUSINESS_OWNER' || user?.role === 'ACCOUNTANT' || user?.isSuperAdmin;

  const [page, setPage]                     = useState(1);
  const [from, setFrom]                     = useState('');
  const [to,   setTo]                       = useState('');
  const [filterStatus, setFilterStatus]     = useState('');
  const [expanded, setExpanded]             = useState<Set<string>>(new Set());
  const [showModal, setShowModal]           = useState(false);
  const [reverseTarget, setReverseTarget]   = useState<JournalEntry | null>(null);
  const [reverseDate, setReverseDate]       = useState('');
  // Dedicated warning step shown when user tries to reverse a reversal entry
  const [reversalWarning, setReversalWarning] = useState<JournalEntry | null>(null);
  const [receiptData, setReceiptData]       = useState<ReceiptData | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState<string | null>(null);
  const [exporting, setExporting]           = useState(false);
  const [showImport, setShowImport]         = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (from)         params.set('from',   from);
      if (to)           params.set('to',     to);
      if (filterStatus) params.set('status', filterStatus);
      const range    = [from, to].filter(Boolean).join('_to_') || 'all';
      await downloadAuthFile(
        `${API_URL}/api/v1/export/journal?${params}`,
        `journal-${range}.xlsx`,
      );
    } catch {
      toast.error('Failed to download Journal Entries. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  async function viewReceipt(orderId: string) {
    setLoadingReceipt(orderId);
    try {
      const { data: order } = await api.get(`/orders/${orderId}`);
      setReceiptData({
        orderNumber:    order.orderNumber,
        lines: order.items.map((i: any) => ({
          productName:    i.productName,
          quantity:       Number(i.quantity),
          unitPrice:      Number(i.unitPrice),
          lineTotal:      Number(i.lineTotal),
          discountAmount: Number(i.discountAmount),
        })),
        subtotal:        Number(order.subtotal),
        discountAmount:  Number(order.discountAmount),
        vatAmount:       Number(order.vatAmount),
        totalAmount:     Number(order.totalAmount),
        payments:        order.payments.map((p: any) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
        isPwdScDiscount: order.isPwdScDiscount,
        pwdScIdRef:      order.pwdScIdRef ?? undefined,
        pwdScIdOwnerName: order.pwdScIdOwnerName ?? undefined,
        completedAt:     order.completedAt ?? order.createdAt,
        isOffline:       false,
      });
    } catch { toast.error('Could not load source receipt.'); }
    finally { setLoadingReceipt(null); }
  }

  const { data, isLoading } = useQuery<JournalResponse>({
    queryKey: ['journal', page, from, to, filterStatus],
    queryFn: () => api.get(
      `/accounting/journal?page=${page}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}${filterStatus ? `&status=${filterStatus}` : ''}`
    ).then((r) => r.data),
    enabled: !!user,
  });

  // Post a draft
  const postMut = useMutation({
    mutationFn: (id: string) => api.patch(`/accounting/journal/${id}/post`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['journal'] }); toast.success('Entry posted.'); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to post entry.'),
  });

  // Reverse a posted entry
  const reverseMut = useMutation({
    mutationFn: ({ id, date }: { id: string; date?: string }) =>
      api.post(`/accounting/journal/${id}/reverse`, { reverseDate: date || undefined }).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['journal'] });
      setReverseTarget(null);
      setReverseDate('');
      toast.success(`Reversal entry ${data.entryNumber} created.`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to reverse entry.'),
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Journal Entries</h1>
          <p className="text-sm text-muted-foreground mt-1">{data?.total ?? 0} total entries</p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 h-9 px-4 text-white text-sm font-medium rounded-lg transition-opacity hover:opacity-90 whitespace-nowrap self-start sm:self-auto"
            style={{ background: 'var(--accent)' }}
          >
            <Plus className="h-4 w-4" /> New Entry
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={INPUT_CLS} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={INPUT_CLS} />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className={INPUT_CLS + ' w-auto'}
        >
          <option value="">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="POSTED">Posted</option>
          <option value="VOIDED">Voided</option>
        </select>
        {(from || to || filterStatus) && (
          <button
            onClick={() => { setFrom(''); setTo(''); setFilterStatus(''); setPage(1); }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          title="Export to Excel"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">{exporting ? 'Exporting…' : '.xlsx'}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading journal entries…</div>
      ) : (
        <>
          <div className="bg-background rounded-xl border border-border overflow-hidden">
            {!data?.data.length ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No journal entries found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase">
                      <th className="px-4 py-2 text-left font-semibold w-8" />
                      <th className="px-4 py-2 text-left font-semibold">Entry #</th>
                      <th className="px-4 py-2 text-left font-semibold whitespace-nowrap">Posting Date</th>
                      <th className="px-4 py-2 text-left font-semibold whitespace-nowrap hidden lg:table-cell">Doc Date</th>
                      <th className="px-4 py-2 text-left font-semibold">Description</th>
                      <th className="px-4 py-2 text-left font-semibold">Source</th>
                      <th className="px-4 py-2 text-right font-semibold">Debit</th>
                      <th className="px-4 py-2 text-right font-semibold">Credit</th>
                      <th className="px-4 py-2 text-left font-semibold">Status</th>
                      {canEdit && <th className="px-4 py-2 w-24" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.data.map((entry) => {
                      const totalDebit  = entry.lines.reduce((s, l) => s + Number(l.debit),  0);
                      const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
                      const open = expanded.has(entry.id);
                      const sc = STATUS_CONFIG[entry.status];
                      const isReversed  = !!entry.reversedBy;
                      const isReversal  = !!entry.reversalOf;

                      return (
                        <>
                          <tr
                            key={entry.id}
                            onClick={() => toggleExpand(entry.id)}
                            className={`hover:bg-muted/40 cursor-pointer transition-colors ${isReversed ? 'opacity-60' : ''}`}
                          >
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{entry.entryNumber}</td>
                            <td className="px-4 py-2.5 text-foreground whitespace-nowrap">
                              {fmtDate(entry.postingDate ?? entry.date)}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap text-xs hidden lg:table-cell">
                              {fmtDate(entry.date)}
                            </td>
                            <td className="px-4 py-2.5 max-w-xs">
                              <p className="text-foreground truncate">{entry.description}</p>
                              {entry.reference && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">Ref: {entry.reference}</p>
                              )}
                              {isReversal && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                  Reversal of {entry.reversalOf!.entryNumber}
                                </p>
                              )}
                              {isReversed && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Reversed by {entry.reversedBy!.entryNumber}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                {entry.accountingEvent ? (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[var(--accent-soft)] text-[var(--accent)]">
                                    {entry.accountingEvent.type}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{SOURCE_LABELS[entry.source] ?? entry.source}</span>
                                )}
                                {entry.accountingEvent?.orderId && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); viewReceipt(entry.accountingEvent!.orderId!); }}
                                    disabled={loadingReceipt === entry.accountingEvent.orderId}
                                    title="View source receipt"
                                    className="text-muted-foreground hover:text-[var(--accent)] disabled:opacity-40 transition-colors"
                                  >
                                    <Receipt className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-foreground">{fmtPeso(totalDebit)}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-foreground">{fmtPeso(totalCredit)}</td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${sc.color}`}>
                                <sc.Icon className="w-3 h-3" />
                                {sc.label}
                              </span>
                            </td>
                            {canEdit && (
                              <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1">
                                  {entry.status === 'DRAFT' && (
                                    <button
                                      onClick={() => postMut.mutate(entry.id)}
                                      disabled={postMut.isPending}
                                      title="Approve & Post"
                                      className="text-xs font-medium text-teal-600 border border-teal-400/30 hover:bg-teal-500/5 px-2 py-1 rounded-lg transition-colors"
                                    >
                                      Post
                                    </button>
                                  )}
                                  {entry.status === 'POSTED' && !entry.reversedBy && entry.source === 'MANUAL' && (
                                    <button
                                      onClick={() => {
                                        if (entry.reversalOf) {
                                          // This entry is itself a reversal — show warning first
                                          setReversalWarning(entry);
                                        } else {
                                          setReverseTarget(entry);
                                          setReverseDate(new Date().toISOString().split('T')[0]);
                                        }
                                      }}
                                      title="Reverse this entry"
                                      className="text-muted-foreground hover:text-amber-600 transition-colors p-1 rounded"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>

                          {open && (
                            <tr key={`${entry.id}-lines`}>
                              <td colSpan={canEdit ? 9 : 8} className="px-6 pb-4 bg-muted/30">
                                <div className="rounded-lg border border-border overflow-hidden mt-1">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-muted text-muted-foreground">
                                        <th className="px-3 py-1.5 text-left font-medium">Account</th>
                                        <th className="px-3 py-1.5 text-left font-medium">Description</th>
                                        <th className="px-3 py-1.5 text-right font-medium">Debit</th>
                                        <th className="px-3 py-1.5 text-right font-medium">Credit</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border bg-background">
                                      {entry.lines.map((line) => (
                                        <tr key={line.id}>
                                          <td className="px-3 py-1.5 font-mono text-foreground">{line.account.code} — {line.account.name}</td>
                                          <td className="px-3 py-1.5 text-muted-foreground">{line.description ?? '—'}</td>
                                          <td className="px-3 py-1.5 text-right font-mono text-foreground">
                                            {Number(line.debit)  > 0 ? fmtPeso(Number(line.debit))  : ''}
                                          </td>
                                          <td className="px-3 py-1.5 text-right font-mono text-foreground">
                                            {Number(line.credit) > 0 ? fmtPeso(Number(line.credit)) : ''}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {/* EIS e-Invoice download — BIR-registered tenants only, SALE events only */}
                                {user?.isBirRegistered && entry.accountingEvent?.orderId && entry.accountingEvent.type === 'SALE' && (
                                  <div className="mt-2 mb-1">
                                    <a
                                      href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1/bir/eis/${entry.accountingEvent.orderId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={async (e) => {
                                        // Use downloadAuthFile so the Bearer token is attached
                                        e.preventDefault();
                                        try {
                                          const { downloadAuthFile: dlf } = await import('@/lib/utils');
                                          await dlf(
                                            `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1/bir/eis/${entry.accountingEvent!.orderId}`,
                                            `eis-${entry.entryNumber}.json`,
                                          );
                                        } catch {
                                          toast.error('Failed to download EIS invoice.');
                                        }
                                      }}
                                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:opacity-80 transition-opacity"
                                    >
                                      <Download className="w-3 h-3" />
                                      Download EIS Invoice
                                    </a>
                                  </div>
                                )}
                                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                                  <span>
                                    <span className="font-medium text-foreground">Entry date:</span>{' '}
                                    {fmtDate(entry.createdAt)}
                                  </span>
                                  <span>
                                    <span className="font-medium text-foreground">Doc date:</span>{' '}
                                    {fmtDate(entry.date)}
                                  </span>
                                  {entry.postingDate && (
                                    <span>
                                      <span className="font-medium text-foreground">Posting date:</span>{' '}
                                      {fmtDate(entry.postingDate)}
                                    </span>
                                  )}
                                  {entry.postedAt && (
                                    <span>
                                      <span className="font-medium text-foreground">Posted at:</span>{' '}
                                      {fmtDate(entry.postedAt)}
                                    </span>
                                  )}
                                  {entry.reference && (
                                    <span>
                                      <span className="font-medium text-foreground">Reference:</span>{' '}
                                      {entry.reference}
                                    </span>
                                  )}
                                  {entry.createdBy && (
                                    <span>
                                      <span className="font-medium text-foreground">Created by:</span>{' '}
                                      {entry.createdBy}
                                    </span>
                                  )}
                                  {entry.postedBy && (
                                    <span>
                                      <span className="font-medium text-foreground">Posted by:</span>{' '}
                                      {entry.postedBy}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(data?.pages ?? 0) > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-muted-foreground">Page {data?.page} of {data?.pages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors">
                  Previous
                </button>
                <button onClick={() => setPage((p) => Math.min(data?.pages ?? 1, p + 1))} disabled={page === (data?.pages ?? 1)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors">
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* New JE Modal */}
      {showModal && (
        <ManualJournalModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['journal'] }); }}
        />
      )}

      {/* Reversal-of-reversal warning — shown BEFORE opening the reversal date modal */}
      {reversalWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-background rounded-2xl border border-border shadow-2xl w-full max-w-md">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <RotateCcw className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground text-sm">Reversing a Reversal Entry</h2>
                <p className="text-xs text-muted-foreground mt-0.5">This requires your careful attention</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-lg bg-red-500/8 border border-red-400/30 p-3 text-xs text-red-700 dark:text-red-400 space-y-2">
                <p>
                  <span className="font-mono font-semibold">{reversalWarning.entryNumber}</span> is itself a reversal of{' '}
                  <span className="font-mono font-semibold">{reversalWarning.reversalOf!.entryNumber}</span>.
                </p>
                <p>
                  Reversing it again will effectively <span className="font-semibold">re-post the original transaction</span> back
                  into the ledger. This creates a chain of reversal entries that can be difficult to untangle during an audit.
                </p>
                <p className="font-medium">Only proceed if you are certain this is the correct action.</p>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => setReversalWarning(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const entry = reversalWarning;
                  setReversalWarning(null);
                  setReverseTarget(entry);
                  setReverseDate(new Date().toISOString().split('T')[0]);
                }}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2 text-sm font-medium transition-colors"
              >
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse confirmation */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-background rounded-2xl border border-border shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Reverse Entry</h2>
              <button onClick={() => setReverseTarget(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="rounded-lg bg-amber-500/8 border border-amber-400/20 p-3 text-xs text-amber-700 dark:text-amber-400">
                <p className="font-semibold mb-1">What this does</p>
                <p>Creates a new journal entry with all debits and credits flipped, linked back to <span className="font-mono">{reverseTarget.entryNumber}</span>. Both entries remain in the books for audit trail.</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Original entry</span>
                  <span className="font-mono font-medium">{reverseTarget.entryNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Description</span>
                  <span className="font-medium truncate max-w-48">{reverseTarget.description}</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Reversal Date</label>
                <input
                  type="date"
                  value={reverseDate}
                  onChange={(e) => setReverseDate(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setReverseTarget(null)}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent/10 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => reverseMut.mutate({ id: reverseTarget.id, date: reverseDate })}
                  disabled={reverseMut.isPending || !reverseDate}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                  style={{ background: 'var(--accent)' }}
                >
                  <RotateCcw className="w-4 h-4" />
                  {reverseMut.isPending ? 'Creating…' : 'Create Reversal'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ReceiptModal open={!!receiptData} data={receiptData} onClose={() => setReceiptData(null)} />
    </div>
  );
}

// ── Manual Journal Entry Modal ────────────────────────────────────────────────

interface DraftLine { accountId: string; description: string; debit: string; credit: string }

function ManualJournalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: accounts = [] } = useQuery<AccountOption[]>({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounting/accounts').then((r) => r.data),
  });

  // Only show OPEN accounts for manual posting
  const openAccounts = accounts.filter((a: AccountOption) => a.postingControl === 'OPEN');

  const today = new Date().toISOString().split('T')[0];
  const [docDate,     setDocDate]     = useState(today);
  const [postingDate, setPostingDate] = useState(today);
  const [desc,        setDesc]        = useState('');
  const [reference,   setReference]   = useState('');
  const [saveDraft,   setSaveDraft]   = useState(false);
  const [lines,       setLines]       = useState<DraftLine[]>([
    { accountId: '', description: '', debit: '', credit: '' },
    { accountId: '', description: '', debit: '', credit: '' },
  ]);
  const [saving, setSaving] = useState(false);

  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isBalanced) { toast.error('Journal entry must be balanced (debits = credits)'); return; }
    setSaving(true);
    try {
      await api.post('/accounting/journal', {
        date:        docDate,
        postingDate: postingDate !== docDate ? postingDate : undefined,
        description: desc,
        reference:   reference || undefined,
        saveDraft,
        lines: lines
          .filter((l) => l.accountId)
          .map((l) => ({
            accountId:   l.accountId,
            description: l.description || undefined,
            debit:  parseFloat(l.debit)  || 0,
            credit: parseFloat(l.credit) || 0,
          })),
      });
      toast.success(saveDraft ? 'Draft saved — post it when ready.' : 'Journal entry posted.');
      onSaved();
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg ?? 'Failed to save journal entry');
    } finally { setSaving(false); }
  }

  const fieldCls = 'h-9 px-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

  return (
    <div className="fixed inset-0 bg-foreground/40 flex items-center justify-center p-4 z-50">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-foreground">New Journal Entry</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            {/* Header fields */}
            <div className="grid grid-cols-2 gap-3">
              {/* Document Date */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Document Date
                  <span className="ml-1 font-normal opacity-70">— when event occurred</span>
                </label>
                <input
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                  required
                  className={`w-full ${fieldCls}`}
                />
              </div>
              {/* Posting Date */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Posting Date
                  <span className="ml-1 font-normal opacity-70">— determines accounting period</span>
                </label>
                <input
                  type="date"
                  value={postingDate}
                  onChange={(e) => setPostingDate(e.target.value)}
                  required
                  className={`w-full ${fieldCls}`}
                />
              </div>
              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description / Memo</label>
                <input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="e.g. Rent payment for April"
                  required
                  className={`w-full ${fieldCls}`}
                />
              </div>
              {/* Reference */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Reference
                  <span className="ml-1 font-normal opacity-70">— invoice #, voucher #, etc.</span>
                </label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Optional"
                  className={`w-full ${fieldCls}`}
                />
              </div>
            </div>

            {/* Entry Date — read-only, auto-set by system */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border">
              <span className="text-xs text-muted-foreground">Entry Date (auto):</span>
              <span className="text-xs font-medium text-muted-foreground">{new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-xs text-muted-foreground ml-auto italic">Set by system · not editable</span>
            </div>

            {/* Restricted accounts notice */}
            <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
              <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--accent)]" />
              <span>
                Only <span className="font-medium text-foreground">Open</span> accounts are shown.
                AP/AR sub-ledger accounts and system accounts (Sales, COGS, VAT) are excluded from manual posting.
              </span>
            </div>

            {/* Lines */}
            <div>
              <div className="grid grid-cols-[1fr_1fr_100px_100px_32px] gap-1.5 text-xs font-medium text-muted-foreground mb-1 px-1">
                <span>Account</span><span>Description</span>
                <span className="text-right">Debit</span>
                <span className="text-right">Credit</span>
                <span />
              </div>
              <div className="space-y-1.5">
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_100px_100px_32px] gap-1.5 items-center">
                    <select value={line.accountId} onChange={(e) => updateLine(i, { accountId: e.target.value })} className={fieldCls}>
                      <option value="">Select account…</option>
                      {openAccounts.map((a: AccountOption) => (
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                    <input value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} placeholder="Optional" className={fieldCls} />
                    <input type="number" min="0" step="0.01" value={line.debit}
                      onChange={(e) => updateLine(i, { debit: e.target.value, credit: '' })}
                      placeholder="0.00" className={`${fieldCls} text-right`} />
                    <input type="number" min="0" step="0.01" value={line.credit}
                      onChange={(e) => updateLine(i, { credit: e.target.value, debit: '' })}
                      placeholder="0.00" className={`${fieldCls} text-right`} />
                    <button type="button" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={lines.length <= 2}
                      className="h-9 w-8 flex items-center justify-center text-muted-foreground hover:text-rose-500 disabled:opacity-20 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button"
                onClick={() => setLines((prev) => [...prev, { accountId: '', description: '', debit: '', credit: '' }])}
                className="mt-2 flex items-center gap-1 text-xs font-medium hover:opacity-80 transition-opacity"
                style={{ color: 'var(--accent)' }}>
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-[1fr_1fr_100px_100px_32px] gap-1.5 border-t border-border pt-2 text-sm font-semibold">
              <span className="col-span-2 text-muted-foreground">Totals</span>
              <span className="text-right font-mono text-foreground">{totalDebit.toFixed(2)}</span>
              <span className="text-right font-mono text-foreground">{totalCredit.toFixed(2)}</span>
              <span />
            </div>

            {!isBalanced && totalDebit > 0 && (
              <p className="text-xs text-rose-600 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">
                Out of balance by {Math.abs(totalDebit - totalCredit).toFixed(2)} — debits must equal credits before posting
              </p>
            )}
          </div>

          <div className="px-6 py-4 border-t border-border flex items-center gap-3 shrink-0">
            {/* Draft toggle */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saveDraft}
                onChange={(e) => setSaveDraft(e.target.checked)}
                className="rounded border-border"
              />
              Save as draft
            </label>
            <div className="flex-1" />
            <button type="button" onClick={onClose}
              className="h-10 px-4 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !isBalanced}
              className="h-10 px-5 text-white text-sm font-medium rounded-xl transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: 'var(--accent)' }}>
              {saving ? 'Saving…' : saveDraft ? 'Save Draft' : 'Post Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
