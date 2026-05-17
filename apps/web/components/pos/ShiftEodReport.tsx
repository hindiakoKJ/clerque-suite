'use client';
import { useRef } from 'react';
import { Printer, Zap, LogOut } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { printer } from '@/lib/pos/printer';
import { usePrinterStore } from '@/store/pos/printer';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';
import { formatPeso } from '@/lib/utils';

// Roles that operate the till — they see ONLY cash movements at end of shift,
// not total revenue or top products. Owners/managers see the full report.
// (Sensitive business data — revenue, average ticket, top products — should
//  not surface to the cashier; this is a Segregation-of-Duties boundary.)
const CASHIER_ONLY_ROLES = new Set(['CASHIER', 'SALES_LEAD']);

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  GCASH_PERSONAL: 'GCash (Personal)',
  GCASH_BUSINESS: 'GCash (Business)',
  MAYA_PERSONAL: 'Maya (Personal)',
  MAYA_BUSINESS: 'Maya (Business)',
  QR_PH: 'QR Ph',
};

interface PaymentBreakdown { method: string; totalAmount: number; orderCount: number; }
interface TopProduct { productName: string; quantitySold: number; revenue: number; }

export interface ShiftReportData {
  shift: {
    id: string;
    openedAt: string;
    closedAt: string | null;
    openingCash: number;
    closingCashDeclared: number | null;
    closingCashExpected: number | null;
    variance: number | null;
    notes: string | null;
    /** Terminal this shift opened on. Null for legacy shifts. */
    terminal?: { id: string; name: string; code: string } | null;
  };
  totalOrders: number;
  voidCount: number;
  totalRevenue: number;
  avgOrderValue: number;
  cashRevenue: number;
  nonCashRevenue: number;
  byPaymentMethod: PaymentBreakdown[];
  topProducts: TopProduct[];
  /** Cash-out events on this shift (paid-outs + cash drops). */
  cashOuts?: Array<{
    id: string;
    type: 'PAID_OUT' | 'CASH_DROP';
    amount: number;
    reason: string;
    category?: string | null;
    createdAt: string;
  }>;
  paidOutTotal?: number;
  cashDropTotal?: number;
}

interface ShiftEodReportProps {
  open: boolean;
  data: ShiftReportData;
  onClose: () => void;
  /** When true, the "Done" button becomes "Done & Sign Out" and shows a handover notice. */
  signOutOnClose?: boolean;
}

