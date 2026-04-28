'use client';
import { useRef, useState } from 'react';
import { Printer, WifiOff, Zap, Ban } from 'lucide-react';
import { printer, type PrintReceiptData } from '@/lib/pos/printer';
import { usePrinterStore } from '@/store/pos/printer';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatPeso } from '@/lib/utils';
import { computeVat, round2 } from '@/lib/pos/utils';
import { api } from '@/lib/api';
import type { PaymentMethod, TaxStatus } from '@repo/shared-types';
import { getProviderPhase } from '@repo/shared-types';
import { isDemoMode } from '@/lib/demo/config';
import { useSound } from '@/hooks/pos/useSound';

/**
 * Roles allowed to void directly from the terminal (no supervisor co-auth).
 * Mirrors VOID_DIRECT_ROLES in apps/api/src/orders/orders.service.ts so the UI
 * shows the button to the right people. Backend re-validates regardless.
 */
const VOID_DIRECT_ROLES = new Set([
  'BUSINESS_OWNER',
  'BRANCH_MANAGER',
  'SALES_LEAD',
  'SUPER_ADMIN',
]);

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH:           'Cash',
  GCASH_PERSONAL: 'GCash (Personal)',
  GCASH_BUSINESS: 'GCash (Business)',
  MAYA_PERSONAL:  'Maya (Personal)',
  MAYA_BUSINESS:  'Maya (Business)',
  QR_PH:          'QR Ph',
};

interface ReceiptLineModifier {
  optionName:      string;
  priceAdjustment: number;
}

interface ReceiptLine {
  productName:    string;
  quantity:       number;
  unitPrice:      number;
  lineTotal:      number;
  discountAmount: number;
  modifiers?:     ReceiptLineModifier[];
}

export interface PaymentEntry {
  method:     PaymentMethod;
  amount:     number;
  reference?: string;
}

export interface ReceiptData {
  /** Server order id — present when the order has been posted (not offline). Used for in-receipt void. */
  orderId?:         string;
  orderNumber:      string;
  lines:            ReceiptLine[];
  subtotal:         number;
  discountAmount:   number;
  discountOnBase?:  number;
  vatExclusiveBase?: number;
  vatRelief?:       number;
  vatAmount:        number;
  totalAmount:      number;
  payments:         PaymentEntry[];
  isPwdScDiscount:  boolean;
  pwdScIdRef?:      string;
  pwdScIdOwnerName?: string;
  completedAt:      string;
  branchName?:      string;
  isOffline?:       boolean;
  // ── BIR CAS: B2B invoice fields (RR No. 1-2026 — required for CHARGE invoices) ──
  invoiceType?:       'CASH_SALE' | 'CHARGE';
  customerName?:      string;
  customerTin?:       string;
  customerAddress?:   string;
}

interface ReceiptModalProps {
  open:    boolean;
  data:    ReceiptData | null;
  onClose: () => void;
}

// ── Document title — phase-aware ─────────────────────────────────────────────
//
// Phase 1 (Internal Management): all receipts are "ACKNOWLEDGEMENT RECEIPT".
//   The business has NOT yet obtained BIR CAS accreditation + PTU. Issuing
//   an "Official Receipt" without BIR approval is a regulatory violation.
//
// Phase 2 (BIR Certified): title follows taxStatus per RR No. 1-2026.
//   VAT → "VAT OFFICIAL RECEIPT"
//   NON_VAT → "OFFICIAL RECEIPT"
//   UNREGISTERED → "ACKNOWLEDGEMENT RECEIPT" (unchanged — not applicable)

function receiptTitle(taxStatus: TaxStatus): string {
  const phase = getProviderPhase();
  if (phase === 1) return 'ACKNOWLEDGEMENT RECEIPT';
  switch (taxStatus) {
    case 'VAT':          return 'VAT OFFICIAL RECEIPT';
    case 'NON_VAT':      return 'OFFICIAL RECEIPT';
    case 'UNREGISTERED': return 'ACKNOWLEDGEMENT RECEIPT';
  }
}

// ── TIN header line per RR No. 1-2026 (Phase 2 only) ────────────────────────

