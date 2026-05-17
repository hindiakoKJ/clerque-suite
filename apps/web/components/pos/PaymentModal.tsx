'use client';
import { useEffect, useState } from 'react';
import { X, ChevronDown, ChevronUp, Building2, Search, Check, Delete } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatPeso } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { PaymentMethod, InvoiceType, JwtPayload } from '@repo/shared-types';

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

/** Tabs for the segmented payment-method picker — first-class GCash & PayMaya. */
type TabKey = 'CASH' | 'GCASH' | 'PAYMAYA' | 'CARD' | 'SPLIT';

const TABS: { key: TabKey; label: string; letter: string; brand?: string }[] = [
  { key: 'CASH',    label: 'Cash · Bayad', letter: '₱' },
  { key: 'GCASH',   label: 'GCash',        letter: 'G', brand: 'var(--counter-gcash)' },
  { key: 'PAYMAYA', label: 'PayMaya',      letter: 'P', brand: 'var(--counter-paymaya)' },
  { key: 'CARD',    label: 'Card',         letter: '◧' },
  { key: 'SPLIT',   label: 'Split',        letter: '÷' },
];

function tabToMethod(tab: TabKey): PaymentMethod {
  switch (tab) {
    case 'CASH':    return 'CASH';
    case 'GCASH':   return 'GCASH_PERSONAL';
    case 'PAYMAYA': return 'MAYA_PERSONAL';
    case 'CARD':    return 'QR_PH'; // No CARD enum yet — treated as a reference-required tender
    case 'SPLIT':   return 'CASH';
  }
}

function methodToTab(m: PaymentMethod): TabKey {
  if (m === 'CASH') return 'CASH';
  if (m === 'GCASH_PERSONAL' || m === 'GCASH_BUSINESS') return 'GCASH';
  if (m === 'MAYA_PERSONAL' || m === 'MAYA_BUSINESS') return 'PAYMAYA';
  return 'CARD';
}

