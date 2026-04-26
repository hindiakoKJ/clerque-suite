'use client';
import { useEffect, useState } from 'react';
import { X, ChevronDown, ChevronUp, Building2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatPeso } from '@/lib/utils';
import type { PaymentMethod, InvoiceType } from '@repo/shared-types';

export interface PaymentEntry {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

/** B2B / CHARGE invoice customer info (RR No. 1-2026) */
export interface B2bOrderInfo {
  invoiceType:      InvoiceType;
  customerName?:    string;
  customerTin?:     string;
  customerAddress?: string;
}

interface PaymentModalProps {
  open: boolean;
  total: number;
  isOffline: boolean;
  onConfirm: (payments: PaymentEntry[], b2b?: B2bOrderInfo) => Promise<void>;
  onClose: () => void;
}

const METHODS: { value: PaymentMethod; label: string; needsRef: boolean }[] = [
  { value: 'CASH',           label: 'Cash',          needsRef: false },
  { value: 'QR_PH',          label: 'QR Ph',         needsRef: true  },
  { value: 'GCASH_PERSONAL', label: 'GCash Personal', needsRef: true },
  { value: 'GCASH_BUSINESS', label: 'GCash Business', needsRef: true },
  { value: 'MAYA_PERSONAL',  label: 'Maya Personal',  needsRef: true },
  { value: 'MAYA_BUSINESS',  label: 'Maya Business',  needsRef: true },
];

const QUICK_BILLS = [20, 50, 100, 200, 500, 1000];

export function PaymentModal({ open, total, isOffline, onConfirm, onClose }: PaymentModalProps) {
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amountStr, setAmountStr] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // ── B2B / Corporate invoice fields (RR No. 1-2026) ───────────────────────────
  const [showB2b, setShowB2b] = useState(false);
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('CASH_SALE');
  const [customerName, setCustomerName] = useState('');
  const [customerTin, setCustomerTin] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  const tendered = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - tendered;
  const settled = remaining <= 0;

  // Cash over-tender for change display
  const cashTotal = payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
  const nonCashTotal = payments.filter((p) => p.method !== 'CASH').reduce((s, p) => s + p.amount, 0);
  const change = settled ? Math.max(0, cashTotal - (total - nonCashTotal)) : 0;

  const activeMethods = isOffline ? METHODS.filter((m) => m.value === 'CASH') : METHODS;
  const activeMethod = activeMethods.find((m) => m.value === method) ?? activeMethods[0]!;

  // When modal opens, reset state
  useEffect(() => {
    if (open) {
      setPayments([]);
      setMethod('CASH');
      setAmountStr('');
      setReference('');
      setError('');
      setShowB2b(false);
      setInvoiceType('CASH_SALE');
      setCustomerName('');
      setCustomerTin('');
      setCustomerAddress('');
    }
  }, [open]);

  // If offline is forced, lock to CASH
  useEffect(() => {
    if (isOffline) setMethod('CASH');
  }, [isOffline]);

  function addPayment() {
    const amt = parseFloat(amountStr);
    if (!amt || amt <= 0) { setError('Enter a valid amount.'); return; }
    if (activeMethod.needsRef && !reference.trim()) { setError('Reference number is required for this method.'); return; }
    if (amt > remaining + 0.001 && activeMethod.value !== 'CASH') {
      setError('Non-cash amount cannot exceed the remaining balance.');
      return;
    }
    setPayments((prev) => [...prev, { method, amount: amt, reference: reference.trim() || undefined }]);
    setAmountStr('');
    setReference('');
    setError('');
  }

  function removePayment(idx: number) {
    setPayments((prev) => prev.filter((_, i) => i !== idx));
  }

  function setQuick(amount: number) {
    setAmountStr(String(amount));
    setError('');
  }

  function setExact() {
    setAmountStr(Math.max(0, remaining).toFixed(2));
    setError('');
  }

