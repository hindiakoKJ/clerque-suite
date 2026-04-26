'use client';
import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCartStore } from '@/store/pos/cart';
import { computePwdScDiscount } from '@/lib/pos/utils';
import { formatPeso } from '@/lib/utils';

interface PwdScModalProps {
  open: boolean;
  onClose: () => void;
}

export function PwdScModal({ open, onClose }: PwdScModalProps) {
  const [type, setType] = useState<'PWD' | 'SENIOR_CITIZEN'>('SENIOR_CITIZEN');
  const [idRef, setIdRef] = useState('');
  const [idOwnerName, setIdOwnerName] = useState('');
  const [error, setError] = useState('');

  const lines = useCartStore((s) => s.lines);
  const applyPwdSc = useCartStore((s) => s.applyPwdSc);

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

  // Live discount preview
  const preview = selectedSubtotal > 0 ? computePwdScDiscount(selectedSubtotal) : null;

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
          <div className="bg-purple-50 rounded-xl p-3 text-sm text-purple-700">
            <p className="font-medium">20% discount on VAT-exclusive base (PH law)</p>
            <p className="text-xs mt-1 text-purple-500">
              Per RA 9994 / RA 7277: discount applies to <strong>1 unit per item</strong> per transaction.
              For qty &gt; 1, only 1 unit is discounted; the rest are at full price.
            </p>
          </div>

          {/* Discount type */}
          <div>
            <p className="text-xs text-gray-500 font-medium mb-2">Discount type</p>
            <div className="grid grid-cols-2 gap-2">
              {(['SENIOR_CITIZEN', 'PWD'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    type === t
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t === 'SENIOR_CITIZEN' ? '👴 Senior Citizen' : '♿ PWD'}
                </button>
              ))}
            </div>
          </div>

          {/* Per-item checkboxes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium">Items to discount</p>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelected(new Set(lineKeys))}
                  className="text-purple-600 hover:text-purple-700"
                >
                  All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-gray-400 hover:text-gray-600"
                >
                  None
                </button>
              </div>
            </div>
            <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-44 overflow-y-auto">
              {lines.map((l) => {
                const key = `${l.product.id}-${l.variantId ?? ''}`;
                const checked = selected.has(key);
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      checked ? 'bg-purple-50' : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLine(key)}
                      className="accent-purple-600 h-4 w-4 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{l.product.name}</p>
                      <p className="text-xs text-gray-400">
                        {l.quantity > 1 ? (
                          <>
                            <span className="text-purple-600 font-medium">1 discounted</span>
                            {' + '}{l.quantity - 1} full price · {formatPeso(l.unitPrice)} ea.
                          </>
                        ) : (
                          <>1 × {formatPeso(l.unitPrice)}</>
                        )}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-gray-700 shrink-0">
                      {formatPeso(l.unitPrice - l.itemDiscount)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Live preview */}
          {preview ? (
            <div className="bg-purple-50 rounded-lg px-3 py-2.5 space-y-1 text-[11px]">
              <div className="flex justify-between text-gray-500">
                <span>Selected subtotal</span>
                <span>{formatPeso(selectedSubtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>VAT-excl. base</span>
                <span>{formatPeso(preview.vatExclusiveBase)}</span>
              </div>
              <div className="flex justify-between text-purple-600 font-medium">
                <span>20% discount on base</span>
                <span>-{formatPeso(preview.discountOnBase)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>VAT relief</span>
                <span>-{formatPeso(preview.totalSavings - preview.discountOnBase)}</span>
              </div>
              <div className="flex justify-between font-semibold text-purple-700 border-t border-purple-200 pt-1">
                <span>Total savings</span>
                <span>-{formatPeso(preview.totalSavings)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center">
              Select at least one item to preview the discount.
            </p>
          )}

          {/* ID owner name + ID reference */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 font-medium">
                Name of ID Holder
                <span className="text-red-400 ml-1">*</span>
              </label>
              <Input
                value={idOwnerName}
                onChange={(e) => { setIdOwnerName(e.target.value); setError(''); }}
                placeholder="e.g. Juan dela Cruz"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium">
                {type === 'PWD' ? 'PWD ID Number' : 'Senior Citizen ID / OSCA Number'}
                <span className="text-red-400 ml-1">*</span>
              </label>
              <Input
                value={idRef}
                onChange={(e) => { setIdRef(e.target.value); setError(''); }}
                placeholder="Enter ID number (any format)"
                className="mt-1"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">
                No standard format — enter as shown on the card.
              </p>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleApply}
            variant="default"
            className="bg-purple-600 hover:bg-purple-700"
            disabled={selectedSubtotal <= 0}
          >
            Apply Discount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
