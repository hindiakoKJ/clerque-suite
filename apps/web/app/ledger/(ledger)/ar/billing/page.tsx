'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Plus, X, Send, Ban, DollarSign, ChevronRight, Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'VOIDED' | 'CANCELLED';

interface Customer {
  id: string;
  name: string;
  creditTermDays: number;
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface InvoiceLine {
  id?:        string;
  accountId:  string;
  account?:   { code: string; name: string };
  description?: string;
  quantity:   number;
  unitPrice:  number;
  taxAmount:  number;
  lineTotal:  number;
}

interface ARInvoice {
  id:              string;
  invoiceNumber:   string;
  status:          InvoiceStatus;
  invoiceDate:     string;
  dueDate:         string;
  customerId:      string;
  customer:        { id: string; name: string };
  branchId:        string | null;
  reference:       string | null;
  description:     string | null;
  notes:           string | null;
  subtotal:        string;
  vatAmount:       string;
  totalAmount:     string;
  paidAmount:      string;
  lines:           InvoiceLine[];
  createdAt:       string;
}

interface ListResponse {
  data:     ARInvoice[];
  total:    number;
  page:     number;
  pageSize: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WRITE_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT'];
const VOID_ROLES  = ['BUSINESS_OWNER', 'ACCOUNTANT'];

const INPUT_CLS =
  'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ' +
  'focus:border-transparent transition-shadow w-full';

const STATUS_BADGE: Record<InvoiceStatus, { label: string; cls: string }> = {
  DRAFT:          { label: 'Draft',     cls: 'bg-gray-100 text-gray-700' },
  OPEN:           { label: 'Open',      cls: 'bg-blue-100 text-blue-800' },
  PARTIALLY_PAID: { label: 'Partial',   cls: 'bg-amber-100 text-amber-800' },
  PAID:           { label: 'Paid',      cls: 'bg-green-100 text-green-800' },
  VOIDED:         { label: 'Voided',    cls: 'bg-red-100 text-red-800' },
  CANCELLED:      { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
};

const PAYMENT_METHODS = [
  { value: 'CASH',           label: 'Cash' },
  { value: 'GCASH_PERSONAL', label: 'GCash (personal)' },
  { value: 'GCASH_BUSINESS', label: 'GCash (business)' },
  { value: 'MAYA_PERSONAL',  label: 'Maya (personal)' },
  { value: 'MAYA_BUSINESS',  label: 'Maya (business)' },
  { value: 'QR_PH',          label: 'QR Ph / Bank Transfer' },
];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ── Create Modal ──────────────────────────────────────────────────────────────

interface LineDraft {
  accountId:   string;
  description: string;
  quantity:    string;
  unitPrice:   string;
  taxAmount:   string;
}

function emptyLine(): LineDraft {
  return { accountId: '', description: '', quantity: '1', unitPrice: '', taxAmount: '0' };
}

function CreateInvoiceModal({
  customers, accounts, onClose, onCreated,
}: {
  customers: Customer[];
  accounts:  Account[];
  onClose:   () => void;
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [termsDays, setTermsDays] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  // Revenue-type accounts make the most sense to default to
  const revenueAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'REVENUE'),
    [accounts],
  );

  function setLine(idx: number, field: keyof LineDraft, val: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: val } : l)));
  }
  function addLine() { setLines((p) => [...p, emptyLine()]); }
  function rmLine(idx: number) {
    setLines((p) => p.length > 1 ? p.filter((_, i) => i !== idx) : p);
  }

  const totals = useMemo(() => {
    let sub = 0, vat = 0, total = 0;
    for (const l of lines) {
      const q  = parseFloat(l.quantity)  || 0;
      const p  = parseFloat(l.unitPrice) || 0;
      const t  = parseFloat(l.taxAmount) || 0;
      const lt = q * p + t;
      sub   += q * p;
      vat   += t;
      total += lt;
    }
    return { sub, vat, total };
  }, [lines]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { toast.error('Pick a customer'); return; }
    if (lines.some((l) => !l.accountId || !l.unitPrice)) {
      toast.error('Each line needs an account and unit price'); return;
    }
    setSaving(true);
    try {
      await api.post('/ar/invoices', {
        customerId,
        invoiceDate,
        termsDays: termsDays ? parseInt(termsDays, 10) : undefined,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        lines: lines.map((l) => {
          const q  = parseFloat(l.quantity)  || 1;
          const p  = parseFloat(l.unitPrice) || 0;
          const t  = parseFloat(l.taxAmount) || 0;
          return {
            accountId:   l.accountId,
            description: l.description.trim() || undefined,
            quantity:    q,
            unitPrice:   p,
            taxAmount:   t,
            lineTotal:   q * p + t,
          };
        }),
      });
      toast.success('Draft invoice created');
      onCreated();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-background rounded-xl shadow-2xl border border-border w-full max-w-3xl my-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">New AR Invoice</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Customer *</label>
              <select className={INPUT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Invoice Date *</label>
              <input type="date" className={INPUT_CLS} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Terms (days)</label>
              <input type="number" placeholder="defaults to customer's net" className={INPUT_CLS}
                value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Reference / PO#</label>
              <input className={INPUT_CLS} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
            <input className={INPUT_CLS} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Lines *</label>
              <button type="button" onClick={addLine}
                className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-start p-2 rounded-lg bg-muted/30">
                  <select className={`${INPUT_CLS} col-span-4`} value={line.accountId}
                    onChange={(e) => setLine(idx, 'accountId', e.target.value)}>
                    <option value="">Account…</option>
                    {revenueAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                    <optgroup label="All accounts">
                      {accounts.filter((a) => a.type !== 'REVENUE').map((a) => (
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </optgroup>
                  </select>
                  <input className={`${INPUT_CLS} col-span-3`} placeholder="Description"
                    value={line.description} onChange={(e) => setLine(idx, 'description', e.target.value)} />
                  <input type="number" step="0.01" className={`${INPUT_CLS} col-span-1`} placeholder="Qty"
                    value={line.quantity} onChange={(e) => setLine(idx, 'quantity', e.target.value)} />
                  <input type="number" step="0.01" className={`${INPUT_CLS} col-span-2`} placeholder="Unit price"
                    value={line.unitPrice} onChange={(e) => setLine(idx, 'unitPrice', e.target.value)} />
                  <input type="number" step="0.01" className={`${INPUT_CLS} col-span-1`} placeholder="VAT"
                    value={line.taxAmount} onChange={(e) => setLine(idx, 'taxAmount', e.target.value)} />
                  <button type="button" onClick={() => rmLine(idx)}
                    className="col-span-1 h-9 flex items-center justify-center text-muted-foreground hover:text-red-600"
                    disabled={lines.length === 1}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-6 pt-2 border-t border-border text-sm">
            <div className="text-muted-foreground">Subtotal: <span className="text-foreground font-medium">{formatPeso(totals.sub)}</span></div>
            <div className="text-muted-foreground">VAT: <span className="text-foreground font-medium">{formatPeso(totals.vat)}</span></div>
            <div className="text-foreground font-semibold">Total: {formatPeso(totals.total)}</div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="h-9 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Detail Drawer ────────────────────────────────────────────────────────────

function DetailDrawer({
  invoice, onClose, onChanged, canWrite, canVoid,
}: {
  invoice:   ARInvoice;
  onClose:   () => void;
  onChanged: () => void;
  canWrite:  boolean;
  canVoid:   boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const balance = Number(invoice.totalAmount) - Number(invoice.paidAmount);

  async function action(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      toast.success(`${label} successful`);
      onChanged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? `${label} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex justify-end">
      <div className="bg-background w-full max-w-xl h-full overflow-y-auto shadow-2xl border-l border-border">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-background z-10">
          <div>
            <div className="text-xs text-muted-foreground">{STATUS_BADGE[invoice.status].label}</div>
            <h2 className="text-lg font-semibold">{invoice.invoiceNumber}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Customer</div>
              <div className="font-medium">{invoice.customer.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[invoice.status].cls}`}>
                {STATUS_BADGE[invoice.status].label}
              </span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Invoice Date</div>
              <div>{fmtDate(invoice.invoiceDate)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Due Date</div>
              <div>{fmtDate(invoice.dueDate)}</div>
            </div>
            {invoice.reference && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Reference</div>
                <div>{invoice.reference}</div>
              </div>
            )}
            {invoice.description && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Description</div>
                <div>{invoice.description}</div>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Line Items</div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1.5">Account</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Unit</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-2">
                      <div className="font-medium">{l.account?.code} — {l.account?.name}</div>
                      {l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}
                    </td>
                    <td className="text-right">{Number(l.quantity)}</td>
                    <td className="text-right">{formatPeso(Number(l.unitPrice))}</td>
                    <td className="text-right font-medium">{formatPeso(Number(l.lineTotal))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 text-sm border-t border-border pt-3">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatPeso(Number(invoice.subtotal))}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>VAT</span>
              <span>{formatPeso(Number(invoice.vatAmount))}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{formatPeso(Number(invoice.totalAmount))}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Paid</span>
              <span>{formatPeso(Number(invoice.paidAmount))}</span>
            </div>
            <div className="flex justify-between font-semibold text-[var(--accent)]">
              <span>Balance</span>
              <span>{formatPeso(balance)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
            {invoice.status === 'DRAFT' && canWrite && (
              <>
                <button disabled={busy} onClick={() => action('Posted', async () => {
                  await api.patch(`/ar/invoices/${invoice.id}/post`);
                })}
                  className="h-9 px-3 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
                  <Send className="w-4 h-4" /> Post (creates JE)
                </button>
                <button disabled={busy} onClick={() => {
                  const reason = window.prompt('Cancel reason:');
                  if (!reason) return;
                  action('Cancelled', async () => {
                    await api.post(`/ar/invoices/${invoice.id}/cancel`, { reason });
                  });
                }}
                  className="h-9 px-3 rounded-lg border border-border text-sm flex items-center gap-1.5 disabled:opacity-50">
                  <Ban className="w-4 h-4" /> Cancel
                </button>
              </>
            )}
            {(invoice.status === 'OPEN' || invoice.status === 'PARTIALLY_PAID') && canWrite && (
              <button onClick={() => setShowPay(true)}
                className="h-9 px-3 rounded-lg bg-green-600 text-white text-sm font-medium flex items-center gap-1.5">
                <DollarSign className="w-4 h-4" /> Record Payment
              </button>
            )}
            {(invoice.status === 'OPEN' || invoice.status === 'PARTIALLY_PAID') && canVoid && (
              <button disabled={busy} onClick={() => {
                const reason = window.prompt('Void reason (will reverse the JE):');
                if (!reason) return;
                action('Voided', async () => {
                  await api.post(`/ar/invoices/${invoice.id}/void`, { reason });
                });
              }}
                className="h-9 px-3 rounded-lg border border-red-300 text-red-700 text-sm flex items-center gap-1.5 disabled:opacity-50">
                <Ban className="w-4 h-4" /> Void
              </button>
            )}
          </div>
        </div>

        {showPay && (
          <RecordPaymentModal
            invoice={invoice}
            balance={balance}
            onClose={() => setShowPay(false)}
            onSaved={() => { setShowPay(false); onChanged(); }}
          />
        )}
      </div>
    </div>
  );
}

// ── Payment Modal ────────────────────────────────────────────────────────────

function RecordPaymentModal({
  invoice, balance, onClose, onSaved,
}: {
  invoice: ARInvoice;
  balance: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Invalid amount'); return; }
    setSaving(true);
    try {
      await api.post('/ar/payments', {
        customerId:  invoice.customerId,
        paymentDate,
        method,
        reference:   reference.trim() || undefined,
        totalAmount: amt,
        applications: [{ invoiceId: invoice.id, appliedAmount: Math.min(amt, balance) }],
      });
      toast.success('Payment recorded');
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl border border-border w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-semibold">Record Payment</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Amount *</label>
            <input type="number" step="0.01" className={INPUT_CLS}
              value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="text-xs text-muted-foreground mt-1">Balance: {formatPeso(balance)}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Method *</label>
            <select className={INPUT_CLS} value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Reference (OR#, GCash ref)</label>
            <input className={INPUT_CLS} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Payment Date *</label>
            <input type="date" className={INPUT_CLS}
              value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="h-9 px-4 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ARBillingPage() {
  const user = useAuthStore((s) => s.user);
  const qc   = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ARInvoice | null>(null);

  const canWrite = user ? WRITE_ROLES.includes(user.role) : false;
  const canVoid  = user ? VOID_ROLES.includes(user.role)  : false;

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);

  const { data: list, isLoading } = useQuery<ListResponse>({
    queryKey: ['ar-billing-list', statusFilter],
    queryFn:  () => api.get(`/ar/invoices?${params.toString()}`).then((r) => r.data),
    enabled:  !!user,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['ar-customers-list'],
    queryFn:  () => api.get('/ar/customers').then((r) => r.data?.data ?? r.data),
    enabled:  !!user,
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts-list'],
    queryFn:  () => api.get('/accounting/accounts').then((r) => r.data),
    enabled:  !!user,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ar-billing-list'] });
    if (selected) {
      api.get(`/ar/invoices/${selected.id}`).then((r) => setSelected(r.data)).catch(() => setSelected(null));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileText className="w-6 h-6" /> AR Billing
          </h1>
          <p className="text-sm text-muted-foreground">
            Formal customer invoices — back-office. Posts to GL on confirmation.
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setCreating(true)}
            className="h-10 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Invoice
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['', 'DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'VOIDED'] as const).map((s) => (
          <button key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className={`h-8 px-3 rounded-full text-xs font-medium border ${
              statusFilter === s
                ? 'bg-[var(--accent)] text-white border-transparent'
                : 'bg-background border-border text-muted-foreground hover:text-foreground'
            }`}>
            {s ? STATUS_BADGE[s].label : 'All'}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Invoice #</th>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Customer</th>
              <th className="text-right px-4 py-2">Total</th>
              <th className="text-right px-4 py-2">Balance</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</td></tr>
            ) : (list?.data ?? []).length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                No invoices yet. {canWrite && 'Click "New Invoice" to create one.'}
              </td></tr>
            ) : (
              list!.data.map((inv) => {
                const bal = Number(inv.totalAmount) - Number(inv.paidAmount);
                return (
                  <tr key={inv.id}
                    onClick={() => setSelected(inv)}
                    className="border-t border-border hover:bg-muted/40 cursor-pointer">
                    <td className="px-4 py-2 font-medium">{inv.invoiceNumber}</td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtDate(inv.invoiceDate)}</td>
                    <td className="px-4 py-2">{inv.customer.name}</td>
                    <td className="px-4 py-2 text-right">{formatPeso(Number(inv.totalAmount))}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPeso(bal)}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[inv.status].cls}`}>
                        {STATUS_BADGE[inv.status].label}
                      </span>
                    </td>
                    <td className="px-2"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateInvoiceModal
          customers={customers}
          accounts={accounts}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refresh(); }}
        />
      )}

      {selected && (
        <DetailDrawer
          invoice={selected}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          canWrite={canWrite}
          canVoid={canVoid}
        />
      )}
    </div>
  );
}
