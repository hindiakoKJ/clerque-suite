'use client';
import { useRef } from 'react';
import { Printer, Zap, LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { printer } from '@/lib/pos/printer';
import { usePrinterStore } from '@/store/pos/printer';
import { toast } from 'sonner';
import { formatPeso } from '@/lib/utils';

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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>End-of-Shift Report</span>
            <div className="flex items-center gap-2 mr-6">
              {printerConnected && (
                <button onClick={handleThermalPrint} title="Thermal print" className="text-green-500 hover:text-green-700">
                  <Zap className="h-4 w-4" />
                </button>
              )}
              <button onClick={handleBrowserPrint} className="text-gray-400 hover:text-gray-600">
                <Printer className="h-4 w-4" />
              </button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div ref={printRef} className="font-mono text-xs space-y-0.5">
            <h1 className="text-sm font-bold text-center">END-OF-SHIFT REPORT</h1>
            <p className="text-center text-gray-500 text-[10px] mb-3">
              {fmt(shift.openedAt)} → {fmt(shift.closedAt)}
            </p>

            <hr className="border-dashed border-gray-200 my-2" />

            {/* Sales summary */}
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

            {/* Payment breakdown */}
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

            {/* Top products */}
            {data.topProducts.length > 0 && (
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

          {/* Shift handover notice — shown only for terminal operators */}
          {signOutOnClose && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-200/50 dark:border-amber-800/40 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
              <LogOut className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Your shift is closed. Tap <strong>Done &amp; Sign Out</strong> so the next cashier
                can log in and start their own shift on this terminal.
              </span>
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
            <Button onClick={onClose} className="flex-1 gap-2">
              {signOutOnClose ? (
                <><LogOut className="h-4 w-4" /> Done &amp; Sign Out</>
              ) : (
                'Done'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