export function PaymentModal({ open, total, isOffline, onConfirm, onClose }: PaymentModalProps) {
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [tab, setTab] = useState<TabKey>('CASH');
  const [amountStr, setAmountStr] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showB2b, setShowB2b] = useState(false);
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('CASH_SALE');
  const [customerName, setCustomerName] = useState('');
  const [customerTin, setCustomerTin] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  const planFeatures = useAuthStore((s) => (s.user as JwtPayload | null)?.planFeatures);
  const phoneLookupEnabled = Boolean(planFeatures?.customerPhoneLookup);
  const [customerPhone, setCustomerPhone] = useState('');
  type PhoneMatch = { id: string; name: string; contactPhone: string | null };
  const [phoneMatches, setPhoneMatches] = useState<PhoneMatch[]>([]);
  const [phoneLookupOpen, setPhoneLookupOpen] = useState(false);

  const tendered = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - tendered;
  const settled = remaining <= 0;

  const cashTotal = payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
  const nonCashTotal = payments.filter((p) => p.method !== 'CASH').reduce((s, p) => s + p.amount, 0);
  const change = settled ? Math.max(0, cashTotal - (total - nonCashTotal)) : 0;

  const activeMethods = isOffline ? METHODS.filter((m) => m.value === 'CASH') : METHODS;
  const activeMethod = activeMethods.find((m) => m.value === method) ?? activeMethods[0]!;

  // For the cash keypad: live "bayad" preview is amountStr; sukli = bayad - total
  const bayadNum = parseFloat(amountStr) || 0;
  const sukli = Math.max(0, bayadNum - remaining);
  const cashShort = amountStr !== '' && bayadNum < remaining;

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setPayments([]);
      setMethod('CASH');
      setTab('CASH');
      setAmountStr('');
      setReference('');
      setError('');
      setShowB2b(false);
      setInvoiceType('CASH_SALE');
      setCustomerName('');
      setCustomerTin('');
      setCustomerAddress('');
      setCustomerPhone('');
      setPhoneMatches([]);
      setPhoneLookupOpen(false);
    }
  }, [open]);

  // Debounced phone autocomplete
  useEffect(() => {
    if (!phoneLookupEnabled || !showB2b) { setPhoneMatches([]); return; }
    const digits = customerPhone.replace(/\D/g, '');
    if (digits.length < 3) { setPhoneMatches([]); return; }
    let cancelled = false;
    const handle = setTimeout(() => {
      api.get('/customers/lookup', { params: { phone: digits } })
        .then((r) => {
          if (!cancelled) {
            setPhoneMatches((r.data ?? []) as PhoneMatch[]);
            setPhoneLookupOpen(true);
          }
        })
        .catch(() => { if (!cancelled) setPhoneMatches([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [customerPhone, phoneLookupEnabled, showB2b]);

  // Offline forces CASH/SPLIT only
  useEffect(() => {
    if (isOffline) {
      setMethod('CASH');
      setTab((t) => (t === 'SPLIT' ? 'SPLIT' : 'CASH'));
    }
  }, [isOffline]);

  function chooseTab(next: TabKey) {
    if (isOffline && next !== 'CASH' && next !== 'SPLIT') return;
    setTab(next);
    setMethod(tabToMethod(next));
    setError('');
    setAmountStr('');
    setReference('');
  }

  function addPayment(overrideMethod?: PaymentMethod, overrideAmount?: number) {
    const useMethod = overrideMethod ?? method;
    const amt = overrideAmount ?? parseFloat(amountStr);
    if (!amt || amt <= 0) { setError('Enter a valid amount.'); return; }
    const needsRef = METHODS.find((m) => m.value === useMethod)?.needsRef ?? false;
    if (needsRef && !reference.trim()) { setError('Reference number is required for this method.'); return; }
    if (amt > remaining + 0.001 && useMethod !== 'CASH') {
      setError('Non-cash amount cannot exceed the remaining balance.');
      return;
    }
    setPayments((prev) => [...prev, { method: useMethod, amount: amt, reference: reference.trim() || undefined }]);
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

  function keypadPress(ch: string) {
    setError('');
    if (ch === 'back') {
      setAmountStr((s) => s.slice(0, -1));
      return;
    }
    if (ch === '.') {
      if (amountStr.includes('.')) return;
      setAmountStr((s) => (s === '' ? '0.' : s + '.'));
      return;
    }
    // digit
    setAmountStr((s) => {
      if (s === '0') return ch;
      return s + ch;
    });
  }

  async function handleConfirm() {
    // For cash tab, allow direct confirm with the typed bayad amount
    let finalPayments = payments;
    if (tab === 'CASH' && finalPayments.length === 0 && bayadNum >= remaining && bayadNum > 0) {
      finalPayments = [{ method: 'CASH', amount: bayadNum }];
    } else if ((tab === 'GCASH' || tab === 'PAYMAYA' || tab === 'CARD') && finalPayments.length === 0) {
      if (!reference.trim()) { setError('Reference number is required.'); return; }
      finalPayments = [{ method, amount: remaining, reference: reference.trim() }];
    }

    const totalTendered = finalPayments.reduce((s, p) => s + p.amount, 0);
    if (totalTendered < total - 0.001) { setError('Total payment must cover the amount due.'); return; }

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
      await onConfirm(finalPayments, b2b);
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

  // The big CTA label varies by tab
  const ctaLabel = (() => {
    if (tab === 'CASH') {
      const amt = bayadNum > 0 ? bayadNum : 0;
      return `Confirm payment · ${formatPeso(amt || total)} received`;
    }
    if (tab === 'GCASH')   return `Confirm GCash · ${formatPeso(remaining)}`;
    if (tab === 'PAYMAYA') return `Confirm PayMaya · ${formatPeso(remaining)}`;
    if (tab === 'CARD')    return `Confirm Card · ${formatPeso(remaining)}`;
    return `Confirm split · ${formatPeso(total)}`;
  })();

  const ctaDisabled = (() => {
    if (loading) return true;
    if (tab === 'SPLIT') return !settled;
    if (tab === 'CASH') {
      if (payments.length > 0) return !settled;
      return bayadNum < remaining || bayadNum <= 0;
    }
    if (tab === 'GCASH' || tab === 'PAYMAYA' || tab === 'CARD') {
      if (payments.length > 0) return !settled;
      return !reference.trim();
    }
    return false;
  })();

  // Active tab brand colour (for accent on CTA + tab indicator)
  const tabBrand = TABS.find((t) => t.key === tab)?.brand ?? 'var(--counter-primary)';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[1100px] w-[95vw] p-0 gap-0 border-0 bg-transparent shadow-none"
        style={{ background: 'transparent' }}
      >
        {/* Full-screen Counter-style sheet */}
        <div
          className="flex flex-col rounded-2xl overflow-hidden border border-border max-h-[92vh] shadow-2xl"
        >
          {/* ── Header: back, title, total ─────────────────────────── */}
          <div className="flex items-center px-8 py-5 bg-card border-b border-border">
            <button
              onClick={handleClose}
              className="font-display text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Order
            </button>
            <div className="ml-8">
              <div className="font-display text-[20px] font-bold leading-tight">
                Tendering · {tab === 'CASH' ? 'Bayad' : TABS.find((t) => t.key === tab)?.label}
              </div>
              {isOffline && (
                <div className="text-xs text-amber-600 mt-0.5">Offline · Cash only</div>
              )}
            </div>
            <div className="ml-auto text-right">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Amount due
              </div>
              <div
                className="font-display tnum text-[44px] font-extrabold leading-none mt-1"
                style={{ color: tabBrand, letterSpacing: '-0.02em' }}
              >
                {formatPeso(total)}
              </div>
            </div>
          </div>

          {/* ── Segmented tabs ─────────────────────────────────────── */}
          <div className="flex gap-1.5 px-6 pt-3 pb-3 bg-card border-b border-border">
            {TABS.map((t) => {
              const isOn = tab === t.key;
              const disabled = isOffline && t.key !== 'CASH' && t.key !== 'SPLIT';
              const brandColor = t.brand ?? 'var(--counter-primary)';
              return (
                <button
                  key={t.key}
                  onClick={() => chooseTab(t.key)}
                  disabled={disabled}
                  className="font-display flex items-center gap-2.5 px-5 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  style={{
                    background: isOn ? brandColor : 'transparent',
                    color: isOn ? '#fff' : 'var(--muted-foreground)',
                    fontWeight: isOn ? 700 : 600,
                    minHeight: 48,
                    boxShadow: isOn ? '0 4px 12px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold"
                    style={{
                      background: isOn
                        ? 'rgba(255,255,255,0.22)'
                        : (t.brand
                          ? (t.key === 'GCASH' ? '#E1EEFE' : '#D9F4E1')
                          : 'var(--counter-primary-container)'),
                      color: isOn ? '#fff' : brandColor,
                    }}
                  >
                    {t.letter}
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* ── Body ────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-8">
            {tab === 'CASH' && (
              <CashTab
                total={remaining}
                amountStr={amountStr}
                bayadNum={bayadNum}
                sukli={sukli}
                cashShort={cashShort}
                onQuick={setQuick}
                onExact={setExact}
                onKeypad={keypadPress}
              />
            )}
            {tab === 'GCASH' && (
              <BrandTab
                brand="var(--counter-gcash)"
                brandSoft="#E1EEFE"
                brandLetter="G"
                brandName="GCash"
                amount={remaining}
                reference={reference}
                setReference={(v) => { setReference(v); setError(''); }}
              />
            )}
            {tab === 'PAYMAYA' && (
              <BrandTab
                brand="var(--counter-paymaya)"
                brandSoft="#D9F4E1"
                brandLetter="P"
                brandName="PayMaya"
                amount={remaining}
                reference={reference}
                setReference={(v) => { setReference(v); setError(''); }}
              />
            )}
            {tab === 'CARD' && (
              <CardTab
                amount={remaining}
                reference={reference}
                setReference={(v) => { setReference(v); setError(''); }}
              />
            )}
            {tab === 'SPLIT' && (
              <SplitTab
                total={total}
                remaining={remaining}
                payments={payments}
                method={method}
                setMethod={setMethod}
                amountStr={amountStr}
                setAmountStr={(v) => { setAmountStr(v); setError(''); }}
                reference={reference}
                setReference={(v) => { setReference(v); setError(''); }}
                activeMethods={activeMethods}
                methodLabel={methodLabel}
                addPayment={() => addPayment()}
                removePayment={removePayment}
                onExact={setExact}
                setExactRemaining={() => setAmountStr(Math.max(0, remaining).toFixed(2))}
                cashTotal={cashTotal}
                change={change}
                settled={settled}
              />
            )}

            {/* ── B2B / Corporate invoice (collapsible) ── */}
            <div className="mt-6 border border-border rounded-xl overflow-hidden bg-card shadow-md">
              <button
                type="button"
                onClick={() => { setShowB2b((v) => !v); setInvoiceType(!showB2b ? 'CHARGE' : 'CASH_SALE'); }}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted hover:bg-secondary transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  Corporate / B2B Invoice (optional)
                </span>
                {showB2b ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showB2b && (
                <div className="p-4 space-y-2.5 bg-white">
                  <div className="flex gap-2">
                    {(['CASH_SALE', 'CHARGE'] as InvoiceType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setInvoiceType(t)}
                        className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          invoiceType === t
                            ? 'border-transparent text-white'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                        style={invoiceType === t ? { background: 'var(--counter-primary)' } : undefined}
                      >
                        {t === 'CASH_SALE' ? 'Cash Sale' : 'On Account (Charge)'}
                      </button>
                    ))}
                  </div>

                  {phoneLookupEnabled && (
                    <div className="relative">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="tel"
                          inputMode="tel"
                          value={customerPhone}
                          onChange={(e) => { setCustomerPhone(e.target.value); setPhoneLookupOpen(true); }}
                          onFocus={() => phoneMatches.length > 0 && setPhoneLookupOpen(true)}
                          onBlur={() => setTimeout(() => setPhoneLookupOpen(false), 150)}
                          placeholder="Phone number (autocomplete)"
                          className="w-full h-10 rounded-lg border border-border bg-white text-foreground placeholder:text-muted-foreground pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--counter-primary)]"
                        />
                      </div>
                      {phoneLookupOpen && phoneMatches.length > 0 && (
                        <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-border bg-white shadow-lg text-sm">
                          {phoneMatches.map((m) => (
                            <li key={m.id}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setCustomerName(m.name);
                                  if (m.contactPhone) setCustomerPhone(m.contactPhone);
                                  setPhoneLookupOpen(false);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                              >
                                <div className="font-medium">{m.name}</div>
                                <div className="text-xs text-muted-foreground">{m.contactPhone ?? '—'}</div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <input
                    type="text" value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Business / Customer name"
                    className="w-full h-10 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--counter-primary)]"
                  />
                  <input
                    type="text" value={customerTin}
                    onChange={(e) => setCustomerTin(e.target.value)}
                    placeholder="BIR TIN (e.g. 123-456-789-000)"
                    className="w-full h-10 rounded-lg border border-border bg-white px-3 text-sm font-mono-counter tnum focus:outline-none focus:ring-2 focus:ring-[var(--counter-primary)]"
                  />
                  <input
                    type="text" value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="Registered address (required for invoices > ₱1,000)"
                    className="w-full h-10 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--counter-primary)]"
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Required per RR No. 1-2026 for invoices issued to registered businesses.
                    Leave blank for walk-in / anonymous retail sales.
                  </p>
                </div>
              )}
            </div>

            {error && (
              <p className="mt-4 text-sm text-red-600 text-center bg-red-50 border border-red-200 rounded-lg py-2">
                {error}
              </p>
            )}
          </div>

          {/* ── Footer CTA (64dp) ───────────────────────────────────── */}
          <div className="flex gap-3 px-6 py-4 bg-card border-t border-border">
            <button
              onClick={handleClose}
              disabled={loading}
              className="font-display rounded-xl px-6 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
              style={{ minHeight: 64, flex: '0 0 200px' }}
            >
              Cancel sale
            </button>
            <button
              onClick={handleConfirm}
              disabled={ctaDisabled}
              className="font-display flex-1 rounded-xl text-white text-base font-bold flex items-center justify-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-95"
              style={{
                minHeight: 64,
                background: tabBrand,
                boxShadow: tab === 'GCASH' ? '0 4px 12px rgba(0,123,252,.30)' :
                           tab === 'PAYMAYA' ? '0 4px 12px rgba(0,177,79,.30)' :
                           '0 4px 12px rgba(59,130,246,.30)',
              }}
            >
              {loading ? 'Processing…' : (
                <>
                  {ctaLabel}
                  <Check className="h-5 w-5" />
                </>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Cash tab: bayad + sukli + keypad + quick amounts ──────────────────── */
function CashTab({
  total, amountStr, bayadNum, sukli, cashShort,
  onQuick, onExact, onKeypad,
}: {
  total: number;
  amountStr: string;
  bayadNum: number;
  sukli: number;
  cashShort: boolean;
  onQuick: (n: number) => void;
  onExact: () => void;
  onKeypad: (ch: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-8">
      {/* LEFT: Bayad + Sukli cards */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-7 shadow-md">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Bayad · cash received
          </div>
          <div
            className="font-display tnum font-extrabold leading-none"
            style={{ fontSize: 60, letterSpacing: '-0.02em' }}
          >
            {formatPeso(bayadNum)}
          </div>
        </div>
        <div
          className="rounded-2xl border p-7 shadow-md"
          style={{
            background: cashShort ? '#FEF2F2' :
                        bayadNum >= total && total > 0 ? '#E8F8F0' : 'hsl(var(--card))',
            borderColor: cashShort ? '#FCA5A5' :
                         bayadNum >= total && total > 0 ? '#B5E6D2' : 'hsl(var(--border))',
          }}
        >
          <div
            className="text-[11px] font-bold uppercase tracking-wider mb-2"
            style={{
              color: cashShort ? '#991B1B' :
                     bayadNum >= total && total > 0 ? '#065F46' : 'var(--muted-foreground)',
            }}
          >
            Sukli · change
          </div>
          <div
            className="font-display tnum font-extrabold leading-none"
            style={{
              fontSize: 60, letterSpacing: '-0.02em',
              color: cashShort ? '#991B1B' :
                     bayadNum >= total && total > 0 ? '#065F46' : 'var(--foreground)',
            }}
          >
            {cashShort
              ? `− ${formatPeso(total - bayadNum)}`
              : formatPeso(sukli)}
          </div>
          {cashShort && (
            <div className="text-xs text-red-700 mt-2">Short by {formatPeso(total - bayadNum)} — keep entering.</div>
          )}
        </div>
      </div>

      {/* RIGHT: keypad + quick amounts */}
      <div className="grid grid-cols-[auto_1fr] gap-4 self-start">
        <div className="grid grid-cols-3 gap-2.5">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <Key key={n} onClick={() => onKeypad(String(n))}>{n}</Key>
          ))}
          <Key onClick={() => onKeypad('.')}>·</Key>
          <Key onClick={() => onKeypad('0')}>0</Key>
          <Key onClick={() => onKeypad('back')}><Delete className="h-5 w-5" /></Key>
        </div>
        <div
          className="flex flex-col gap-2.5 p-3.5 rounded-2xl border bg-card shadow-md"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
            Quick amounts
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {QUICK_BILLS.map((b) => (
              <button
                key={b}
                onClick={() => onQuick(b)}
                className="font-display rounded-xl bg-muted border border-border text-base font-semibold hover:bg-white dark:hover:bg-secondary hover:border-[var(--counter-primary)] hover:text-[var(--counter-primary)] shadow-sm transition-all"
                style={{ height: 60 }}
              >
                ₱{b.toLocaleString()}
              </button>
            ))}
          </div>
          <button
            onClick={onExact}
            className="font-display mt-1 rounded-xl text-sm font-semibold border-2 transition-colors hover:bg-[var(--counter-primary-container)]"
            style={{
              height: 48,
              borderColor: 'var(--counter-primary)',
              color: 'var(--counter-primary-press)',
            }}
          >
            Exact · {formatPeso(total)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Key({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="font-display rounded-xl bg-card border border-border flex items-center justify-center text-2xl font-semibold hover:border-[var(--counter-primary)] hover:text-[var(--counter-primary)] active:scale-95 shadow-sm transition-all"
      style={{ width: 84, height: 76 }}
    >
      {children}
    </button>
  );
}

/* ── Generic brand tab (GCash / PayMaya) ──────────────────────────────── */
function BrandTab({
  brand, brandSoft, brandLetter, brandName, amount, reference, setReference,
}: {
  brand: string;
  brandSoft: string;
  brandLetter: string;
  brandName: string;
  amount: number;
  reference: string;
  setReference: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1.1fr_1fr] gap-8">
      <div className="space-y-5">
        <div className="rounded-2xl border border-border bg-card shadow-md p-7">
          <div className="flex gap-4 mb-4 items-start">
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-white font-display font-extrabold text-base"
              style={{ background: brand }}
            >
              {brandLetter}
            </span>
            <div>
              <div className="font-display text-lg font-bold">Customer pays via {brandName}</div>
              <div className="text-[13px] text-muted-foreground mt-0.5">
                Show this QR or send a request. They'll get a confirmation SMS.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            {/* QR placeholder */}
            <div
              className="rounded-xl border-2 flex items-center justify-center text-muted-foreground bg-white"
              style={{ width: 220, height: 220, borderColor: 'hsl(var(--border))' }}
            >
              <div className="text-center">
                <div className="font-display text-2xl font-bold" style={{ color: brand }}>{brandName}</div>
                <div className="text-[11px] uppercase tracking-wider mt-1">QR Code</div>
              </div>
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Pay to</div>
              <div className="font-display text-xl font-bold">Your business</div>
              <div className="text-[13px] text-muted-foreground font-mono-counter tnum mt-1">via {brandName}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-md p-5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">
            {brandName} reference no. <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={reference}
            onChange={(e) => setReference(e.target.value.replace(/\D/g, ''))}
            placeholder="From the customer's confirmation SMS"
            className="font-mono-counter tnum w-full h-12 rounded-lg border border-border bg-white px-3 text-base focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)' }}
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            13 digits · printed on both copies of the receipt
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div
          className="rounded-2xl border p-7"
          style={{ background: brandSoft, borderColor: brand }}
        >
          <div
            className="text-[11px] font-bold uppercase tracking-wider mb-2"
            style={{ color: brand }}
          >
            Receive · {brandName}
          </div>
          <div
            className="font-display tnum font-extrabold leading-none"
            style={{ fontSize: 60, letterSpacing: '-0.02em', color: brand }}
          >
            {formatPeso(amount)}
          </div>
          <div className="mt-3 text-[13px] font-medium" style={{ color: brand }}>
            Exact amount only · no sukli
          </div>
        </div>
        <div className="rounded-xl p-4 text-[13px] text-muted-foreground leading-relaxed bg-secondary">
          <b className="text-foreground">Tip:</b> Wait for the customer's "Sent successfully" SMS before tapping Confirm.
        </div>
      </div>
    </div>
  );
}

/* ── Card tab ──────────────────────────────────────────────────────────── */
function CardTab({ amount, reference, setReference }: {
  amount: number;
  reference: string;
  setReference: (v: string) => void;
}) {
  const [last4, setLast4] = useState('');
  return (
    <div className="grid grid-cols-[1.1fr_1fr] gap-8">
      <div className="space-y-5">
        <div className="rounded-2xl border border-border bg-card shadow-md p-7">
          <div className="font-display text-lg font-bold mb-4">Card payment</div>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                Authorization / Reference no. <span className="text-red-500">*</span>
              </label>
              <input
                type="text" value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="From terminal slip"
                className="font-mono-counter tnum w-full h-12 rounded-lg border border-border bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--counter-primary)]"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                Last 4 digits of card
              </label>
              <input
                type="text" inputMode="numeric" maxLength={4} value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
                placeholder="0000"
                className="font-mono-counter tnum w-32 h-12 rounded-lg border border-border bg-white px-3 text-lg text-center focus:outline-none focus:ring-2 focus:ring-[var(--counter-primary)]"
              />
            </div>
          </div>
        </div>
      </div>
      <div>
        <div
          className="rounded-2xl border p-7"
          style={{ background: 'var(--counter-primary-container)', borderColor: 'var(--counter-primary)' }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--counter-primary-press)' }}>
            Charge · Card
          </div>
          <div
            className="font-display tnum font-extrabold leading-none"
            style={{ fontSize: 60, letterSpacing: '-0.02em', color: 'var(--counter-primary-press)' }}
          >
            {formatPeso(amount)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Split tab ─────────────────────────────────────────────────────────── */
function SplitTab({
  total, remaining, payments, method, setMethod, amountStr, setAmountStr,
  reference, setReference, activeMethods, methodLabel,
  addPayment, removePayment, setExactRemaining, cashTotal, change, settled,
}: {
  total: number;
  remaining: number;
  payments: PaymentEntry[];
  method: PaymentMethod;
  setMethod: (m: PaymentMethod) => void;
  amountStr: string;
  setAmountStr: (v: string) => void;
  reference: string;
  setReference: (v: string) => void;
  activeMethods: typeof METHODS;
  methodLabel: (m: PaymentMethod) => string;
  addPayment: () => void;
  removePayment: (idx: number) => void;
  onExact: () => void;
  setExactRemaining: () => void;
  cashTotal: number;
  change: number;
  settled: boolean;
}) {
  const activeMethod = activeMethods.find((m) => m.value === method) ?? activeMethods[0]!;
  return (
    <div className="grid grid-cols-[1.2fr_1fr] gap-8">
      <div className="space-y-4">
        {/* Existing payment lines */}
        <div className="rounded-2xl border border-border bg-card shadow-md p-5">
          <div className="font-display text-base font-bold mb-3">Tendered so far</div>
          {payments.length === 0 ? (
            <div className="text-sm text-muted-foreground italic py-2">No payments added yet.</div>
          ) : (
            <div className="space-y-2">
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2.5">
                  <div>
                    <span className="font-display text-sm font-semibold">{methodLabel(p.method)}</span>
                    {p.reference && <span className="text-xs text-muted-foreground ml-2 font-mono-counter tnum">#{p.reference}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-display tnum text-sm font-bold">{formatPeso(p.amount)}</span>
                    <button onClick={() => removePayment(i)} className="text-muted-foreground hover:text-red-500 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add payment composer */}
        {!settled && (
          <div className="rounded-2xl border border-border bg-card shadow-md p-5 space-y-3">
            <div className="font-display text-base font-bold">Add payment</div>
            <div className="flex flex-wrap gap-1.5">
              {activeMethods.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMethod(m.value)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                  style={method === m.value
                    ? { background: 'var(--counter-primary)', color: '#fff' }
                    : { background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="number" value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPayment()}
                placeholder="0.00"
                className="font-mono-counter tnum flex-1 h-12 rounded-lg border border-border bg-white px-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[var(--counter-primary)]"
              />
              <button
                onClick={setExactRemaining}
                className="px-4 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors whitespace-nowrap"
              >
                Exact remaining
              </button>
            </div>
            {activeMethod.needsRef && (
              <input
                type="text" value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Reference / Transaction number"
                className="font-mono-counter tnum w-full h-10 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--counter-primary)]"
              />
            )}
            <button
              onClick={addPayment}
              className="w-full py-2.5 rounded-lg border-2 text-sm font-semibold transition-colors"
              style={{ borderColor: 'var(--counter-primary)', color: 'var(--counter-primary-press)' }}
            >
              + Add {activeMethod.label} payment
            </button>
          </div>
        )}
      </div>

      {/* Running totals */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card shadow-md p-7">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Total · Bayaran</div>
          <div className="font-display tnum text-4xl font-extrabold">{formatPeso(total)}</div>
        </div>
        <div
          className="rounded-2xl border p-7"
          style={{
            background: settled ? '#E8F8F0' : 'hsl(var(--muted))',
            borderColor: settled ? '#B5E6D2' : 'hsl(var(--border))',
          }}
        >
          <div
            className="text-[11px] font-bold uppercase tracking-wider mb-2"
            style={{ color: settled ? '#065F46' : 'var(--muted-foreground)' }}
          >
            {settled ? (change > 0 ? 'Sukli · change' : 'Settled') : 'Remaining'}
          </div>
          <div
            className="font-display tnum text-5xl font-extrabold leading-none"
            style={{ color: settled ? '#065F46' : 'var(--foreground)' }}
          >
            {settled ? formatPeso(change) : formatPeso(remaining)}
          </div>
        </div>
        {cashTotal > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            Cash tendered: <span className="font-mono-counter tnum">{formatPeso(cashTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
