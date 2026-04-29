'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown, ChevronRight, Plus, X, Receipt,
  RotateCcw, CheckCircle2, Clock, FileText, AlertTriangle, Download, Upload,
  FileSpreadsheet,
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
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <ImportJournalButton onImported={() => qc.invalidateQueries({ queryKey: ['journal'] })} />
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 h-9 px-4 text-white text-sm font-medium rounded-lg transition-opacity hover:opacity-90 whitespace-nowrap"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="h-4 w-4" /> New Entry
            </button>
          </div>
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
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export to Excel"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{exporting ? 'Exporting…' : '.xlsx'}</span>
          </button>
          {canEdit && (
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
              title="Import journal entries from Excel/CSV"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Import</span>
            </button>
          )}
        </div>
      </div>

      <ImportModal
        open={showImport}
        title="Import Journal Entries"
        templateUrl="/import/template/journal-entries"
        uploadUrl="/import/journal-entries"
        onClose={() => setShowImport(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['journal'] })}
      />

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
  // AI gate — JWT-resolved monthly quota (tier-included + active addon +
  // override). 0 = no AI access; >0 = surfaces visible. Backend re-validates
  // every call against actual usage via AiQuotaGuard.
  const aiQuotaMonthly = useAuthStore((s) => s.user?.aiQuotaMonthly ?? 0);
  const aiEnabled = aiQuotaMonthly > 0;

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

  // ── AI Drafter state ────────────────────────────────────────────────────
  const [aiOpen,       setAiOpen]       = useState(false);
  const [aiPrompt,     setAiPrompt]     = useState('');
  const [aiPending,    setAiPending]    = useState(false);
  const [aiUsed,       setAiUsed]       = useState(false);
  const [aiUncertainties, setAiUncertainties] = useState<string[]>([]);

  // ── AI Guide state ──────────────────────────────────────────────────────
  interface GuideIssue {
    severity:   'BLOCK' | 'WARN' | 'INFO';
    lineIndex:  number | null;
    message:    string;
    rationale:  string;
    suggestion?: {
      type:        'swap_account' | 'add_line' | 'swap_side' | 'delete_line' | 'edit_amount' | 'advice_only';
      description: string;
      accountId?:  string;
      side?:       'DEBIT' | 'CREDIT';
      amount?:     number;
    };
  }
  interface GuideResult {
    verdict: 'OK' | 'WARNINGS' | 'BLOCKING';
    summary: string;
    issues:  GuideIssue[];
  }
  const [guidePending, setGuidePending] = useState(false);
  const [guideResult,  setGuideResult]  = useState<GuideResult | null>(null);

  async function handleGuideCheck() {
    const validLines = lines.filter((l) => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (validLines.length === 0) {
      toast.error('Add at least one complete line before checking.');
      return;
    }
    setGuidePending(true);
    try {
      const { data } = await api.post('/ai/journal-validate', {
        date:      docDate,
        memo:      desc || '(no memo)',
        reference: reference || undefined,
        lines: validLines.map((l) => ({
          accountId:   l.accountId,
          side:        parseFloat(l.debit) > 0 ? 'DEBIT' : 'CREDIT',
          amount:      parseFloat(l.debit) > 0 ? parseFloat(l.debit) : parseFloat(l.credit),
          description: l.description || undefined,
        })),
      });
      setGuideResult(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not check the entry. Try again.';
      toast.error(msg);
    } finally {
      setGuidePending(false);
    }
  }

  function applyGuideSuggestion(issue: GuideIssue) {
    const s = issue.suggestion;
    if (!s) return;
    const idx = issue.lineIndex;
    if (s.type === 'swap_account' && idx != null && s.accountId) {
      setLines((prev) => prev.map((l, i) => i === idx ? { ...l, accountId: s.accountId! } : l));
    } else if (s.type === 'swap_side' && idx != null) {
      setLines((prev) => prev.map((l, i) => i === idx ? { ...l, debit: l.credit, credit: l.debit } : l));
    } else if (s.type === 'delete_line' && idx != null) {
      setLines((prev) => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev);
    } else if (s.type === 'add_line' && s.accountId && s.amount != null && s.side) {
      setLines((prev) => [...prev, {
        accountId:   s.accountId!,
        description: '',
        debit:       s.side === 'DEBIT'  ? s.amount!.toFixed(2) : '',
        credit:      s.side === 'CREDIT' ? s.amount!.toFixed(2) : '',
      }]);
    } else if (s.type === 'edit_amount' && idx != null && s.amount != null) {
      setLines((prev) => prev.map((l, i) => {
        if (i !== idx) return l;
        const isDebit = parseFloat(l.debit) > 0;
        return isDebit
          ? { ...l, debit: s.amount!.toFixed(2) }
          : { ...l, credit: s.amount!.toFixed(2) };
      }));
    } else {
      // advice_only — just dismiss the issue
    }
    // Remove the applied issue from the result so the panel updates immediately
    setGuideResult((prev) => prev ? {
      ...prev,
      issues: prev.issues.filter((i) => i !== issue),
    } : null);
    toast.success('Applied');
  }

  async function handleAiDraft() {
    if (aiPrompt.trim().length < 5) {
      toast.error('Describe the transaction in at least a few words.');
      return;
    }
    setAiPending(true);
    try {
      const { data } = await api.post('/ai/journal-draft', { description: aiPrompt.trim() });
      // Apply: date, memo, reference, lines (replace, not merge — AI gives the
      // whole entry; user can still edit afterward).
      if (data.date) {
        setDocDate(data.date);
        setPostingDate(data.date);
      }
      if (data.memo)      setDesc(data.memo);
      if (data.reference) setReference(data.reference);
      if (Array.isArray(data.lines) && data.lines.length > 0) {
        const draftedLines: DraftLine[] = data.lines.map((l: { accountId: string; side: 'DEBIT' | 'CREDIT'; amount: number; description: string }) => ({
          accountId:   l.accountId,
          description: l.description ?? '',
          debit:       l.side === 'DEBIT'  ? l.amount.toFixed(2) : '',
          credit:      l.side === 'CREDIT' ? l.amount.toFixed(2) : '',
        }));
        // Keep at least 2 rows visible
        while (draftedLines.length < 2) draftedLines.push({ accountId: '', description: '', debit: '', credit: '' });
        setLines(draftedLines);
      }
      setAiUncertainties(data.uncertainties ?? []);
      setAiUsed(true);
      setAiOpen(false);
      toast.success('Draft ready — review every line before posting.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'AI drafter failed. Try rephrasing or filling the form manually.';
      toast.error(msg);
    } finally {
      setAiPending(false);
    }
  }

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
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">New Journal Entry</h2>
            {aiEnabled && (
              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                  aiOpen
                    ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                    : 'bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] border-[var(--accent)]/30 text-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]'
                }`}
              >
                ✨ Describe & draft
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            {/* AI Drafter input */}
            {aiOpen && (
              <div className="rounded-xl border border-[var(--accent)]/30 bg-[color-mix(in_oklab,var(--accent)_4%,transparent)] p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Describe the transaction in plain language — the AI will draft a balanced JE you can review.
                </p>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  autoFocus
                  placeholder="e.g. Paid Meralco bill ₱8,500 last Tuesday from BPI checking"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setAiOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAiDraft}
                    disabled={aiPending || aiPrompt.trim().length < 5}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 transition-opacity"
                    style={{ background: 'var(--accent)' }}
                  >
                    {aiPending ? 'Drafting…' : 'Draft entry'}
                  </button>
                </div>
              </div>
            )}

            {aiUsed && aiUncertainties.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 space-y-1">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  ✨ AI-assisted draft — review these before posting:
                </p>
                <ul className="text-xs text-amber-800 dark:text-amber-300/90 list-disc pl-4 space-y-0.5">
                  {aiUncertainties.map((u, i) => <li key={i}>{u}</li>)}
                </ul>
              </div>
            )}

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
                  <SmartAccountLine
                    key={i}
                    line={line}
                    index={i}
                    memo={desc}
                    openAccounts={openAccounts}
                    excludeIds={lines.filter((_, idx) => idx !== i).map((l) => l.accountId).filter(Boolean)}
                    onUpdate={(patch) => updateLine(i, patch)}
                    onRemove={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    canRemove={lines.length > 2}
                    fieldCls={fieldCls}
                    aiEnabled={aiEnabled}
                  >
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
                  </SmartAccountLine>
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

            {/* AI Guide panel */}
            {guideResult && (
              <div className={`rounded-xl border px-3 py-3 space-y-2 ${
                guideResult.verdict === 'BLOCKING'
                  ? 'border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800'
                  : guideResult.verdict === 'WARNINGS'
                    ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700'
                    : 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`text-xs font-bold uppercase tracking-wide ${
                      guideResult.verdict === 'BLOCKING' ? 'text-red-700 dark:text-red-300'
                      : guideResult.verdict === 'WARNINGS' ? 'text-amber-700 dark:text-amber-300'
                      : 'text-emerald-700 dark:text-emerald-300'
                    }`}>
                      ✨ AI Check — {guideResult.verdict === 'OK' ? 'Looks good' : guideResult.verdict === 'WARNINGS' ? 'Review before posting' : 'Resolve before posting'}
                    </p>
                    <p className="text-xs text-foreground mt-0.5">{guideResult.summary}</p>
                  </div>
                  <button type="button" onClick={() => setGuideResult(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {guideResult.issues.length > 0 && (
                  <ul className="space-y-1.5 text-xs">
                    {guideResult.issues.map((issue, i) => (
                      <li key={i} className="bg-background/60 rounded-lg px-2 py-1.5">
                        <div className="flex items-start gap-2">
                          <span className={`font-mono text-[9px] uppercase tracking-wide px-1 py-0.5 rounded mt-0.5 shrink-0 ${
                            issue.severity === 'BLOCK' ? 'bg-red-200 dark:bg-red-900 text-red-900 dark:text-red-200'
                            : issue.severity === 'WARN' ? 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200'
                            : 'bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
                          }`}>{issue.severity}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-foreground">
                              {issue.lineIndex != null && <span className="font-mono text-muted-foreground">Line {issue.lineIndex + 1}: </span>}
                              {issue.message}
                            </p>
                            <p className="text-muted-foreground mt-0.5">{issue.rationale}</p>
                            {issue.suggestion && issue.suggestion.type !== 'advice_only' && (
                              <button
                                type="button"
                                onClick={() => applyGuideSuggestion(issue)}
                                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded text-white"
                                style={{ background: 'var(--accent)' }}
                              >
                                Apply: {issue.suggestion.description}
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
            {aiEnabled && (
              <button
                type="button"
                onClick={handleGuideCheck}
                disabled={guidePending}
                className="h-10 px-4 rounded-xl border border-[var(--accent)]/40 text-sm font-medium text-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] disabled:opacity-50 transition-colors"
                title="Have AI review the entry before you post it"
              >
                {guidePending ? 'Checking…' : '✨ Check entry'}
              </button>
            )}
            <button type="button" onClick={onClose}
              className="h-10 px-4 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !isBalanced || (guideResult?.verdict === 'BLOCKING' && !saveDraft)}
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

// ── SmartAccountLine ──────────────────────────────────────────────────────────
// One row of the JE form, with AI-flavoured account suggestion chips that
// appear when the user has typed a memo but not yet picked an account. Each
// chip is a one-tap "use this account" button. Lookups are fully RAG-side
// (no LLM), sub-100ms, debounced 250ms after the memo settles.

interface SmartAccountLineProps {
  line:         DraftLine;
  index:        number;
  memo:         string;
  openAccounts: AccountOption[];
  excludeIds:   string[];
  onUpdate:     (patch: Partial<DraftLine>) => void;
  onRemove:     () => void;
  canRemove:    boolean;
  fieldCls:     string;
  aiEnabled:    boolean;
  children:     React.ReactNode;
}

interface SuggestionRow {
  accountId:     string;
  code:          string;
  name:          string;
  type:          string;
  normalBalance: 'DEBIT' | 'CREDIT';
  reasons:       string[];
}

function SmartAccountLine({ line, memo, excludeIds, onUpdate, aiEnabled, children }: SmartAccountLineProps) {
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [loading, setLoading]         = useState(false);

  // Side: derive from which amount field the user has touched. If both are
  // empty (line not yet started) suggest debits — the more common "first move".
  const debitNum  = parseFloat(line.debit)  || 0;
  const creditNum = parseFloat(line.credit) || 0;
  const side: 'DEBIT' | 'CREDIT' = creditNum > 0 ? 'CREDIT' : 'DEBIT';

  // Debounce 250ms on memo + side changes; skip when memo is empty, an
  // account is already chosen, or AI is not enabled for this tenant.
  useEffect(() => {
    if (!aiEnabled) { setSuggestions([]); return; }
    if (line.accountId) { setSuggestions([]); return; }
    if (memo.trim().length < 3) { setSuggestions([]); return; }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.post('/ai/suggest-accounts', {
          memo, side, excludeIds, limit: 5,
        });
        setSuggestions(data.suggestions ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
    // excludeIds is stringified-stable enough via memo dep; intentionally narrow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled, memo, side, line.accountId, excludeIds.join(',')]);

  return (
    <div className="space-y-1">
      {!line.accountId && suggestions.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {loading ? 'Suggesting…' : 'Suggest'}:
          </span>
          {suggestions.map((s) => (
            <button
              key={s.accountId}
              type="button"
              onClick={() => onUpdate({ accountId: s.accountId })}
              title={s.reasons.length ? s.reasons.join(' · ') : `${s.type} · ${s.normalBalance}`}
              className="text-[11px] font-mono px-2 py-0.5 rounded-md border border-[var(--accent)]/30 bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-foreground transition-colors"
            >
              {s.code} · {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[1fr_1fr_100px_100px_32px] gap-1.5 items-center">
        {children}
      </div>
    </div>
  );
}

// ── Import Journal button + modal ─────────────────────────────────────────────
// Two actions: download a tenant-specific Excel template, and upload a filled
// template back. Atomic — either all JEs in the file post or none do.

interface ImportRowError { row: number; column: string; message: string }
interface ImportResult {
  successful:    number;
  failed:        number;
  errors:        ImportRowError[];
  postedEntries: { entryNumber: string; description: string; lineCount: number }[];
}

function ImportJournalButton({ onImported }: { onImported: () => void }) {
  const [open, setOpen]               = useState(false);
  const [mode, setMode]               = useState<'je' | 'tb'>('je');
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [result, setResult]           = useState<ImportResult | null>(null);
  const [tbDate, setTbDate]           = useState(() => {
    // Default to last day of previous month — most common migration date
    const d = new Date();
    d.setDate(0);
    return d.toISOString().slice(0, 10);
  });
  const [tbMemo, setTbMemo]           = useState('');
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    setDownloading(true);
    try {
      const url = mode === 'je'
        ? '/accounting/journal/import/template'
        : '/accounting/journal/import/trial-balance/template';
      const filename = mode === 'je'
        ? `je-import-template-${new Date().toISOString().slice(0, 10)}.xlsx`
        : `trial-balance-template-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const res = await api.get(url, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success('Template downloaded');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not download template.';
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.endsWith('.xlsx')) {
      toast.error('Please upload an .xlsx file (use the downloaded template).');
      return;
    }
    if (mode === 'tb' && !tbDate) {
      toast.error('Pick a migration date before uploading.');
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      let url: string;
      if (mode === 'je') {
        url = '/accounting/journal/import';
      } else {
        url = '/accounting/journal/import/trial-balance';
        fd.append('migrationDate', tbDate);
        if (tbMemo.trim()) fd.append('memo', tbMemo.trim());
      }
      const { data } = await api.post<ImportResult>(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      if (data.successful > 0 && data.failed === 0) {
        toast.success(mode === 'je'
          ? `Posted ${data.successful} journal ${data.successful === 1 ? 'entry' : 'entries'}`
          : `Opening balance posted (${data.postedEntries[0]?.lineCount ?? 0} accounts)`);
        onImported();
      } else if (data.failed > 0) {
        toast.error(`No entries posted — ${data.errors.length} ${data.errors.length === 1 ? 'error' : 'errors'} found. Review and re-upload.`);
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Upload failed.';
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-border bg-background hover:bg-secondary transition-colors text-foreground whitespace-nowrap"
        title="Import journal entries from Excel"
      >
        <FileSpreadsheet className="h-4 w-4" /> Import
      </button>

      {open && (
        <div className="fixed inset-0 bg-foreground/40 flex items-center justify-center p-4 z-50">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-5 border-b border-border shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Import from Excel</h2>
                <button onClick={() => { setOpen(false); setResult(null); }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {/* Mode tabs */}
              <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5 mt-3">
                <button
                  type="button"
                  onClick={() => { setMode('je'); setResult(null); }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    mode === 'je' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Journal Entries
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('tb'); setResult(null); }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    mode === 'tb' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Trial Balance (one-shot)
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {mode === 'je'
                  ? 'Bulk-post many journal entries from a single Excel file. Atomic — all or nothing.'
                  : 'Migrate closing balances from your previous accounting system into Clerque. Run this once at cutover.'}
              </p>
            </div>

            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              {/* Step 1 */}
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Step 1</p>
                <p className="text-sm font-semibold text-foreground">Download the Excel template</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {mode === 'je'
                    ? 'The template includes your Chart of Accounts as a reference sheet, plus instructions and sample rows.'
                    : 'The template lists every active account in your COA. Fill in each closing balance and verify the DIFFERENCE row shows 0.'}
                </p>
                <button
                  onClick={downloadTemplate}
                  disabled={downloading}
                  className="mt-3 inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-border bg-background hover:bg-secondary text-foreground disabled:opacity-50"
                >
                  {downloading ? 'Generating…' : <><FileSpreadsheet className="h-4 w-4" /> Download template</>}
                </button>
              </div>

              {/* TB-specific fields */}
              {mode === 'tb' && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Migration details</p>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Migration date <span className="text-red-500">*</span></label>
                    <input
                      type="date"
                      value={tbDate}
                      onChange={(e) => setTbDate(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Usually month-end of the period before you cut over to Clerque. Must fall in an OPEN accounting period.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Memo (optional)</label>
                    <input
                      type="text"
                      value={tbMemo}
                      onChange={(e) => setTbMemo(e.target.value)}
                      maxLength={500}
                      placeholder={`Opening Balance — ${tbDate}`}
                      className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                  </div>
                </div>
              )}

              {/* Step 2 */}
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Step {mode === 'tb' ? '3' : '2'}</p>
                <p className="text-sm font-semibold text-foreground">Upload the filled file</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Atomic — either all entries post, or none do. Per-row errors will be shown so you can fix and re-upload.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="mt-3 inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {uploading ? 'Uploading…' : <><Plus className="h-4 w-4" /> Choose .xlsx file</>}
                </button>
              </div>

              {/* Result */}
              {result && (
                <div className={`rounded-lg border p-4 ${
                  result.failed > 0
                    ? 'border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800'
                    : 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700'
                }`}>
                  <p className={`text-sm font-bold ${result.failed > 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {result.failed > 0
                      ? `${result.failed} ${result.failed === 1 ? 'entry' : 'entries'} blocked — fix and re-upload`
                      : `Posted ${result.successful} ${result.successful === 1 ? 'entry' : 'entries'}`}
                  </p>
                  {result.errors.length > 0 && (
                    <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto text-xs">
                      {result.errors.map((e, i) => (
                        <li key={i} className="text-foreground">
                          <span className="font-mono text-muted-foreground">Row {e.row}, {e.column}:</span> {e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {result.postedEntries.length > 0 && (
                    <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto text-xs">
                      {result.postedEntries.map((p, i) => (
                        <li key={i} className="text-emerald-800 dark:text-emerald-200">
                          <span className="font-mono">{p.entryNumber}</span> — {p.description} ({p.lineCount} lines)
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end shrink-0">
              <button
                onClick={() => { setOpen(false); setResult(null); }}
                className="h-10 px-4 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-secondary"
              >
                {result?.successful ? 'Done' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
