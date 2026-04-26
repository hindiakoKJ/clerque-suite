'use client';
import { useState } from 'react';

const METHOD_LABELS: Record<string, string> = {
  QR_PH:          'QR Ph',
  GCASH_PERSONAL: 'GCash Personal',
  GCASH_BUSINESS: 'GCash Business',
  MAYA_PERSONAL:  'Maya Personal',
  MAYA_BUSINESS:  'Maya Business',
};
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatPeso } from '@/lib/utils';
import type { ActiveShift } from '@/store/pos/shift';

interface CloseShiftModalProps {
  open: boolean;
  shift: ActiveShift;
  onClose: () => void;
  onConfirm: (closingCashDeclared: number, notes?: string) => Promise<void>;
}

export function CloseShiftModal({ open, shift, onClose, onConfirm }: CloseShiftModalProps) {
  const [declaredStr, setDeclaredStr] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const declared = parseFloat(declaredStr) || 0;
  const variance = declared > 0 ? declared - shift.expectedCash : null;

  function varianceLabel() {
    if (variance === null) return null;
    if (Math.abs(variance) < 0.01) return { icon: <Minus className="h-4 w-4" />, color: 'text-gray-600', label: 'Balanced' };
    if (variance > 0) return { icon: <TrendingUp className="h-4 w-4" />, color: 'text-green-600', label: `Overage ${formatPeso(variance)}` };
    return { icon: <TrendingDown className="h-4 w-4" />, color: 'text-red-500', label: `Shortage ${formatPeso(Math.abs(variance))}` };
  }

  const vMeta = varianceLabel();

  async function handleConfirm() {
    if (declared < 0) { setError('Declared cash cannot be negative.'); return; }
    setLoading(true);
    try {
      await onConfirm(declared, notes || undefined);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to close shift.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={loading ? undefined : onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close Shift</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 space-y-4">
          {/* Shift summary */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-muted-foreground uppercase tracking-wide font-semibold">Orders</p>
              <p className="text-lg font-bold text-foreground mt-0.5">{shift.orderCount}</p>
            </div>
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-muted-foreground uppercase tracking-wide font-semibold">Total Sales</p>
              <p className="text-lg font-bold text-foreground mt-0.5">{formatPeso(shift.totalSales)}</p>
            </div>
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-muted-foreground uppercase tracking-wide font-semibold">Cash Sales</p>
              <p className="text-lg font-bold text-foreground mt-0.5">{formatPeso(shift.cashSales)}</p>
            </div>
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-muted-foreground uppercase tracking-wide font-semibold">Digital</p>
              <p className="text-lg font-bold text-foreground mt-0.5">{formatPeso(shift.nonCashSales)}</p>
            </div>
          </div>

          {/* Digital payment breakdown — only shown when there are non-cash payments */}
          {shift.nonCashSales > 0 && (
            <div className="rounded-xl border border-border p-3 space-y-1.5 text-sm">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Digital breakdown — verify against your apps
              </p>
              {Object.entries(shift.digitalBreakdown ?? {}).map(([method, amount]) => (
                <div key={method} className="flex justify-between">
                  <span className="text-muted-foreground">{METHOD_LABELS[method] ?? method}</span>
                  <span className="font-semibold text-foreground">{formatPeso(amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-1.5 font-bold text-foreground">
                <span>Total digital</span>
                <span>{formatPeso(shift.nonCashSales)}</span>
              </div>
            </div>
          )}

          {/* Expected cash calculation */}
          <div className="rounded-xl p-3 space-y-1.5 text-sm bg-[var(--accent-soft)]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Opening cash</span>
              <span className="font-medium text-foreground">{formatPeso(shift.openingCash)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">+ Cash sales (net)</span>
              <span className="font-medium text-foreground">{formatPeso(shift.cashSales)}</span>
            </div>
            <div className="flex justify-between border-t border-[var(--accent)]/20 pt-1.5 font-bold" style={{ color: 'var(--accent)' }}>
              <span>Expected in drawer</span>
              <span>{formatPeso(shift.expectedCash)}</span>
            </div>
          </div>

          {/* Actual cash declared */}
          <div>
            <label className="text-xs text-muted-foreground font-medium">Actual cash in drawer (₱)</label>
            <input
              type="number"
              value={declaredStr}
              onChange={(e) => { setDeclaredStr(e.target.value); setError(''); }}
              placeholder="0.00"
              className="mt-1 w-full h-12 rounded-lg border border-border bg-input text-foreground px-3 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              autoFocus
            />
          </div>

          {/* Variance indicator */}
          {vMeta && (
            <div className={`flex items-center justify-between rounded-xl p-3 bg-muted ${vMeta.color}`}>
              <div className="flex items-center gap-2">
                {vMeta.icon}
                <span className="text-sm font-semibold">Variance</span>
              </div>
              <span className="font-bold">{vMeta.label}</span>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-muted-foreground font-medium">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any remarks…"
              className="mt-1 w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={!declaredStr || loading}
            variant="destructive"
            className="min-w-32"
          >
            {loading ? 'Closing…' : 'Close Shift'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