function TinLine({ taxStatus, tinNumber }: { taxStatus: TaxStatus; tinNumber?: string | null }) {
  const phase = getProviderPhase();
  if (phase === 1) return null; // Pre-accreditation: no TIN on receipts
  if (taxStatus === 'UNREGISTERED' || !tinNumber) return null;
  const label = taxStatus === 'VAT' ? 'VAT REG TIN' : 'NON-VAT REG TIN';
  return (
    <p className="text-gray-500 text-[10px]">
      {label}: <span className="font-semibold text-gray-700">{tinNumber}</span>
    </p>
  );
}

// ── PTU / MIN line (Phase 2 only, when tenant has PTU) ───────────────────────

function PtuLine({
  isPtuHolder,
  ptuNumber,
  minNumber,
}: {
  isPtuHolder:  boolean;
  ptuNumber?:   string | null;
  minNumber?:   string | null;
}) {
  const phase = getProviderPhase();
  if (phase !== 2 || !isPtuHolder) return null;
  return (
    <>
      {ptuNumber && (
        <p className="text-gray-500 text-[10px]">
          PTU No.: <span className="font-semibold text-gray-700">{ptuNumber}</span>
        </p>
      )}
      {minNumber && (
        <p className="text-gray-500 text-[10px]">
          MIN: <span className="font-semibold text-gray-700">{minNumber}</span>
        </p>
      )}
    </>
  );
}

// ── BIR tax footer breakdown per RR No. 1-2026 (Phase 2 only) ───────────────

