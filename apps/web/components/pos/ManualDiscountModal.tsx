'use client';

/**
 * ManualDiscountModal — cashier-applied whole-cart discount with required reason.
 *
 * Permission: only roles with order:apply_discount permission see the trigger
 * button (BUSINESS_OWNER, BRANCH_MANAGER, SALES_LEAD per PERMISSION_MATRIX).
 * The backend re-validates regardless — this is UX gating, not security.
 *
 * Discounts above 50% are flagged with an extra warning so a slip on the
 * percent field doesn't quietly hand out an 80% discount. Real fraud-protection
 * (manager PIN co-auth above a threshold) is RBAC Phase 5 territory.
 */

import { useEffect, useState } from 'react';
import { Percent, DollarSign, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/store/pos/cart';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

interface ManualDiscountModalProps {
  open: boolean;
  onClose: () => void;
}

const HIGH_DISCOUNT_PERCENT_THRESHOLD = 50;

export function ManualDiscountModal({ open, onClose }: ManualDiscountModalProps) {
  const subtotal           = useCartStore((s) => s.subtotal());
  const applyManualDiscount = useCartStore((s) => s.applyManualDiscount);

  const [mode,    setMode]    = useState<'percent' | 'fixed'>('percent');
  const [value,   setValue]   = useState('');
  const [reason,  setReason]  = useState('');

  // Reset on open so a stale value doesn't carry over between transactions
  useEffect(() => {
    if (open) {
      setMode('percent');
      setValue('');
      setReason('');
    }
  }, [open]);

  const numeric = parseFloat(value);
  const valid = Number.isFinite(numeric) && numeric > 0;
  const overcap = mode === 'percent' ? numeric > 100 : numeric > subtotal;
  const previewAmount = !valid || overcap
    ? 0
    : mode === 'percent'
      ? subtotal * (numeric / 100)
      : numeric;
  const previewTotal = Math.max(0, subtotal - previewAmount);
  const isHigh = mode === 'percent' && numeric >= HIGH_DISCOUNT_PERCENT_THRESHOLD;
  const reasonValid = reason.trim().length >= 5;

  function handleApply() {
    if (!valid || overcap || !reasonValid) return;
    applyManualDiscount(numeric, mode === 'percent', reason.trim());
    toast.success(`Discount applied — ${mode === 'percent' ? numeric + '%' : formatPeso(numeric)}`);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Apply discount</DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5 self-start">
          <button
            type="button"
            onClick={() => setMode('percent')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md inline-flex items-center gap-1.5 transition-colors ${
              mode === 'percent' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Percent className="w-3 h-3" />
            Percent
          </button>
          <button
            type="button"
            onClick={() => setMode('fixed')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md inline-flex items-center gap-1.5 transition-colors ${
              mode === 'fixed' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <DollarSign className="w-3 h-3" />
            Fixed ₱
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {mode === 'percent' ? 'Discount %' : 'Discount amount'}
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step={mode === 'percent' ? '1' : '0.01'}
            placeholder={mode === 'percent' ? 'e.g. 10' : 'e.g. 50.00'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          {overcap && (
            <p className="text-xs text-red-600">
              {mode === 'percent' ? 'Cannot exceed 100%.' : `Cannot exceed subtotal of ${formatPeso(subtotal)}.`}
            </p>
          )}
        </div>

        {valid && !overcap && (
          <div className="rounded-lg bg-secondary px-3 py-2 text-sm space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatPeso(subtotal)}</span>
            </div>
            <div className="flex justify-between text-red-600 font-medium">
              <span>Discount</span>
              <span>-{formatPeso(previewAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-foreground border-t border-border pt-1">
              <span>New subtotal</span>
              <span>{formatPeso(previewTotal)}</span>
            </div>
          </div>
        )}

        {isHigh && valid && !overcap && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              That's {numeric}% off — make sure this is intentional. The discount and reason are logged in the audit trail.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={200}
            placeholder="e.g. damaged item, loyal customer goodwill"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <p className="text-[11px] text-muted-foreground">
            Stored on the receipt and in the audit log.
          </p>
        </div>

        <div className="flex gap-2 justify-end mt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={!valid || overcap || !reasonValid}>
            Apply discount
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
