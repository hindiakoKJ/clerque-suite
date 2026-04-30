'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, X, DollarSign, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name: string;
}

interface OrderPayment {
  id: string;
  method: string;
  amount: string;
  reference: string | null;
  createdAt: string;
}

interface ArInvoice {
  id: string;
  orderNumber: string;
  createdAt: string;
  dueDate: string | null;
  customerId: string | null;
  customerName: string | null;
  customer: Customer | null;
  totalAmount: string;
  collectedAmount: number;
  balance: number;
  status: 'OPEN' | 'COMPLETED' | 'VOIDED';
  payments: OrderPayment[];
}

interface InvoiceListResponse {
  data: ArInvoice[];
  total: number;
  page: number;
  pages: number;
}

interface ArSummary {
  totalOutstanding: number;
  totalOverdue: number;
  customersWithOpenInvoices: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COLLECTION_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT'];

const INPUT_CLS =
  'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ' +
  'focus:border-transparent transition-shadow';

const PAYMENT_METHODS = [
  { value: 'CASH',            label: 'Cash' },
  { value: 'GCASH_PERSONAL',  label: 'GCash' },
  { value: 'MAYA_PERSONAL',   label: 'Maya' },
  { value: 'GCASH_BUSINESS',  label: 'GCash Business' },
  { value: 'MAYA_BUSINESS',   label: 'Maya Business' },
  { value: 'QR_PH',           label: 'QR Ph / Bank Transfer' },
];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function invoiceStatus(inv: ArInvoice): { label: string; color: string; Icon: React.ElementType } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (inv.balance === 0) {
    return { label: 'Collected', color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400', Icon: CheckCircle2 };
  }
  if (inv.dueDate && new Date(inv.dueDate) < today) {
    return { label: 'Overdue', color: 'bg-red-500/10 text-red-600 dark:text-red-400', Icon: AlertCircle };
  }
  return { label: 'Outstanding', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', Icon: Clock };
}

// ── Collect Modal ─────────────────────────────────────────────────────────────

function CollectModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: ArInvoice;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const [amount,        setAmount]        = useState(invoice.balance.toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [reference,     setReference]     = useState('');
  const [collectedAt,   setCollectedAt]   = useState(today);
  const [saving,        setSaving]        = useState(false);

  const customerLabel = invoice.customer?.name ?? invoice.customerName ?? 'Unknown';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Amount must be greater than 0'); return; }
    if (amt > invoice.balance + 0.01) {
      toast.error(`Amount exceeds remaining balance of ${formatPeso(invoice.balance)}`);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/ar/pos/invoices/${invoice.id}/collect`, {
        amount:        amt,
        paymentMethod,
        reference:     reference.trim() || undefined,
        collectedAt:   collectedAt || undefined,
      });
      toast.success('Collection recorded successfully.');
      onSaved();
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg ?? 'Failed to record collection');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl border border-border shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Record Collection</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{invoice.orderNumber} — {customerLabel}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Balance info */}
          <div className="flex items-center justify-between rounded-lg bg-muted/40 border border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">Remaining Balance</span>
            <span className="font-semibold text-foreground font-mono">{formatPeso(invoice.balance)}</span>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Amount <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={invoice.balance + 0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className={`${INPUT_CLS} w-full font-mono`}
            />
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className={`${INPUT_CLS} w-full`}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Reference */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Reference Number</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check #, GCash ref, bank ref…"
              className={`${INPUT_CLS} w-full`}
            />
          </div>

          {/* Collection Date */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Collection Date</label>
            <input
              type="date"
              value={collectedAt}
              onChange={(e) => setCollectedAt(e.target.value)}
              className={`${INPUT_CLS} w-full`}
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-5 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center gap-1.5"
              style={{ background: 'var(--accent)' }}
            >
              <DollarSign className="w-4 h-4" />
              {saving ? 'Recording…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type TabFilter = 'all' | 'outstanding' | 'collected';

export default function InvoicesPage() {
  const { user } = useAuthStore();
  const qc       = useQueryClient();
  const canCollect = COLLECTION_ROLES.includes(user?.role ?? '');

  const [tab,          setTab]          = useState<TabFilter>('all');
  const [customerId,   setCustomerId]   = useState('');
  const [from,         setFrom]         = useState('');
  const [to,           setTo]           = useState('');
  const [page,         setPage]         = useState(1);
  const [collectTarget, setCollectTarget] = useState<ArInvoice | null>(null);

  // Build query string
  function queryParams() {
    const p = new URLSearchParams();
    if (customerId) p.set('customerId', customerId);
    if (tab === 'outstanding') p.set('collected', 'false');
    if (tab === 'collected')   p.set('collected', 'true');
    if (from) p.set('from', from);
    if (to)   p.set('to', to);
    p.set('page', String(page));
    return p.toString();
  }

  const { data, isLoading } = useQuery<InvoiceListResponse>({
    queryKey: ['ar-invoices', tab, customerId, from, to, page],
    queryFn:  () => api.get(`/ar/pos/invoices?${queryParams()}`).then((r) => r.data),
    enabled:  !!user,
  });

  const { data: summary } = useQuery<ArSummary>({
    queryKey: ['ar-summary'],
    queryFn:  () => api.get('/ar/pos/summary').then((r) => r.data),
    enabled:  !!user,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['ar-customers-list'],
    queryFn:  () => api.get('/ar/customers?isActive=true').then((r) => r.data),
    enabled:  !!user,
  });

  function onCollectSaved() {
    setCollectTarget(null);
    qc.invalidateQueries({ queryKey: ['ar-invoices'] });
    qc.invalidateQueries({ queryKey: ['ar-summary'] });
    qc.invalidateQueries({ queryKey: ['ar-customers'] });
  }

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all',         label: 'All' },
    { key: 'outstanding', label: 'Outstanding' },
    { key: 'collected',   label: 'Collected' },
  ];

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-[var(--accent)]" />
          AR Invoices
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Charge orders and collection tracking</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Total Outstanding</p>
            <p className="text-2xl font-bold text-foreground font-mono">{formatPeso(summary.totalOutstanding)}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Total Overdue</p>
            <p className={`text-2xl font-bold font-mono ${summary.totalOverdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
              {formatPeso(summary.totalOverdue)}
            </p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Customers with Open Invoices</p>
            <p className="text-2xl font-bold text-foreground">{summary.customersWithOpenInvoices}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value); setPage(1); }}
          className={`${INPUT_CLS} w-auto`}
        >
          <option value="">All Customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className={INPUT_CLS}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className={INPUT_CLS}
          />
        </div>
        {(customerId || from || to) && (
          <button
            onClick={() => { setCustomerId(''); setFrom(''); setTo(''); setPage(1); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading invoices…</div>
      ) : (
        <>
          <div className="bg-background rounded-xl border border-border overflow-hidden">
            {!data?.data.length ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No invoices found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[750px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase">
                      <th className="px-4 py-2.5 text-left font-semibold">Invoice #</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                      <th className="px-4 py-2.5 text-left font-semibold hidden md:table-cell">Due Date</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Customer</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                      <th className="px-4 py-2.5 text-right font-semibold hidden lg:table-cell">Collected</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                      {canCollect && <th className="px-4 py-2.5 w-24" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.data.map((inv) => {
                      const status = invoiceStatus(inv);
                      return (
                        <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inv.orderNumber}</td>
                          <td className="px-4 py-3 text-foreground whitespace-nowrap">{fmtDate(inv.createdAt)}</td>
                          <td className="px-4 py-3 whitespace-nowrap hidden md:table-cell">
                            {inv.dueDate ? (
                              <span
                                className={
                                  inv.balance > 0 && new Date(inv.dueDate) < new Date()
                                    ? 'text-red-600 dark:text-red-400 font-medium'
                                    : 'text-foreground'
                                }
                              >
                                {fmtDate(inv.dueDate)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">
                              {inv.customer?.name ?? inv.customerName ?? '—'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-foreground">
                            {formatPeso(Number(inv.totalAmount))}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-muted-foreground hidden lg:table-cell">
                            {formatPeso(inv.collectedAmount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <span className={inv.balance > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
                              {formatPeso(inv.balance)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>
                              <status.Icon className="w-3 h-3" />
                              {status.label}
                            </span>
                          </td>
                          {canCollect && (
                            <td className="px-4 py-3">
                              {inv.balance > 0 && inv.status !== 'VOIDED' && (
                                <button
                                  onClick={() => setCollectTarget(inv)}
                                  className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors whitespace-nowrap"
                                >
                                  <DollarSign className="w-3 h-3" />
                                  Collect
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
          </div>

          {/* Pagination */}
          {(data?.pages ?? 0) > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-muted-foreground">
                Page {data?.page} of {data?.pages} ({data?.total} total)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(data?.pages ?? 1, p + 1))}
                  disabled={page === (data?.pages ?? 1)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {collectTarget && (
        <CollectModal
          invoice={collectTarget}
          onClose={() => setCollectTarget(null)}
          onSaved={onCollectSaved}
        />
      )}
    </div>
  );
}
