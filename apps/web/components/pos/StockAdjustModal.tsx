'use client';
import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

type AdjustType = 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT';

/**
 * Each reason carries the code the API actually validates.
 *
 * The modal used to send only the human label, so every STOCK_OUT was
 * rejected: the service requires a reasonCode from a fixed enum on any
 * negative adjustment. Spoilage, breakage and theft could not be recorded at
 * all, which quietly inflates on-hand counts and understates COGS.
 */
const REASONS: Record<AdjustType, Array<{ code: string; label: string }>> = {
  STOCK_IN: [
    { code: 'OTHER',            label: 'Delivery received' },
    { code: 'OTHER',            label: 'Transfer in' },
    { code: 'OTHER',            label: 'Returned to stock' },
    { code: 'COUNT_CORRECTION', label: 'Initial count' },
    { code: 'OTHER',            label: 'Other' },
  ],
  STOCK_OUT: [
    { code: 'DAMAGE',        label: 'Damaged / spoiled' },
    { code: 'EXPIRY',        label: 'Expired' },
    { code: 'OTHER',         label: 'Transfer out' },
    { code: 'THEFT',         label: 'Theft / loss' },
    { code: 'SAMPLE',        label: 'Sample / tasting' },
    { code: 'INTERNAL_USE',  label: 'Staff / internal use' },
    { code: 'PROMO_GIVEAWAY', label: 'Giveaway / promo' },
    { code: 'OTHER',         label: 'Other' },
  ],
  ADJUSTMENT: [
    { code: 'COUNT_CORRECTION', label: 'Physical count correction' },
    { code: 'OTHER',            label: 'System error correction' },
    { code: 'OTHER',            label: 'Other' },
  ],
};

/** The label shown in the dropdown -> the enum the API expects. */
function reasonCodeFor(direction: AdjustType, label: string): string {
  return REASONS[direction].find((r) => r.label === label)?.code ?? 'OTHER';
}

