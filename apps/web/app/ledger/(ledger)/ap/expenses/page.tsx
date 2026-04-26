'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, FileText, CheckCircle2, AlertTriangle,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Types ─────────────────────────────────────────────────────────────────────

type ExpenseStatus = 'DRAFT' | 'POSTED' | 'VOIDED';

interface VendorOption {
  id: string;
  name: string;
  defaultAtcCode: string | null;
  defaultWhtRate: string | null;
}

interface Expense {
  id: string;
  description: string;
  expenseDate: string;
  grossAmount: string;
  whtRate: string | null;
  whtAmount: string;
  netAmount: string;
  inputVat: string;
  atcCode: string | null;
  referenceNumber: string | null;
  dueDate: string | null;
  paidAt: string | null;
  paidAmount: string | null;
  paymentRef: string | null;
  status: ExpenseStatus;
  notes: string | null;
  vendor: { id: string; name: string; tin: string | null } | null;
}

interface ExpenseResponse {
  data: Expense[];
  total: number;
  page: number;
  pages: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT']);
const POST_VOID_ROLES = new Set(['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT']);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

const STATUS_CONFIG: Record<ExpenseStatus, { label: string; cls: string; Icon: React.ElementType }> = {
  DRAFT:  { label: 'Draft',  cls: 'bg-muted text-muted-foreground',                    Icon: FileText      },
  POSTED: { label: 'Posted', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',   Icon: CheckCircle2  },
  VOIDED: { label: 'Voided', cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',   Icon: AlertTriangle },
};

function paymentStatus(expense: Expense): { label: string; cls: string } {
  if (expense.status !== 'POSTED') return { label: '', cls: '' };
  const net = Number(expense.netAmount);
  const paid = Number(expense.paidAmount ?? 0);
  if (paid <= 0) return { label: 'Unpaid', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' };
  if (paid >= net - 0.005) return { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };
  return { label: 'Partial', cls: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' };
}

const FIELD = 'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow w-full';

// ── Expense Form Modal ────────────────────────────────────────────────────────

interface ExpenseFormData {
  vendorId: string;
  description: string;
  expenseDate: string;
  grossAmount: string;
  atcCode: string;
  whtRate: string;
  inputVat: string;
  referenceNumber: string;
  dueDate: string;
  notes: string;
}

function ExpenseModal({
  expense,
  vendors,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  vendors: VendorOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!expense;
  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState<ExpenseFormData>({
    vendorId: expense?.vendor?.id ?? '',
    description: expense?.description ?? '',
    expenseDate: expense ? expense.expenseDate.split('T')[0] : today,
    grossAmount: expense ? String(Number(expense.grossAmount)) : '',
    atcCode: expense?.atcCode ?? '',
    whtRate: expense?.whtRate ? String(Number(expense.whtRate) * 100) : '',
    inputVat: expense ? String(Number(expense.inputVat)) : '0',
    referenceNumber: expense?.referenceNumber ?? '',
    dueDate: expense?.dueDate ? expense.dueDate.split('T')[0] : '',
    notes: expense?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);

  function patch(key: keyof ExpenseFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Auto-fill from vendor
  function handleVendorChange(vendorId: string) {
    const v = vendors.find((x) => x.id === vendorId);
    patch('vendorId', vendorId);
    if (v) {
      if (!form.atcCode && v.defaultAtcCode) patch('atcCode', v.defaultAtcCode);
      if (!form.whtRate && v.defaultWhtRate) {
        patch('whtRate', String(Number(v.defaultWhtRate) * 100));
      }
    }
  }

  // Computed fields
  const gross = parseFloat(form.grossAmount) || 0;
  const whtRatePct = parseFloat(form.whtRate) || 0;
  const whtRate = whtRatePct / 100;
  const whtAmount = Math.round(gross * whtRate * 100) / 100;
  const netAmount = Math.round((gross - whtAmount) * 100) / 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) { toast.error('Description is required'); return; }
    if (!form.grossAmount || gross <= 0) { toast.error('Gross amount must be greater than zero'); return; }

    const payload = {
      vendorId: form.vendorId || undefined,
      description: form.description.trim(),
      expenseDate: form.expenseDate,
      grossAmount: String(gross),
      atcCode: form.atcCode.trim() || undefined,
      whtRate: whtRate > 0 ? String(whtRate) : undefined,
      inputVat: String(parseFloat(form.inputVat) || 0),
      referenceNumber: form.referenceNumber.trim() || undefined,
      dueDate: form.dueDate || undefined,
      notes: form.notes.trim() || undefined,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/ap/expenses/${expense!.id}`, payload);
        toast.success('Expense updated.');
      } else {
        await api.post('/ap/expenses', payload);
        toast.success('Expense saved as draft.');
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Expense' : 'New Expense'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Vendor */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Vendor</label>
            <select
              value={form.vendorId}
              onChange={(e) => handleVendorChange(e.target.value)}
              className={FIELD}
            >
              <option value="">— No vendor —</option>
              {vendors.filter((v) => (v as VendorOption & { isActive?: boolean }).isActive !== false).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          {/* Description + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="e.g. Office supplies"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Expense Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.expenseDate}
                onChange={(e) => patch('expenseDate', e.target.value)}
                required
                className={FIELD}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Due Date</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => patch('dueDate', e.target.value)}
                className={FIELD}
              />
            </div>
          </div>

          {/* Amounts */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Gross Amount (Invoice) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.grossAmount}
                onChange={(e) => patch('grossAmount', e.target.value)}
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">ATC Code</label>
              <Input
                value={form.atcCode}
                onChange={(e) => patch('atcCode', e.target.value)}
                placeholder="e.g. WI160"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">WHT Rate (%)</label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.whtRate}
                onChange={(e) => patch('whtRate', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Input VAT</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.inputVat}
                onChange={(e) => patch('inputVat', e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Computed preview */}
          {gross > 0 && (
            <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gross Amount</span>
                <span className="font-mono font-medium text-foreground">{formatPeso(gross)}</span>
              </div>
              {whtAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    WHT ({whtRatePct.toFixed(2)}%)
                  </span>
                  <span className="font-mono text-rose-600">- {formatPeso(whtAmount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1 font-semibold">
                <span className="text-foreground">Net Payable</span>
                <span className="font-mono text-foreground">{formatPeso(netAmount)}</span>
              </div>
            </div>
          )}

          {/* Reference + Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Invoice Ref #</label>
              <Input
                value={form.referenceNumber}
                onChange={(e) => patch('referenceNumber', e.target.value)}
                placeholder="Vendor invoice #"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => patch('notes', e.target.value)}
                rows={2}
                className={FIELD + ' resize-none h-auto py-2'}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Draft'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Pay Modal ─────────────────────────────────────────────────────────────────

function PayModal({
  expense,
  onClose,
  onSaved,
}: {
  expense: Expense;
  onClose: () => void;
  onSaved: () => void;
}) {
  const net = Number(expense.netAmount);
  const alreadyPaid = Number(expense.paidAmount ?? 0);
  const remaining = net - alreadyPaid;
  const today = new Date().toISOString().split('T')[0];

  const [paidAmount, setPaidAmount] = useState(String(remaining.toFixed(2)));
  const [paymentRef, setPaymentRef] = useState('');
  const [paidAt, setPaidAt] = useState(today);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentRef.trim()) { toast.error('Payment reference is required'); return; }
    const amount = parseFloat(paidAmount);
    if (amount <= 0) { toast.error('Amount must be greater than zero'); return; }

    setSaving(true);
    try {
      await api.post(`/ap/expenses/${expense.id}/pay`, {
        paidAmount: String(amount),
        paymentRef: paymentRef.trim(),
        paidAt,
      });
      toast.success('Payment recorded.');
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vendor</span>
              <span className="font-medium text-foreground">{expense.vendor?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net Payable</span>
              <span className="font-mono text-foreground">{formatPeso(net)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Already Paid</span>
              <span className="font-mono text-foreground">{formatPeso(alreadyPaid)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <span className="text-foreground">Remaining</span>
              <span className="font-mono text-amber-600">{formatPeso(remaining)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Amount to Pay <span className="text-red-500">*</span>
            </label>
            <Input
              type="number"
              min="0.01"
              max={remaining}
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Payment Reference <span className="text-red-500">*</span>
            </label>
            <Input
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="Check #, bank ref, e-wallet TX ID"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Payment Date</label>
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className={`h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] w-full`}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Recording…' : 'Record Payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canWrite = user?.role ? WRITE_ROLES.has(user.role) : false;
  const canPostVoid = user?.role ? POST_VOID_ROLES.has(user.role) : false;

  const [page, setPage] = useState(1);
  const [vendorFilter, setVendorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | ExpenseStatus>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [expenseModal, setExpenseModal] = useState<Expense | null | 'new'>(null);
  const [payModal, setPayModal] = useState<Expense | null>(null);
  const [confirmPost, setConfirmPost] = useState<Expense | null>(null);

  // Vendors for dropdown
  const { data: vendors = [] } = useQuery<VendorOption[]>({
    queryKey: ['ap-vendors-list'],
    queryFn: () => api.get('/ap/vendors?isActive=true').then((r) => r.data),
    enabled: !!user,
  });

  const params = new URLSearchParams({ page: String(page) });
  if (vendorFilter) params.set('vendorId', vendorFilter);
  if (statusFilter) params.set('status', statusFilter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, isLoading } = useQuery<ExpenseResponse>({
    queryKey: ['ap-expenses', page, vendorFilter, statusFilter, from, to],
    queryFn: () => api.get(`/ap/expenses?${params}`).then((r) => r.data),
    enabled: !!user,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['ap-expenses'] });
  }

  const postMut = useMutation({
    mutationFn: (id: string) => api.post(`/ap/expenses/${id}/post`),
    onSuccess: () => { invalidate(); setConfirmPost(null); toast.success('Expense posted to GL.'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to post expense');
    },
  });

  const voidMut = useMutation({
    mutationFn: (id: string) => api.post(`/ap/expenses/${id}/void`),
    onSuccess: () => { invalidate(); toast.success('Expense voided.'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to void expense');
    },
  });

  const STATUS_TABS: { value: '' | ExpenseStatus; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'POSTED', label: 'Posted' },
    { value: 'VOIDED', label: 'Voided' },
  ];

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.total ?? 0} total entries
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setExpenseModal('new')} className="self-start sm:self-auto">
            <Plus className="h-4 w-4 mr-1.5" /> New Expense
          </Button>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              statusFilter === tab.value
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={vendorFilter}
          onChange={(e) => { setVendorFilter(e.target.value); setPage(1); }}
          className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] w-auto"
        >
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </div>

        {(vendorFilter || from || to) && (
          <button
            onClick={() => { setVendorFilter(''); setFrom(''); setTo(''); setPage(1); }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading expenses…</div>
      ) : (
        <>
          <div className="bg-background rounded-xl border border-border overflow-hidden">
            {!data?.data.length ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No expenses found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase">
                      <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Vendor</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Description</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Gross</th>
                      <th className="px-4 py-2.5 text-right font-semibold">WHT</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Net</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Due</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.data.map((expense) => {
                      const sc = STATUS_CONFIG[expense.status];
                      const ps = paymentStatus(expense);
                      const net = Number(expense.netAmount);
                      const paid = Number(expense.paidAmount ?? 0);
                      const isFullyPaid = paid >= net - 0.005 && expense.status === 'POSTED';

                      return (
                        <tr key={expense.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-foreground text-xs">
                            {fmtDate(expense.expenseDate)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {expense.vendor?.name ?? '—'}
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <p className="text-foreground truncate">{expense.description}</p>
                            {expense.referenceNumber && (
                              <p className="text-xs text-muted-foreground mt-0.5">Ref: {expense.referenceNumber}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-foreground text-xs">
                            {formatPeso(Number(expense.grossAmount))}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-rose-600">
                            {Number(expense.whtAmount) > 0 ? `- ${formatPeso(Number(expense.whtAmount))}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-foreground text-xs">
                            {formatPeso(Number(expense.netAmount))}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {expense.dueDate ? fmtDate(expense.dueDate) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium w-fit ${sc.cls}`}>
                                <sc.Icon className="w-3 h-3" />
                                {sc.label}
                              </span>
                              {ps.label && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium w-fit ${ps.cls}`}>
                                  {ps.label}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {expense.status === 'DRAFT' && canWrite && (
                                <>
                                  <button
                                    onClick={() => setExpenseModal(expense)}
                                    className="text-xs font-medium text-[var(--accent)] hover:underline"
                                  >
                                    Edit
                                  </button>
                                  {canPostVoid && (
                                    <button
                                      onClick={() => setConfirmPost(expense)}
                                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                      Post
                                    </button>
                                  )}
                                  {canPostVoid && (
                                    <button
                                      onClick={() => {
                                        if (confirm('Void this expense?')) voidMut.mutate(expense.id);
                                      }}
                                      disabled={voidMut.isPending}
                                      className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
                                    >
                                      Void
                                    </button>
                                  )}
                                </>
                              )}
                              {expense.status === 'POSTED' && !isFullyPaid && canWrite && (
                                <button
                                  onClick={() => setPayModal(expense)}
                                  className="text-xs font-medium text-emerald-600 hover:underline"
                                >
                                  Pay
                                </button>
                              )}
                              {expense.status === 'POSTED' && canPostVoid && (
                                <button
                                  onClick={() => {
                                    if (confirm('Void this posted expense? A reversal journal entry will be created.')) {
                                      voidMut.mutate(expense.id);
                                    }
                                  }}
                                  disabled={voidMut.isPending}
                                  className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
                                >
                                  Void
                                </button>
                              )}
                            </div>
                          </td>
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
                Page {data?.page} of {data?.pages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(data?.pages ?? 1, p + 1))}
                  disabled={page === (data?.pages ?? 1)}
                  className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Confirm Post Dialog */}
      {confirmPost && (
        <Dialog open onOpenChange={() => setConfirmPost(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Post Expense to GL?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                This will post the expense to the General Ledger and create journal entries for Accounts Payable and Withholding Tax. This action cannot be undone (only voided).
              </p>
              <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vendor</span>
                  <span className="font-medium">{confirmPost.vendor?.name ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Description</span>
                  <span className="font-medium truncate max-w-36">{confirmPost.description}</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-border pt-1">
                  <span className="text-foreground">Net Amount</span>
                  <span className="font-mono">{formatPeso(Number(confirmPost.netAmount))}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmPost(null)}>Cancel</Button>
              <Button
                onClick={() => postMut.mutate(confirmPost.id)}
                disabled={postMut.isPending}
              >
                {postMut.isPending ? 'Posting…' : 'Post to GL'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Expense Form Modal */}
      {expenseModal !== null && (
        <ExpenseModal
          expense={expenseModal === 'new' ? null : expenseModal}
          vendors={vendors}
          onClose={() => setExpenseModal(null)}
          onSaved={() => { setExpenseModal(null); invalidate(); }}
        />
      )}

      {/* Pay Modal */}
      {payModal && (
        <PayModal
          expense={payModal}
          onClose={() => setPayModal(null)}
          onSaved={() => { setPayModal(null); invalidate(); }}
        />
      )}
    </div>
  );
}
