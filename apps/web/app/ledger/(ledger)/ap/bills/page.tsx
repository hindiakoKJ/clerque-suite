'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, Plus, X, Send, Ban, DollarSign, ChevronRight, Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type BillStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'VOIDED' | 'CANCELLED';

interface Vendor { id: string; name: string; }
interface Account { id: string; code: string; name: string; type: string; }

interface BillLine {
  id?:        string;
  accountId:  string;
  account?:   { code: string; name: string };
  description?: string;
  quantity:   number;
  unitPrice:  number;
  taxAmount:  number;
  lineTotal:  number;
}

interface APBill {
  id:              string;
  billNumber:      string;
  vendorBillRef:   string | null;
  status:          BillStatus;
  billDate:        string;
  dueDate:         string;
  vendorId:        string;
  vendor:          { id: string; name: string };
  reference:       string | null;
  description:     string | null;
  whtAmount:       string;
  whtAtcCode:      string | null;
  subtotal:        string;
  vatAmount:       string;
  totalAmount:     string;
  paidAmount:      string;
  lines:           BillLine[];
  createdAt:       string;
}

interface ListResponse {
  data:     APBill[];
  total:    number;
  page:     number;
  pageSize: number;
}

interface AgingResponse {
  notDue:        number;
  bucket1_30:    number;
  bucket31_60:   number;
  bucket61_90:   number;
  bucket90plus:  number;
  total:         number;
  vendors:       { id: string; name: string; balance: number; daysPastDue: number }[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const WRITE_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT'];
const VOID_ROLES  = ['BUSINESS_OWNER', 'ACCOUNTANT'];

const INPUT_CLS =
  'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ' +
  'focus:border-transparent transition-shadow w-full';

const STATUS_BADGE: Record<BillStatus, { label: string; cls: string }> = {
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

// Common BIR ATC codes for EWT/CWT
const ATC_CODES = [
  { code: 'WC158', label: 'WC158 — Goods (1%)' },
  { code: 'WC160', label: 'WC160 — Services (2%)' },
  { code: 'WI160', label: 'WI160 — Rentals (5%)' },
  { code: 'WI010', label: 'WI010 — Professionals (10%)' },
  { code: 'WI011', label: 'WI011 — Professionals (15%)' },
];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

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

function CreateBillModal({
  vendors, accounts, onClose, onCreated,
}: {
  vendors: Vendor[];
  accounts: Account[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [vendorId, setVendorId] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const [termsDays, setTermsDays] = useState('30');
  const [vendorBillRef, setVendorBillRef] = useState('');
  const [description, setDescription] = useState('');
  const [whtAmount, setWhtAmount] = useState('0');
  const [whtAtcCode, setWhtAtcCode] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'EXPENSE'),
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
      const q = parseFloat(l.quantity)  || 0;
      const p = parseFloat(l.unitPrice) || 0;
      const t = parseFloat(l.taxAmount) || 0;
      sub   += q * p;
      vat   += t;
      total += q * p + t;
    }
    const wht = parseFloat(whtAmount) || 0;
    return { sub, vat, total, wht, netPayable: total - wht };
  }, [lines, whtAmount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) { toast.error('Pick a vendor'); return; }
    if (lines.some((l) => !l.accountId || !l.unitPrice)) {
      toast.error('Each line needs an account and unit price'); return;
    }
    setSaving(true);
    try {
      await api.post('/ap/bills', {
        vendorId,
        billDate,
        termsDays: termsDays ? parseInt(termsDays, 10) : undefined,
        vendorBillRef: vendorBillRef.trim() || undefined,
        description: description.trim() || undefined,
        whtAmount:  parseFloat(whtAmount) || 0,
        whtAtcCode: whtAtcCode || undefined,
        lines: lines.map((l) => {
          const q = parseFloat(l.quantity)  || 1;
          const p = parseFloat(l.unitPrice) || 0;
          const t = parseFloat(l.taxAmount) || 0;
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
      toast.success('Draft bill created');
      onCreated();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to create bill');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-background rounded-xl shadow-2xl border border-border w-full max-w-3xl my-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">New AP Bill</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Vendor *</label>
              <select className={INPUT_CLS} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Select vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Bill Date *</label>
              <input type="date" className={INPUT_CLS} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Terms (days)</label>
              <input type="number" className={INPUT_CLS}
                value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Vendor Bill / SI #</label>
              <input className={INPUT_CLS} value={vendorBillRef} onChange={(e) => setVendorBillRef(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
              <input className={INPUT_CLS} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <div className="col-span-2 text-xs font-medium text-amber-900">
              Withholding Tax (issue 2307 to vendor; net of WHT is what you pay out)
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">WHT Amount</label>
              <input type="number" step="0.01" className={INPUT_CLS}
                value={whtAmount} onChange={(e) => setWhtAmount(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">ATC Code</label>
              <select className={INPUT_CLS} value={whtAtcCode} onChange={(e) => setWhtAtcCode(e.target.value)}>
                <option value="">(none)</option>
                {ATC_CODES.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </div>
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
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                    <optgroup label="All accounts">
                      {accounts.filter((a) => a.type !== 'EXPENSE').map((a) => (
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
            <div className="text-muted-foreground">Total: <span className="text-foreground font-medium">{formatPeso(totals.total)}</span></div>
            <div className="text-muted-foreground">- WHT: <span className="text-foreground font-medium">{formatPeso(totals.wht)}</span></div>
            <div className="text-foreground font-semibold">Net Payable: {formatPeso(totals.netPayable)}</div>
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
  bill, onClose, onChanged, canWrite, canVoid,
}: {
  bill:      APBill;
  onClose:   () => void;
  onChanged: () => void;
  canWrite:  boolean;
  canVoid:   boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const netTotal = Number(bill.totalAmount) - Number(bill.whtAmount);
  const balance  = netTotal - Number(bill.paidAmount);

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
            <div className="text-xs text-muted-foreground">{STATUS_BADGE[bill.status].label}</div>
            <h2 className="text-lg font-semibold">{bill.billNumber}</h2>
            {bill.vendorBillRef && (
              <div className="text-xs text-muted-foreground">Vendor SI: {bill.vendorBillRef}</div>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Vendor</div>
              <div className="font-medium">{bill.vendor.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[bill.status].cls}`}>
                {STATUS_BADGE[bill.status].label}
              </span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Bill Date</div>
              <div>{fmtDate(bill.billDate)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Due Date</div>
              <div>{fmtDate(bill.dueDate)}</div>
            </div>
            {bill.description && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Description</div>
                <div>{bill.description}</div>
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
                {bill.lines.map((l, i) => (
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
              <span>Subtotal</span><span>{formatPeso(Number(bill.subtotal))}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>VAT</span><span>{formatPeso(Number(bill.vatAmount))}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Gross Total</span><span>{formatPeso(Number(bill.totalAmount))}</span>
            </div>
            {Number(bill.whtAmount) > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>WHT ({bill.whtAtcCode || 'EWT/CWT'})</span>
                <span>−{formatPeso(Number(bill.whtAmount))}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>Net Payable</span><span>{formatPeso(netTotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Paid</span><span>{formatPeso(Number(bill.paidAmount))}</span>
            </div>
            <div className="flex justify-between font-semibold text-[var(--accent)]">
              <span>Balance</span><span>{formatPeso(balance)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
            {bill.status === 'DRAFT' && canWrite && (
              <>
                <button disabled={busy} onClick={() => action('Posted', async () => {
                  await api.patch(`/ap/bills/${bill.id}/post`);
                })}
                  className="h-9 px-3 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
                  <Send className="w-4 h-4" /> Post (creates JE)
                </button>
                <button disabled={busy} onClick={() => {
                  const reason = window.prompt('Cancel reason:');
                  if (!reason) return;
                  action('Cancelled', async () => {
                    await api.post(`/ap/bills/${bill.id}/cancel`, { reason });
                  });
                }}
                  className="h-9 px-3 rounded-lg border border-border text-sm flex items-center gap-1.5 disabled:opacity-50">
                  <Ban className="w-4 h-4" /> Cancel
                </button>
              </>
            )}
            {(bill.status === 'OPEN' || bill.status === 'PARTIALLY_PAID') && canWrite && (
              <button onClick={() => setShowPay(true)}
                className="h-9 px-3 rounded-lg bg-green-600 text-white text-sm font-medium flex items-center gap-1.5">
                <DollarSign className="w-4 h-4" /> Pay Vendor
              </button>
            )}
            {(bill.status === 'OPEN' || bill.status === 'PARTIALLY_PAID') && canVoid && (
              <button disabled={busy} onClick={() => {
                const reason = window.prompt('Void reason (will reverse the JE):');
                if (!reason) return;
                action('Voided', async () => {
                  await api.post(`/ap/bills/${bill.id}/void`, { reason });
                });
              }}
                className="h-9 px-3 rounded-lg border border-red-300 text-red-700 text-sm flex items-center gap-1.5 disabled:opacity-50">
                <Ban className="w-4 h-4" /> Void
              </button>
            )}
          </div>
        </div>

        {showPay && (
          <PayBillModal
            bill={bill}
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

function PayBillModal({
  bill, balance, onClose, onSaved,
}: {
  bill:    APBill;
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
      await api.post('/ap/payments', {
        vendorId:    bill.vendorId,
        paymentDate,
        method,
        reference:   reference.trim() || undefined,
        totalAmount: amt,
        applications: [{ billId: bill.id, appliedAmount: Math.min(amt, balance) }],
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
          <h3 className="font-semibold">Pay Vendor</h3>
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
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Reference (Check#, GCash ref)</label>
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
              {saving ? 'Saving…' : 'Pay'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function APBillsPage() {
  const user = useAuthStore((s) => s.user);
  const qc   = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<BillStatus | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dueBucket, setDueBucket] = useState<'1-30' | '31-60' | '61-90' | '90+' | ''>('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<APBill | null>(null);

  const canWrite = user ? WRITE_ROLES.includes(user.role) : false;
  const canVoid  = user ? VOID_ROLES.includes(user.role)  : false;

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (overdueOnly)  params.set('onlyOverdue', 'true');
  if (dueBucket)    params.set('dueBucket', dueBucket);

  const { data: list, isLoading } = useQuery<ListResponse>({
    queryKey: ['ap-bills-list', statusFilter, overdueOnly, dueBucket],
    queryFn:  () => api.get(`/ap/bills?${params.toString()}`).then((r) => r.data),
    enabled:  !!user,
  });

  const { data: aging } = useQuery<AgingResponse>({
    queryKey: ['ap-bills-aging'],
    queryFn:  () => api.get('/ap/bills/aging').then((r) => r.data),
    enabled:  !!user,
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ['ap-vendors-list'],
    queryFn:  () => api.get('/ap/vendors').then((r) => r.data?.data ?? r.data),
    enabled:  !!user,
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts-list'],
    queryFn:  () => api.get('/accounting/accounts').then((r) => r.data),
    enabled:  !!user,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ap-bills-list'] });
    qc.invalidateQueries({ queryKey: ['ap-bills-aging'] });
    if (selected) {
      api.get(`/ap/bills/${selected.id}`).then((r) => setSelected(r.data)).catch(() => setSelected(null));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Receipt className="w-6 h-6" /> AP Bills
          </h1>
          <p className="text-sm text-muted-foreground">
            Vendor bills with WHT support — posts to GL on confirmation, issues 2307 trail.
          </p>
        </div>
        {canWrite && (
          <Link href="/ledger/ap/bills/new"
            className="h-10 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Bill
          </Link>
        )}
      </div>

      {aging && aging.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <button onClick={() => { setStatusFilter(''); setOverdueOnly(false); setDueBucket(''); }}
            className={`rounded-lg border px-3 py-2 text-left transition ${!statusFilter && !overdueOnly && !dueBucket ? 'border-foreground bg-foreground/5' : 'border-border bg-background hover:border-foreground/40'}`}>
            <div className="text-xs text-muted-foreground">Net Payable</div>
            <div className="text-base font-semibold">{formatPeso(aging.total)}</div>
          </button>
          <button onClick={() => { setStatusFilter('OPEN'); setOverdueOnly(false); setDueBucket(''); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-foreground/40 transition">
            <div className="text-xs text-muted-foreground">Not yet due</div>
            <div className="text-base font-semibold">{formatPeso(aging.notDue)}</div>
          </button>
          <button onClick={() => { setStatusFilter(''); setOverdueOnly(false); setDueBucket('1-30'); }}
            className={`rounded-lg border px-3 py-2 text-left transition ${dueBucket === '1-30' ? 'border-amber-500 bg-amber-100' : 'border-amber-200 bg-amber-50 hover:border-amber-400'}`}>
            <div className="text-xs text-amber-800">Overdue 1-30</div>
            <div className="text-base font-semibold text-amber-900">{formatPeso(aging.bucket1_30)}</div>
          </button>
          <button onClick={() => { setStatusFilter(''); setOverdueOnly(false); setDueBucket('31-60'); }}
            className={`rounded-lg border px-3 py-2 text-left transition ${dueBucket === '31-60' ? 'border-orange-500 bg-orange-100' : 'border-orange-200 bg-orange-50 hover:border-orange-400'}`}>
            <div className="text-xs text-orange-800">Overdue 31-60</div>
            <div className="text-base font-semibold text-orange-900">{formatPeso(aging.bucket31_60)}</div>
          </button>
          <button onClick={() => { setStatusFilter(''); setOverdueOnly(false); setDueBucket('61-90'); }}
            className={`rounded-lg border px-3 py-2 text-left transition ${dueBucket === '61-90' ? 'border-red-500 bg-red-100' : 'border-red-200 bg-red-50 hover:border-red-400'}`}>
            <div className="text-xs text-red-800">Overdue 61-90</div>
            <div className="text-base font-semibold text-red-900">{formatPeso(aging.bucket61_90)}</div>
          </button>
          <button onClick={() => { setStatusFilter(''); setOverdueOnly(false); setDueBucket('90+'); }}
            className={`rounded-lg border px-3 py-2 text-left transition ${dueBucket === '90+' ? 'border-red-700 bg-red-200' : 'border-red-300 bg-red-100 hover:border-red-500'}`}>
            <div className="text-xs text-red-900">Overdue 90+</div>
            <div className="text-base font-semibold text-red-900">{formatPeso(aging.bucket90plus)}</div>
          </button>
        </div>
      )}
      {(dueBucket || overdueOnly) && (
        <div className="text-xs text-muted-foreground -mt-2">
          Showing {dueBucket ? `${dueBucket} days overdue only` : 'overdue only'}.
          <button onClick={() => { setDueBucket(''); setOverdueOnly(false); }} className="ml-2 underline">Clear filter</button>
        </div>
      )}

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
              <th className="text-left px-4 py-2">Bill #</th>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Vendor</th>
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
                No bills yet. {canWrite && 'Click "New Bill" to create one.'}
              </td></tr>
            ) : (
              list!.data.map((b) => {
                const net = Number(b.totalAmount) - Number(b.whtAmount);
                const bal = net - Number(b.paidAmount);
                return (
                  <tr key={b.id}
                    onClick={() => setSelected(b)}
                    className="border-t border-border hover:bg-muted/40 cursor-pointer">
                    <td className="px-4 py-2">
                      <div className="font-medium">{b.billNumber}</div>
                      {b.vendorBillRef && <div className="text-xs text-muted-foreground">SI: {b.vendorBillRef}</div>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtDate(b.billDate)}</td>
                    <td className="px-4 py-2">{b.vendor.name}</td>
                    <td className="px-4 py-2 text-right">{formatPeso(net)}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPeso(bal)}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[b.status].cls}`}>
                        {STATUS_BADGE[b.status].label}
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
        <CreateBillModal
          vendors={vendors}
          accounts={accounts}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refresh(); }}
        />
      )}

      {selected && (
        <DetailDrawer
          bill={selected}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          canWrite={canWrite}
          canVoid={canVoid}
        />
      )}
    </div>
  );
}
