'use client';
import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCartStore } from '@/store/pos/cart';
import { computeDiscount } from '@/lib/pos/utils';
import { formatPeso } from '@/lib/utils';

interface PwdScModalProps {
  open: boolean;
  onClose: () => void;
}

// Design token alias for the PWD accent — uses the app's CSS accent variable
// so the modal matches the POS theme in both light and dark mode.
const ACCENT_CLS = 'text-[var(--accent)]';
const ACCENT_SOFT_BG = 'bg-[var(--accent-soft)]';

export function PwdScModal({ open, onClose }: PwdScModalProps) {
  const [type, setType] = useState<'PWD' | 'SENIOR_CITIZEN'>('SENIOR_CITIZEN');
  const [idRef, setIdRef] = useState('');
  const [idOwnerName, setIdOwnerName] = useState('');
  const [error, setError] = useState('');

  const lines      = useCartStore((s) => s.lines);
  const applyPwdSc = useCartStore((s) => s.applyPwdSc);
  const taxStatus  = useCartStore((s) => s.taxStatus);
  const isVat      = taxStatus === 'VAT';

  // Cashier must explicitly choose which item(s) get the discount.
  // Default is empty — nothing selected — so no accidental blanket discounts.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const lineKeys = useMemo(
    () => lines.map((l) => `${l.product.id}-${l.variantId ?? ''}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines],
  );

  // When modal opens, clear selection and reset form fields
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setIdRef('');
      setIdOwnerName('');
      setError('');
    }
  }, [open, lineKeys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleLine(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // PH law (RA 9994 / RA 7277): discount applies to 1 unit per item per transaction.
  // If qty is 3, only 1 unit is discounted; the remaining 2 pay full price.
  const selectedSubtotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const key = `${l.product.id}-${l.variantId ?? ''}`;
        // Always use 1 unit regardless of quantity
        return selected.has(key) ? sum + (l.unitPrice - l.itemDiscount) * 1 : sum;
      }, 0),
    [lines, selected],
  );

  // Live discount preview — routes to correct engine based on tenant tax status
  const preview = selectedSubtotal > 0 ? computeDiscount(selectedSubtotal, taxStatus) : null;

  function handleApply() {
    if (!idOwnerName.trim()) {
      setError('ID holder name is required for audit purposes.');
      return;
    }
    if (!idRef.trim()) {
      setError('ID number is required for audit purposes.');
      return;
    }
    if (selectedSubtotal <= 0) {
      setError('Please select at least one item to discount.');
      return;
    }

    // If ALL items are selected, pass undefined so the store uses the full cart subtotal
    const allSelected = selected.size === lineKeys.length;
    applyPwdSc(type, idRef.trim(), idOwnerName.trim(), allSelected ? undefined : selectedSubtotal);
    onClose();
  }

  function handleClose() {
    setIdRef('');
    setIdOwnerName('');
    setError('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>PWD / Senior Citizen Discount</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          {/* Law notice */}
          <div className={`${ACCENT_SOFT_BG} rounded-xl p-3 text-sm`}>
            <p className={`font-medium ${ACCENT_CLS}`}>
              {isVat
                ? '20% discount on VAT-exclusive base (PH law)'
                : '20% discount on selling price (PH law)'}
            </p>
            <p className={`text-xs mt-1 text-muted-foreground`}>
              Per RA 9994 / RA 7277: discount applies to <strong>1 unit per item</strong> per transaction.
              For qty &gt; 1, only 1 unit is discounted; the rest are at full price.
              {!isVat && (
                <> No VAT component — discount is applied directly on the price.</>
              )}
            </p>
          </div>

          {/* Discount type */}
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-2">Discount type</p>
            <div className="grid grid-cols-2 gap-2">
              {(['SENIOR_CITIZEN', 'PWD'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    type === t
                      ? 'text-white border-transparent'
                      : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                  style={type === t ? { background: 'var(--accent)' } : undefined}
                >
                  {t === 'SENIOR_CITIZEN' ? '👴 Senior Citizen' : '♿ PWD'}
                </button>
              ))}
            </div>
          </div>

          {/* Per-item checkboxes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground font-medium">Items to discount</p>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelected(new Set(lineKeys))}
                  className={`${ACCENT_CLS} hover:opacity-80`}
                >
                  All
                </button>
                <span className="text-muted-foreground/40">|</span>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-muted-foreground hover:text-foreground"
                >
                  None
                </button>
              </div>
            </div>
            <div className="border border-border rounded-lg divide-y divide-border max-h-44 overflow-y-auto">
              {lines.map((l) => {
                const key = `${l.product.id}-${l.variantId ?? ''}`;
                const checked = selected.has(key);
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      checked ? ACCENT_SOFT_BG : 'bg-card hover:bg-secondary/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLine(key)}
                      className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{l.product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.quantity > 1 ? (
                          <>
                            <span className={`${ACCENT_CLS} font-medium`}>1 discounted</span>
                            {' + '}{l.quantity - 1} full price · {formatPeso(l.unitPrice)} ea.
                          </>
                        ) : (
                          <>1 × {formatPeso(l.unitPrice)}</>
                        )}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-foreground shrink-0">
                      {formatPeso(l.unitPrice - l.itemDiscount)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Live preview */}
          {preview ? (
            <div className={`${ACCENT_SOFT_BG} rounded-lg px-3 py-2.5 space-y-1 text-[11px]`}>
              <div className="flex justify-between text-muted-foreground">
                <span>Selected subtotal</span>
                <span>{formatPeso(selectedSubtotal)}</span>
              </div>

              {isVat ? (
                // VAT-registered: show full VAT breakdown
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>VAT-excl. base</span>
                    <span>{formatPeso(preview.vatExclusiveBase)}</span>
                  </div>
                  <div className={`flex justify-between ${ACCENT_CLS} font-medium`}>
                    <span>20% discount on base</span>
                    <span>-{formatPeso(preview.discountOnBase)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>VAT relief</span>
                    <span>-{formatPeso(preview.totalSavings - preview.discountOnBase)}</span>
                  </div>
                </>
              ) : (
                // Non-VAT / Unregistered: simple 20% on gross — no VAT to strip
                <div className={`flex justify-between ${ACCENT_CLS} font-medium`}>
                  <span>20% discount</span>
                  <span>-{formatPeso(preview.discountOnBase)}</span>
                </div>
              )}

              <div className={`flex justify-between font-semibold ${ACCENT_CLS} border-t border-border/50 pt-1`}>
                <span>Total savings</span>
                <span>-{formatPeso(preview.totalSavings)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center">
              Select at least one item to preview the discount.
            </p>
          )}

          {/* ID owner name + ID reference */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium">
                Name of ID Holder
                <span className="text-destructive ml-1">*</span>
              </label>
              <Input
                value={idOwnerName}
                onChange={(e) => { setIdOwnerName(e.target.value); setError(''); }}
                placeholder="e.g. Juan dela Cruz"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">
                {type === 'PWD' ? 'PWD ID Number' : 'Senior Citizen ID / OSCA Number'}
                <span className="text-destructive ml-1">*</span>
              </label>
              <Input
                value={idRef}
                onChange={(e) => { setIdRef(e.target.value); setError(''); }}
                placeholder="Enter ID number (any format)"
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                No standard format — enter as shown on the card.
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}

            {/* Data Privacy notice — RA 10173 (Data Privacy Act) compliance.
                Cashier should ensure customer is aware before recording sensitive ID data. */}
            <div className="bg-muted/40 border border-border rounded-lg px-3 py-2 mt-2">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Data Privacy Notice:</span>{' '}
                The ID number and holder name are collected as required by RA 9994 / RA 7277 for
                discount audit and BIR compliance, and retained for 10 years per NIRC §235.
                Treated as sensitive personal information under RA 10173.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleApply}
            className="text-white"
            style={{ background: 'var(--accent)' }}
            disabled={selectedSubtotal <= 0}
          >
            Apply Discount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