interface StockAdjustModalProps {
  open: boolean;
  productId: string;
  productName: string;
  currentQty: number;
  branchId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function StockAdjustModal({
  open,
  productId,
  productName,
  currentQty,
  branchId,
  onClose,
  onSuccess,
}: StockAdjustModalProps) {
  const [direction, setDirection] = useState<AdjustType>('STOCK_IN');
  const [qtyStr, setQtyStr] = useState('');
  const [unitCostStr, setUnitCostStr] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'OWNER_FUNDED'>('CASH');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [supervisorPin, setSupervisorPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const qty = parseFloat(qtyStr) || 0;
  const delta = direction === 'STOCK_OUT' ? -qty : qty;
  const newQty = currentQty + delta;
  // Removing stock is a write-off and needs a supervisor to stand behind it.
  const isNegative = direction === 'STOCK_OUT' || delta < 0;
  const canSubmit = qty > 0 && !!reason && (!isNegative || /^\d{4,6}$/.test(supervisorPin.trim()));

  async function handleSubmit() {
    if (qty <= 0 || !reason) { setError('Enter a quantity and select a reason.'); return; }
    if (isNegative && !/^\d{4,6}$/.test(supervisorPin.trim())) {
      setError('A supervisor PIN (4-6 digits) is required to remove stock.');
      return;
    }
    if (newQty < 0) { setError('Stock cannot go below zero.'); return; }
    setLoading(true);
    try {
      const unitCost = parseFloat(unitCostStr);
      await api.post('/inventory/adjust', {
        productId,
        branchId,
        quantity: delta,
        type: direction,
        reason,
        // The API validates the CODE, not the label — a negative adjustment
        // without one is rejected outright.
        reasonCode: reasonCodeFor(direction, reason),
        // Removing stock is a write-off, so it needs a supervisor's PIN. The
        // service bcrypt-verifies it against an authorised attester.
        supervisorPin: isNegative ? supervisorPin.trim() : undefined,
        note: note || undefined,
        // Only send unitCost on positive-qty receipts (STOCK_IN)
        unitCost: direction === 'STOCK_IN' && qty > 0 && !isNaN(unitCost) && unitCost >= 0
          ? unitCost
          : undefined,
        // Only send paymentMethod on stock-in — tells the ledger whether the
        // purchase was paid from cash on hand or funded by the owner.
        paymentMethod: direction === 'STOCK_IN' ? paymentMethod : undefined,
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to adjust stock.',
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setQtyStr(''); setUnitCostStr(''); setPaymentMethod('CASH'); setReason(''); setNote(''); setError('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust Stock</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 space-y-4">
          <p className="text-sm font-medium text-foreground truncate">{productName}</p>

          {/* Current / new qty display */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-muted rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Current</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">{currentQty}</p>
            </div>
            <div className={`rounded-xl p-3 ${newQty < 0 ? 'bg-red-500/10' : qty > 0 ? 'bg-[var(--accent-soft)]' : 'bg-muted'}`}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">After</p>
              <p className={`text-2xl font-bold mt-0.5 ${newQty < 0 ? 'text-red-500' : qty > 0 ? 'text-[var(--accent)]' : 'text-foreground'}`}>
                {qty > 0 ? newQty : '—'}
              </p>
            </div>
          </div>

          {/* Direction tabs */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
            {(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as AdjustType[]).map((d) => (
              <button
                key={d}
                onClick={() => { setDirection(d); setReason(''); setError(''); }}
                className={`flex-1 py-2 flex items-center justify-center gap-1 transition-colors ${
                  direction === d ? 'text-white' : 'text-muted-foreground hover:bg-muted'
                }`}
                style={direction === d ? { background: 'var(--accent)' } : undefined}
              >
                {d === 'STOCK_IN' && <ArrowUpCircle className="h-3.5 w-3.5" />}
                {d === 'STOCK_OUT' && <ArrowDownCircle className="h-3.5 w-3.5" />}
                {d === 'STOCK_IN' ? 'Stock In' : d === 'STOCK_OUT' ? 'Stock Out' : 'Adjust'}
              </button>
            ))}
          </div>

          {/* Quantity */}
          <div>
            <label className="text-xs text-muted-foreground font-medium">Quantity</label>
            <input
              type="number"
              min={0}
              step={1}
              value={qtyStr}
              onChange={(e) => { setQtyStr(e.target.value); setError(''); }}
              placeholder="0"
              className="mt-1 w-full h-11 rounded-lg border border-border bg-input text-foreground px-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              autoFocus
            />
          </div>

          {/* Unit Cost — only for STOCK_IN, drives Moving-Average Cost */}
          {direction === 'STOCK_IN' && (
            <div>
              <label className="text-xs text-muted-foreground font-medium">
                Unit Cost (₱) <span className="text-[10px] text-muted-foreground/70">— optional, drives gross-profit accuracy</span>
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={unitCostStr}
                onChange={(e) => setUnitCostStr(e.target.value)}
                placeholder="What you paid this delivery"
                className="mt-1 w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
                When set, your COGS uses Moving-Average Cost going forward — handles
                volatile-cost items (produce, FX-imported goods) accurately.
              </p>
            </div>
          )}

          {/* Paid with — only for STOCK_IN, tells the ledger the funding source */}
          {direction === 'STOCK_IN' && (
            <div>
              <label className="text-xs text-muted-foreground font-medium">Paid with</label>
              <div className="mt-1 flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                {([['CASH', 'Cash on hand'], ['OWNER_FUNDED', 'Owner funds']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setPaymentMethod(value)}
                    className={`flex-1 py-2 flex items-center justify-center transition-colors ${
                      paymentMethod === value ? 'text-white' : 'text-muted-foreground hover:bg-muted'
                    }`}
                    style={paymentMethod === value ? { background: 'var(--accent)' } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="text-xs text-muted-foreground font-medium">Reason</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {REASONS[direction].map((r) => (
                <button
                  key={r.label}
                  onClick={() => {
                    setReason(r.label); setError('');
                    // Smart default for the ledger: opening stock ("Initial
                    // count") is owner-funded, not a cash purchase; every
                    // other stock-in reason defaults to cash. The operator
                    // can still override via the "Paid with" picker.
                    if (direction === 'STOCK_IN') setPaymentMethod(r.label === 'Initial count' ? 'OWNER_FUNDED' : 'CASH');
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    reason === r.label ? 'text-white' : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                  style={reason === r.label ? { background: 'var(--accent)' } : undefined}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Supervisor PIN — required for write-offs */}
          {isNegative && (
            <div>
              <label className="text-xs text-muted-foreground font-medium">
                Supervisor PIN <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={supervisorPin}
                onChange={(e) => { setSupervisorPin(e.target.value.replace(/\D/g, '')); setError(''); }}
                placeholder="4-6 digits"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Removing stock is a write-off, so a supervisor has to approve it.
              </p>
            </div>
          )}

          {/* Note (optional) */}
          <div>
            <label className="text-xs text-muted-foreground font-medium">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Supplier invoice #1234"
              className="mt-1 w-full h-9 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || loading} className="min-w-28">
            {loading ? 'Saving…' : 'Save Adjustment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