function fmt(date: string | null | undefined) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function ShiftEodReport({ open, data, onClose, signOutOnClose = false }: ShiftEodReportProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const printerConnected = usePrinterStore((s) => s.connected);

  async function handleThermalPrint() {
    try {
      await printer.printShiftReport(data);
      toast.success('Shift report sent to thermal printer.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Thermal print failed.';
      toast.error(msg);
    }
  }

  function handleBrowserPrint() {
    if (!printRef.current) return;
    const win = window.open('', '_blank', 'width=480,height=700');
    if (!win) return;
    win.document.write(`<html><head><title>Shift EOD Report</title>
      <style>
        body{font-family:monospace;font-size:12px;margin:0;padding:16px}
        h1{font-size:15px;text-align:center;margin:0 0 4px}
        .sub{text-align:center;color:#666;margin-bottom:12px}
        table{width:100%;border-collapse:collapse;margin:8px 0}
        td,th{padding:3px 6px;text-align:left}
        th{font-weight:bold;border-bottom:1px solid #000}
        .r{text-align:right}
        hr{border:none;border-top:1px dashed #000;margin:10px 0}
        .big{font-size:18px;font-weight:bold}
        .row{display:flex;justify-content:space-between;margin:3px 0}
        .green{color:#166534}.red{color:#991b1b}
      </style></head><body>${printRef.current.innerHTML}</body></html>`);
    win.document.close();
    win.print();
    win.close();
  }

  const { shift } = data;
  const variance = shift.variance ?? 0;
  const userRole = useAuthStore((s) => s.user?.role);
  const userName = useAuthStore((s) => s.user?.name);
  // Cashier view = no revenue, no top products. Manager/owner = full report.
  const isCashierView = userRole != null && CASHIER_ONLY_ROLES.has(userRole);
  // Sprint 3 — prefer the real terminal name (POS-01, POS-02, ...) when set.
  // Falls back to the legacy "POS-XXXX" shift-id label for older shifts.
  const terminalLabel = shift.terminal?.name ?? `POS-${shift.id.slice(-4).toUpperCase()}`;

  // ── Hero numbers for Counter Z-read design ─────────────────────────────
  const grossSales = data.totalRevenue;
  const netSales = grossSales; // best-available proxy when no discount field present
  const expectedDrawer = shift.closingCashExpected
    ?? (shift.openingCash + data.cashRevenue - (data.paidOutTotal ?? 0) - (data.cashDropTotal ?? 0));
  const declared = shift.closingCashDeclared;
  const absVar = Math.abs(variance);
  const varTone =
    declared == null ? 'neutral' :
    absVar < 0.01 ? 'success' :
    absVar <= 100 ? 'warning' : 'error';

  // Tender breakdown with brand colour mapping
  const BRAND_MAP: Record<string, string> = {
    CASH: 'var(--counter-primary)',
    GCASH_PERSONAL: 'var(--counter-gcash)',
    GCASH_BUSINESS: 'var(--counter-gcash)',
    MAYA_PERSONAL: 'var(--counter-paymaya)',
    MAYA_BUSINESS: 'var(--counter-paymaya)',
    QR_PH: 'var(--muted-foreground, #6b6760)',
  };
  const tenderTotal = data.byPaymentMethod.reduce((s, p) => s + p.totalAmount, 0) || 1;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-[1100px] w-[95vw] p-0 gap-0 border-0 bg-transparent shadow-none"
        style={{ background: 'transparent' }}
      >
        <div
          className="flex flex-col rounded-2xl overflow-hidden border border-border max-h-[92vh] shadow-2xl"
          style={{ background: 'hsl(var(--muted))' }}
        >
          {/* Counter-styled header */}
          <div className="flex items-center px-8 py-5 bg-card border-b border-border">
            <div>
              <div className="font-display text-[22px] font-bold leading-tight">
                Close shift · Z-read
              </div>
              <div className="text-[13px] text-muted-foreground mt-0.5">
                {terminalLabel}{userName ? ` · ${userName}` : ''} · {fmt(shift.openedAt)} → {fmt(shift.closedAt)}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {printerConnected && (
                <button onClick={handleThermalPrint} title="Thermal print" className="text-green-500 hover:text-green-700 p-2">
                  <Zap className="h-4 w-4" />
                </button>
              )}
              <button onClick={handleBrowserPrint} className="text-muted-foreground hover:text-foreground p-2">
                <Printer className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Counter-styled body */}
          <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6">
            <div className="space-y-4">
              {/* Hero: Gross / Net sales */}
              {!isCashierView && (
                <div className="rounded-2xl border border-border bg-card shadow-md p-7">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Gross sales</div>
                      <div className="font-display tnum font-extrabold leading-none mt-1" style={{ fontSize: 48, letterSpacing: '-0.02em', color: 'var(--counter-primary)' }}>
                        {formatPeso(grossSales)}
                      </div>
                      <div className="text-[13px] text-muted-foreground mt-1.5">
                        {data.totalOrders} transactions · avg <span className="tnum">{formatPeso(data.avgOrderValue)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Net sales</div>
                      <div className="font-display tnum font-bold mt-1" style={{ fontSize: 32, color: '#065F46' }}>
                        {formatPeso(netSales)}
                      </div>
                      <div className="text-[13px] text-muted-foreground mt-0.5">after discounts</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tender breakdown with brand-tinted bars */}
              {!isCashierView && data.byPaymentMethod.length > 0 && (
                <div className="rounded-2xl border border-border bg-card shadow-md p-6">
                  <div className="font-display text-sm font-bold mb-3">By tender</div>
                  {data.byPaymentMethod.map((p) => {
                    const pct = (p.totalAmount / tenderTotal) * 100;
                    const color = BRAND_MAP[p.method] ?? 'var(--counter-primary)';
                    return (
                      <div key={p.method} className="py-2.5 border-b border-border last:border-0">
                        <div className="flex items-baseline justify-between">
                          <span className="font-display text-sm font-semibold">{METHOD_LABELS[p.method] ?? p.method}</span>
                          <span className="font-display tnum text-base font-bold">{formatPeso(p.totalAmount)}</span>
                        </div>
                        <div className="flex items-center gap-2.5 mt-1.5">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-secondary">
                            <div className="h-full" style={{ background: color, width: `${pct}%` }} />
                          </div>
                          <span className="font-mono-counter tnum text-[11px] text-muted-foreground" style={{ minWidth: 90, textAlign: 'right' }}>
                            {p.orderCount} txn · {pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Voids + cash-out summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-border bg-card shadow-md p-5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Voids · refunds</div>
                  <div className="text-sm space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Voided</span>
                      <span className="font-mono-counter tnum">{data.voidCount}</span>
                    </div>
                    {data.paidOutTotal != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Paid-outs</span>
                        <span className="font-mono-counter tnum">{formatPeso(data.paidOutTotal)}</span>
                      </div>
                    )}
                    {data.cashDropTotal != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cash drops</span>
                        <span className="font-mono-counter tnum">{formatPeso(data.cashDropTotal)}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-card shadow-md p-5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Shift activity</div>
                  <div className="text-sm space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total orders</span>
                      <span className="font-mono-counter tnum">{data.totalOrders}</span>
                    </div>
                    {!isCashierView && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Avg ticket</span>
                        <span className="font-mono-counter tnum">{formatPeso(data.avgOrderValue)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: cash reconciliation + variance */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card shadow-md p-6">
                <div className="font-display text-sm font-bold">Cash drawer · reconciliation</div>
                <div className="text-[13px] text-muted-foreground mb-3">Count physical cash, enter below.</div>
                <div className="text-sm space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Opening float</span>
                    <span className="font-mono-counter tnum">{formatPeso(shift.openingCash)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">+ Cash sales</span>
                    <span className="font-mono-counter tnum">{formatPeso(data.cashRevenue)}</span>
                  </div>
                  {data.paidOutTotal != null && data.paidOutTotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">− Paid-outs</span>
                      <span className="font-mono-counter tnum">{formatPeso(data.paidOutTotal)}</span>
                    </div>
                  )}
                  {data.cashDropTotal != null && data.cashDropTotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">− Cash drops</span>
                      <span className="font-mono-counter tnum">{formatPeso(data.cashDropTotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-display font-bold text-base pt-2 mt-1 border-t border-border">
                    <span>Expected in drawer</span>
                    <span className="tnum">{formatPeso(expectedDrawer)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Declared</span>
                    <span className="font-mono-counter tnum">{declared != null ? formatPeso(declared) : '—'}</span>
                  </div>
                </div>
                {declared != null && (
                  <div
                    className="mt-4 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-between"
                    style={
                      varTone === 'success' ? { background: '#E8F8F0', color: '#065F46' } :
                      varTone === 'warning' ? { background: '#FEF3C7', color: '#92400E' } :
                                              { background: '#FEE2E2', color: '#991B1B' }
                    }
                  >
                    <span>Variance</span>
                    <span className="font-mono-counter tnum">
                      {absVar < 0.01 ? 'Balanced'
                        : variance > 0 ? `+${formatPeso(variance)} overage`
                        : `−${formatPeso(absVar)} shortage`}
                    </span>
                  </div>
                )}
              </div>

              {shift.notes && (
                <div className="rounded-2xl border border-border bg-card shadow-md p-5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Notes</div>
                  <p className="text-sm text-foreground">{shift.notes}</p>
                </div>
              )}

              {signOutOnClose && (
                <div className="rounded-xl px-4 py-3 text-[12px] leading-relaxed flex items-start gap-2" style={{ background: '#FEF3C7', color: '#92400E' }}>
                  <LogOut className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Your shift is closed. Tap <strong>Done &amp; Sign Out</strong> so the next cashier
                    can log in and start their own shift on this terminal.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Counter footer CTAs */}
          <div className="flex gap-3 px-6 py-4 bg-card border-t border-border">
            <Button onClick={onClose} variant="ghost" className="font-display" style={{ minHeight: 48 }}>
              Save &amp; continue
            </Button>
            <button
              onClick={printerConnected ? handleThermalPrint : handleBrowserPrint}
              className="font-display ml-auto rounded-xl px-6 text-sm font-semibold border-2 flex items-center gap-2 transition-colors hover:bg-[var(--counter-primary-container)]"
              style={{
                minHeight: 64,
                borderColor: 'var(--counter-primary)',
                color: 'var(--counter-primary-press)',
              }}
            >
              <Printer className="h-4 w-4" />
              Print Z-read
            </button>
            <button
              onClick={onClose}
              className="font-display rounded-xl text-white text-base font-bold flex items-center justify-center gap-3 transition-opacity hover:opacity-95"
              style={{
                minHeight: 64,
                flex: '0 0 320px',
                background: 'var(--counter-primary)',
                boxShadow: '0 4px 12px rgba(59,130,246,.30)',
              }}
            >
              {signOutOnClose ? (<><LogOut className="h-4 w-4" /> Close shift &amp; sign out</>) : 'Done'}
            </button>
          </div>

          {/* Hidden print body (kept for browser print) */}
          <div className="hidden">
            <div ref={printRef} className="font-mono text-xs space-y-0.5">
            <h1 className="text-sm font-bold text-center">END-OF-SHIFT REPORT</h1>
            <p className="text-center text-gray-500 text-[10px]">{terminalLabel}{userName ? ` · ${userName}` : ''}</p>
            <p className="text-center text-gray-500 text-[10px] mb-3">
              {fmt(shift.openedAt)} → {fmt(shift.closedAt)}
            </p>

            <hr className="border-dashed border-gray-200 my-2" />

            {/* ── Sales summary (manager/owner view only) ──────────────────────── */}
            {!isCashierView && (
              <>
                <p className="font-bold text-[11px] uppercase text-gray-500 tracking-wide mb-1">Sales Summary</p>
                <div className="space-y-1">
                  {[
                    ['Total Orders', data.totalOrders],
                    ['Void / Cancelled', data.voidCount],
                    ['Avg. Order Value', formatPeso(data.avgOrderValue)],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex justify-between text-xs">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold text-sm mt-1 pt-1 border-t border-gray-100">
                    <span>Total Revenue</span>
                    <span style={{ color: 'var(--accent)' }}>{formatPeso(data.totalRevenue)}</span>
                  </div>
                </div>

                <hr className="border-dashed border-gray-200 my-3" />

                {/* Full payment breakdown — owner/manager see all methods + amounts */}
                <p className="font-bold text-[11px] uppercase text-gray-500 tracking-wide mb-1">Payment Methods</p>
                <div className="space-y-1">
                  {data.byPaymentMethod.map((p) => (
                    <div key={p.method} className="flex justify-between text-xs">
                      <span className="text-gray-500">{METHOD_LABELS[p.method] ?? p.method}</span>
                      <span className="font-medium">{formatPeso(p.totalAmount)}</span>
                    </div>
                  ))}
                </div>

                <hr className="border-dashed border-gray-200 my-3" />
              </>
            )}

            {/* Cashier view counts only — the front-of-house operational numbers
                they need to balance their drawer (no revenue exposure). */}
            {isCashierView && (
              <>
                <p className="font-bold text-[11px] uppercase text-gray-500 tracking-wide mb-1">Shift Activity</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Total Orders</span>
                    <span className="font-medium">{data.totalOrders}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Voids / Cancelled</span>
                    <span className="font-medium">{data.voidCount}</span>
                  </div>
                </div>
                <hr className="border-dashed border-gray-200 my-3" />
              </>
            )}

            {/* Cash-outs (paid-outs + drops) — shown before reconciliation */}
            {data.cashOuts && data.cashOuts.length > 0 && (
              <>
                <p className="font-bold text-[11px] uppercase text-gray-500 tracking-wide mb-1">Cash Out During Shift</p>
                <ul className="space-y-1 mb-3">
                  {data.cashOuts.map((c) => (
                    <li key={c.id} className="flex justify-between text-xs">
                      <span className="text-gray-600 truncate pr-2">
                        <span className={`font-mono text-[9px] uppercase mr-1 ${c.type === 'PAID_OUT' ? 'text-amber-700' : 'text-blue-700'}`}>
                          {c.type === 'PAID_OUT' ? 'Paid' : 'Drop'}
                        </span>
                        {c.reason}
                      </span>
                      <span className="text-gray-700">−{formatPeso(c.amount)}</span>
                    </li>
                  ))}
                </ul>
                <hr className="border-dashed border-gray-200 my-3" />
              </>
            )}

            {/* Cash reconciliation */}
            <p className="font-bold text-[11px] uppercase text-gray-500 tracking-wide mb-1">Cash Reconciliation</p>
            <div className="space-y-1">
              {[
                ['Opening Cash', shift.openingCash],
                ['+ Cash Sales', data.cashRevenue],
                ...(data.paidOutTotal && data.paidOutTotal > 0 ? [['− Paid-outs', -data.paidOutTotal] as const] : []),
                ...(data.cashDropTotal && data.cashDropTotal > 0 ? [['− Cash drops', -data.cashDropTotal] as const] : []),
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between text-xs">
                  <span className="text-gray-500">{label}</span>
                  <span className={Number(value) < 0 ? 'text-amber-700' : ''}>
                    {Number(value) < 0 ? '−' : ''}{formatPeso(Math.abs(Number(value)))}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-xs font-semibold pt-1 border-t border-gray-100">
                <span>Expected in Drawer</span>
                <span>{formatPeso(
                  shift.closingCashExpected
                    ?? (shift.openingCash + data.cashRevenue - (data.paidOutTotal ?? 0) - (data.cashDropTotal ?? 0))
                )}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Declared</span>
                <span>{shift.closingCashDeclared != null ? formatPeso(shift.closingCashDeclared) : '—'}</span>
              </div>
              {shift.closingCashDeclared != null && (
                <div className={`flex justify-between text-xs font-bold ${variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-500' : 'text-gray-600'}`}>
                  <span>Variance</span>
                  <span>
                    {variance === 0 ? 'Balanced' : variance > 0
                      ? `+${formatPeso(variance)} overage`
                      : `${formatPeso(variance)} shortage`}
                  </span>
                </div>
              )}
            </div>

            {/* Top products — manager/owner view only (cashier doesn't see revenue) */}
            {!isCashierView && data.topProducts.length > 0 && (
              <>
                <hr className="border-dashed border-gray-200 my-3" />
                <p className="font-bold text-[11px] uppercase text-gray-500 tracking-wide mb-1">Top Products</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-0.5 font-medium text-gray-500">Product</th>
                      <th className="text-right py-0.5 font-medium text-gray-500">Qty</th>
                      <th className="text-right py-0.5 font-medium text-gray-500">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.slice(0, 5).map((p, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-0.5 truncate max-w-[140px]">{p.productName}</td>
                        <td className="text-right py-0.5">{p.quantitySold}</td>
                        <td className="text-right py-0.5">{formatPeso(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {shift.notes && (
              <>
                <hr className="border-dashed border-gray-200 my-3" />
                <p className="text-[10px] text-gray-400">Notes: {shift.notes}</p>
              </>
            )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