  async function handleConfirm() {
    if (!settled) { setError('Total payment must cover the amount due.'); return; }
    setLoading(true);
    try {
      const b2b: B2bOrderInfo | undefined = showB2b
        ? {
            invoiceType,
            customerName:    customerName.trim() || undefined,
            customerTin:     customerTin.trim()  || undefined,
            customerAddress: customerAddress.trim() || undefined,
          }
        : undefined;
      await onConfirm(payments, b2b);
      setPayments([]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to process payment.';
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? msg);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    onClose();
  }

  const methodLabel = (m: PaymentMethod) => METHODS.find((x) => x.value === m)?.label ?? m;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 space-y-4">
          {/* Amount due + remaining */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-500/10 rounded-xl p-3 text-center">
              <p className="text-[10px] text-blue-500 dark:text-blue-400 font-semibold uppercase tracking-wide">Amount Due</p>
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-0.5">{formatPeso(total)}</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${settled ? 'bg-green-500/10' : 'bg-muted'}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-wide ${settled ? 'text-green-500 dark:text-green-400' : 'text-muted-foreground'}`}>
                {settled ? (change > 0 ? 'Change' : 'Settled') : 'Remaining'}
              </p>
              <p className={`text-2xl font-bold mt-0.5 ${settled ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                {settled ? (change > 0 ? formatPeso(change) : '—') : formatPeso(remaining)}
              </p>
            </div>
          </div>

          {/* Offline notice */}
          {isOffline && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
              Offline — Cash only. GCash/Maya available when reconnected.
            </p>
          )}

          {/* Payment lines already added */}
          {payments.length > 0 && (
            <div className="space-y-1">
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">{methodLabel(p.method)}</span>
                    {p.reference && <span className="text-xs text-muted-foreground ml-2">#{p.reference}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{formatPeso(p.amount)}</span>
                    <button onClick={() => removePayment(i)} className="text-muted-foreground hover:text-red-400 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add payment section (hidden once settled with exact cash) */}
          {!settled && (
            <div className="border border-border rounded-xl p-3 space-y-3">
              {/* Method selector */}
              <div className="flex flex-wrap gap-1.5">
                {activeMethods.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => { setMethod(m.value); setError(''); }}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      method === m.value
                        ? 'text-white'
                        : 'bg-secondary text-secondary-foreground hover:brightness-95'
                    }`}
                    style={method === m.value ? { background: 'var(--accent)' } : undefined}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Quick bills (cash only) */}
              {method === 'CASH' && (
                <div className="grid grid-cols-6 gap-1">
                  {QUICK_BILLS.map((b) => (
                    <button
                      key={b}
                      onClick={() => setQuick(b)}
                      className="py-1.5 rounded-lg border border-border text-foreground text-xs font-medium hover:bg-[var(--accent-soft)] hover:border-[var(--accent)] transition-colors"
                    >
                      ₱{b}
                    </button>
                  ))}
                </div>
              )}

              {/* Amount input */}
              <div className="flex gap-2">
                <input
                  type="number"
                  value={amountStr}
                  onChange={(e) => { setAmountStr(e.target.value); setError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && addPayment()}
                  placeholder="0.00"
                  className="flex-1 h-10 rounded-lg border border-border bg-input text-foreground px-3 text-base font-semibold placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)]"
                  autoFocus
                />
                <button
                  onClick={setExact}
                  className="px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-secondary hover:text-foreground whitespace-nowrap transition-colors"
                >
                  Exact
                </button>
              </div>

              {/* Reference (QR Ph / GCash / Maya) */}
              {activeMethod.needsRef && (
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => { setReference(e.target.value); setError(''); }}
                  placeholder="Reference / Transaction number"
                  className="w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)]"
                />
              )}

              <Button onClick={addPayment} variant="outline" size="sm" className="w-full">
                + Add {activeMethod.label} payment
              </Button>
            </div>
          )}

          {/* ── B2B / Corporate Invoice section (RR No. 1-2026) ── */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => { setShowB2b((v) => !v); setInvoiceType(!showB2b ? 'CHARGE' : 'CASH_SALE'); }}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-muted hover:bg-muted/80 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Corporate / B2B Invoice (optional)
              </span>
              {showB2b ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>

            {showB2b && (
              <div className="p-3 space-y-2 bg-background">
                {/* Invoice type toggle */}
                <div className="flex gap-2">
                  {(['CASH_SALE', 'CHARGE'] as InvoiceType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setInvoiceType(t)}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        invoiceType === t
                          ? 'border-[var(--accent)] text-white'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                      style={invoiceType === t ? { background: 'var(--accent)' } : undefined}
                    >
                      {t === 'CASH_SALE' ? 'Cash Sale' : 'On Account (Charge)'}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Business / Customer name"
                  className="w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <input
                  type="text"
                  value={customerTin}
                  onChange={(e) => setCustomerTin(e.target.value)}
                  placeholder="BIR TIN (e.g. 123-456-789-000)"
                  className="w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="Registered address (required for invoices > ₱1,000)"
                  className="w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Required per RR No. 1-2026 for invoices issued to registered businesses.
                  Leave blank for walk-in / anonymous retail sales.
                </p>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!settled || loading} className="min-w-28">
            {loading ? 'Processing…' : 'Confirm Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