function TaxFooter({
  taxStatus,
  vatAmount,
  totalAmount,
  discountAmount,
}: {
  taxStatus:      TaxStatus;
  vatAmount:      number;
  totalAmount:    number;
  discountAmount: number;
}) {
  const phase = getProviderPhase();

  // Phase 1: show a simple "internal use" disclaimer instead of BIR breakdown
  if (phase === 1) {
    return (
      <div className="mt-2 pt-1.5 border-t border-dashed border-gray-200">
        <p className="text-[9px] text-gray-500 text-center leading-tight">
          THIS IS NOT A SALES INVOICE OR OFFICIAL RECEIPT.
        </p>
        <p className="text-[9px] text-gray-500 text-center leading-tight">
          FOR INTERNAL MANAGEMENT USE ONLY.
        </p>
      </div>
    );
  }

  // Phase 2: full BIR breakdown
  if (taxStatus === 'VAT') {
    // VATable Sales = gross amount (VAT-inclusive) less discounts
    const vatableSales    = round2(totalAmount);
    // Net of VAT (the true revenue) = VATable Sales / 1.12
    const vatExcl         = round2(totalAmount / 1.12);
    const vatOnLocalSales = round2(totalAmount - vatExcl);

    return (
      <div className="mt-2 space-y-0.5 text-[10px] text-gray-500 border-t border-dashed border-gray-200 pt-1.5">
        <div className="flex justify-between">
          <span>VATable Sales</span>
          <span>{formatPeso(vatableSales)}</span>
        </div>
        <div className="flex justify-between font-medium text-gray-700">
          <span>VAT on Local Sales (12%)</span>
          <span>{formatPeso(vatOnLocalSales > 0 ? vatOnLocalSales : vatAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span>VAT-Exempt Sales</span>
          <span>{formatPeso(0)}</span>
        </div>
        <div className="flex justify-between">
          <span>Zero-Rated Sales</span>
          <span>{formatPeso(0)}</span>
        </div>
      </div>
    );
  }

  if (taxStatus === 'NON_VAT') {
    return (
      <div className="mt-2 pt-1.5 border-t border-dashed border-gray-200">
        <p className="text-[9px] text-gray-500 text-center leading-tight">
          THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.
        </p>
      </div>
    );
  }

  // UNREGISTERED in Phase 2 — no BIR disclaimer lines
  return null;
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function ReceiptModal({ open, data, onClose }: ReceiptModalProps) {
  const printRef      = useRef<HTMLDivElement>(null);
  const printerConnected = usePrinterStore((s) => s.connected);
  const user          = useAuthStore((s) => s.user);
  const playSound     = useSound();
  const taxStatus: TaxStatus = user?.taxStatus ?? 'UNREGISTERED';
  const tinNumber             = user?.tinNumber;
  const businessName          = user?.businessName;
  const registeredAddress     = user?.registeredAddress;
  const isPtuHolder           = user?.isPtuHolder ?? false;
  const ptuNumber             = user?.ptuNumber;
  const minNumber             = user?.minNumber;

  // ── In-receipt void (role-gated) ───────────────────────────────────────────
  // Visible only when:
  //   - the order has a real server id (not offline / not LOCAL-)
  //   - the current user's role is allowed to void without supervisor co-auth
  // CASHIER and lower must use the Orders page where supervisor co-auth is collected.
  const canVoid = !!data?.orderId && !data?.isOffline &&
    !!user?.role && VOID_DIRECT_ROLES.has(user.role);
  const [voidOpen, setVoidOpen]       = useState(false);
  const [voidReason, setVoidReason]   = useState('');
  const [voidPending, setVoidPending] = useState(false);
  const [isVoided, setIsVoided]       = useState(false);

  async function handleVoid() {
    if (!data?.orderId) return;
    const reason = voidReason.trim();
    if (reason.length < 5) {
      toast.error('Please give a reason (at least 5 characters).');
      return;
    }
    setVoidPending(true);
    try {
      await api.post(`/orders/${data.orderId}/void`, { reason });
      setIsVoided(true);
      setVoidOpen(false);
      setVoidReason('');
      playSound('error');
      toast.success(`Order ${data.orderNumber} voided.`);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Void failed. Try again or use the Orders page.';
      toast.error(msg);
    } finally {
      setVoidPending(false);
    }
  }

  async function handleThermalPrint() {
    if (!data) return;
    try {
      const printData: PrintReceiptData = {
        orderNumber:      data.orderNumber,
        branchName:       data.branchName,
        completedAt:      data.completedAt,
        lines:            data.lines,
        subtotal:         data.subtotal,
        discountAmount:   data.discountAmount,
        isPwdScDiscount:  data.isPwdScDiscount,
        discountOnBase:   data.discountOnBase,
        vatExclusiveBase: data.vatExclusiveBase,
        vatRelief:        data.vatRelief,
        vatAmount:        data.vatAmount,
        totalAmount:      data.totalAmount,
        payments:         data.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })),
        isOffline:        data.isOffline,
        pwdScIdRef:       data.pwdScIdRef,
        pwdScIdOwnerName: data.pwdScIdOwnerName,
        // BIR compliance fields — read from auth store (set at login from JWT)
        taxStatus,
        tinNumber,
        businessName,
        registeredAddress,
        isPtuHolder,
        ptuNumber,
        minNumber,
        // B2B customer fields (RR No. 1-2026)
        invoiceType:     data.invoiceType,
        customerName:    data.customerName,
        customerTin:     data.customerTin,
        customerAddress: data.customerAddress,
      };
      await printer.printReceipt(printData);
      toast.success('Receipt sent to thermal printer.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Thermal print failed. Try browser print instead.');
    }
  }

  function handleBrowserPrint() {
    if (!printRef.current) return;
    const win = window.open('', '_blank', 'width=400,height=760');
    if (!win) return;
    win.document.write(`
      <html><head><title>Receipt</title>
      <style>
        body { font-family: monospace; font-size: 12px; margin: 0; padding: 16px; }
        .center { text-align: center; }
        .line { display: flex; justify-content: space-between; margin: 2px 0; }
        hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
        .bold { font-weight: bold; }
        .big { font-size: 16px; }
        .offline-badge { background:#f59e0b; color:#fff; text-align:center; padding:4px; margin-bottom:8px; font-weight:bold; }
        .bir-footer { font-size: 9px; color: #666; }
      </style></head><body>${printRef.current.innerHTML}</body></html>
    `);
    win.document.close();
    win.print();
    win.close();
  }

  if (!data) return null;

  const date       = new Date(data.completedAt);
  const cashTendered  = data.payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
  const nonCashTotal  = data.payments.filter((p) => p.method !== 'CASH').reduce((s, p) => s + p.amount, 0);
  const change        = Math.max(0, cashTendered - (data.totalAmount - nonCashTotal));
  const docTitle      = receiptTitle(taxStatus);

  return (
    <>
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{docTitle}</span>
            <div className="flex items-center gap-2 mr-6">
              {printerConnected && (
                <button onClick={handleThermalPrint} title="Send to thermal printer" className="text-green-500 hover:text-green-700 transition-colors">
                  <Zap className="h-4 w-4" />
                </button>
              )}
              <button onClick={handleBrowserPrint} title="Browser print" className="text-gray-400 hover:text-gray-600 transition-colors">
                <Printer className="h-4 w-4" />
              </button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div ref={printRef} className="font-mono text-xs space-y-1">

            {/* Demo watermark — printed AND on-screen, can't be removed */}
            {isDemoMode() && (
              <div className="demo-watermark border-2 border-dashed border-red-500 bg-red-50 text-red-700 rounded px-2 py-1.5 mb-3 text-center">
                <p className="font-extrabold tracking-widest text-[11px]">⚠ DEMO RECEIPT ⚠</p>
                <p className="text-[9px]">NOT A VALID OFFICIAL RECEIPT — sample only</p>
              </div>
            )}

            {/* Offline badge */}
            {data.isOffline && (
              <div className="offline-badge flex items-center justify-center gap-1.5 bg-amber-500 text-white rounded px-2 py-1 mb-3">
                <WifiOff className="h-3 w-3" />
                <span className="font-bold">OFFLINE ORDER — PENDING SYNC</span>
              </div>
            )}

            {/* ── Header: business info + BIR classification ── */}
            <div className="text-center space-y-0.5 mb-3">
              <p className="font-bold text-sm">{businessName ?? data.branchName ?? 'Demo Store'}</p>
              {data.branchName && businessName && (
                <p className="text-gray-500 text-[10px]">{data.branchName}</p>
              )}
              {/* TIN line per RR No. 1-2026 (Phase 2 only) */}
              <TinLine taxStatus={taxStatus} tinNumber={tinNumber} />
              {/* PTU / MIN (Phase 2 only, when tenant has PTU) */}
              <PtuLine isPtuHolder={isPtuHolder} ptuNumber={ptuNumber} minNumber={minNumber} />
              {/* Registered address (Phase 2 BIR-registered tenants) */}
              {getProviderPhase() === 2 && registeredAddress && (
                <p className="text-gray-500 text-[10px]">{registeredAddress}</p>
              )}
              {/* Document title */}
              <p className="font-semibold text-gray-700 text-[11px] uppercase tracking-wide">{docTitle}</p>
              <p className="text-gray-500">
                {date.toLocaleDateString('en-PH')}{' '}
                {date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
              </p>
              <p className="font-medium">#{data.orderNumber}</p>
            </div>

            {/* ── B2B Customer block (RR No. 1-2026 — required for CHARGE/B2B invoices) ── */}
            {(data.invoiceType === 'CHARGE' || data.customerTin) && (
              <div className="border border-dashed border-gray-300 rounded px-2 py-1.5 text-[10px] space-y-0.5">
                <p className="text-gray-400 uppercase text-[9px] tracking-wide">Bill To</p>
                {data.customerName && (
                  <p className="font-semibold text-gray-700">{data.customerName}</p>
                )}
                {data.customerTin && (
                  <p className="text-gray-500">TIN: <span className="font-medium text-gray-700">{data.customerTin}</span></p>
                )}
                {data.customerAddress && (
                  <p className="text-gray-500">{data.customerAddress}</p>
                )}
              </div>
            )}

            <hr className="border-dashed border-gray-300 my-2" />

            {/* ── Line items ── */}
            {data.lines.map((line, i) => (
              <div key={i}>
                <div className="flex justify-between">
                  <span className="flex-1 truncate">{line.productName}</span>
                  <span className="ml-2">{formatPeso(line.lineTotal)}</span>
                </div>
                {line.modifiers && line.modifiers.length > 0 && (
                  <div className="text-gray-400 pl-2 text-[10px]">
                    {line.modifiers.map((m) =>
                      m.priceAdjustment > 0
                        ? `${m.optionName} (+${formatPeso(m.priceAdjustment)})`
                        : m.optionName
                    ).join(', ')}
                  </div>
                )}
                <div className="text-gray-400 pl-2">
                  {line.quantity} × {formatPeso(line.unitPrice)}
                  {line.discountAmount > 0 && (
                    <span className="ml-2 text-red-400">-{formatPeso(line.discountAmount)}</span>
                  )}
                </div>
              </div>
            ))}

            <hr className="border-dashed border-gray-300 my-2" />

            {/* ── Totals ── */}
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatPeso(data.subtotal)}</span>
            </div>

            {/* PWD / SC discount breakdown */}
            {data.isPwdScDiscount && data.discountOnBase != null ? (
              <>
                <div className="flex justify-between text-gray-500 text-[10px]">
                  <span>{taxStatus === 'VAT' ? 'VAT-excl. base' : 'Gross base'}</span>
                  <span>{formatPeso(data.vatExclusiveBase ?? 0)}</span>
                </div>
                <div className="flex justify-between text-red-500">
                  <span>PWD/SC Discount (20%)</span>
                  <span>-{formatPeso(data.discountOnBase)}</span>
                </div>
                {taxStatus === 'VAT' && (data.vatRelief ?? 0) > 0 && (
                  <div className="flex justify-between text-red-400 text-[10px]">
                    <span>VAT relief</span>
                    <span>-{formatPeso(data.vatRelief ?? 0)}</span>
                  </div>
                )}
                {data.pwdScIdOwnerName && (
                  <div className="text-gray-400 text-[10px]">ID Holder: {data.pwdScIdOwnerName}</div>
                )}
                {data.pwdScIdRef && (
                  <div className="text-gray-400 text-[10px]">ID No.: {data.pwdScIdRef}</div>
                )}
              </>
            ) : data.discountAmount > 0 ? (
              <div className="flex justify-between text-red-500">
                <span>Discount</span>
                <span>-{formatPeso(data.discountAmount)}</span>
              </div>
            ) : null}

            {/* VAT line — only shown for VAT-registered businesses */}
            {taxStatus === 'VAT' && (
              <div className="flex justify-between text-gray-500">
                <span>VAT (12%)</span>
                <span>{formatPeso(data.vatAmount)}</span>
              </div>
            )}

            <div className="flex justify-between font-bold text-base mt-1">
              <span>TOTAL</span>
              <span>{formatPeso(data.totalAmount)}</span>
            </div>

            <hr className="border-dashed border-gray-300 my-2" />

            {/* ── Payments ── */}
            {data.payments.map((p, i) => (
              <div key={i} className="flex justify-between">
                <span>
                  {PAYMENT_LABELS[p.method]}
                  {p.reference && <span className="text-gray-400 ml-1 text-[10px]">#{p.reference}</span>}
                </span>
                <span>{formatPeso(p.amount)}</span>
              </div>
            ))}

            {change > 0 && (
              <div className="flex justify-between font-bold text-green-600">
                <span>Change</span>
                <span>{formatPeso(change)}</span>
              </div>
            )}

            {/* ── BIR-mandated footer per RR No. 1-2026 ── */}
            <TaxFooter
              taxStatus={taxStatus}
              vatAmount={data.vatAmount}
              totalAmount={data.totalAmount}
              discountAmount={data.discountAmount}
            />

            <hr className="border-dashed border-gray-300 my-2" />
            <p className="text-center text-gray-400 text-[10px]">
              {data.isOffline
                ? 'Order queued — will sync when connection is restored.'
                : 'Thank you for your purchase!'}
            </p>
          </div>

          {isVoided && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-red-100 border border-red-200 text-red-700 text-center text-sm font-semibold">
              VOIDED — keep this receipt for the audit trail.
            </div>
          )}

          <div className="flex gap-2 mt-4">
            {printerConnected ? (
              <Button onClick={handleThermalPrint} variant="outline" className="flex-1 gap-2">
                <Zap className="h-4 w-4 text-green-500" /> Thermal Print
              </Button>
            ) : (
              <Button onClick={handleBrowserPrint} variant="outline" className="flex-1 gap-2">
                <Printer className="h-4 w-4" /> Print
              </Button>
            )}
            <Button onClick={onClose} className="flex-1">New Order</Button>
          </div>

          {canVoid && !isVoided && (
            <button
              onClick={() => setVoidOpen(true)}
              className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-red-600 transition-colors py-2 inline-flex items-center justify-center gap-1.5"
            >
              <Ban className="h-3.5 w-3.5" />
              Void this order
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* Void confirmation modal — separate Dialog tree so it's not nested */}
    <Dialog open={voidOpen} onOpenChange={(v) => { if (!v && !voidPending) { setVoidOpen(false); setVoidReason(''); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Ban className="h-5 w-5" />
              Void order {data.orderNumber}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Voiding reverses the sale, restocks inventory, and is logged to the audit trail with your name and the reason below. This cannot be undone.
          </p>
          <textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Reason for void (e.g. wrong item, customer cancelled)"
            rows={3}
            maxLength={200}
            disabled={voidPending}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
          />
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => { setVoidOpen(false); setVoidReason(''); }} disabled={voidPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleVoid} disabled={voidPending || voidReason.trim().length < 5}>
              {voidPending ? 'Voiding…' : 'Confirm void'}
            </Button>
          </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
