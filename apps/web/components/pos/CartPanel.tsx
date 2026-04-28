'use client';
import { Minus, Plus, Trash2, Tag, ShieldOff, Sparkles } from 'lucide-react';
import { formatPeso } from '@/lib/utils';
import { useCartStore } from '@/store/pos/cart';
import { Button } from '@/components/ui/button';

interface CartPanelProps {
  onCheckout: () => void;
  onApplyPwdSc: () => void;
}

export function CartPanel({ onCheckout, onApplyPwdSc }: CartPanelProps) {
  const { lines, orderDiscount, taxStatus, isVatRegistered, removeItem, updateQty, removeOrderDiscount, subtotal, totalDiscount, vatAmount, grandTotal } =
    useCartStore();

  const sub = subtotal();
  const disc = totalDiscount();
  const vat = vatAmount();
  const total = grandTotal();
  const isEmpty = lines.length === 0;

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <h2 className="font-semibold text-foreground">Order</h2>
        <div className="flex items-center gap-1.5">
          {taxStatus === 'NON_VAT' && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
              <ShieldOff className="h-3 w-3" />
              Non-VAT
            </span>
          )}
          {taxStatus === 'UNREGISTERED' && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-orange-600 dark:text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">
              <ShieldOff className="h-3 w-3" />
              Unregistered
            </span>
          )}
          {!isEmpty && (
            <span className="text-xs bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--accent)] px-2 py-0.5 rounded-full font-medium">
              {lines.reduce((s, l) => s + l.quantity, 0)} items
            </span>
          )}
        </div>
      </div>

      {/* Lines */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-4xl">🛒</span>
            <p className="text-sm">No items yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li key={line.lineKey} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{line.product.name}</p>
                    {line.modifiers && line.modifiers.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {line.modifiers.map((m) => m.optionName).join(', ')}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{formatPeso(line.unitPrice)} each</p>
                    {/* Promotion badge */}
                    {line.promotionApplied && line.itemDiscount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full mt-0.5">
                        <Sparkles className="h-2.5 w-2.5" />
                        {line.promotionApplied.promoName} −{formatPeso(line.itemDiscount * line.quantity)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeItem(line.lineKey)}
                    aria-label="Remove item from cart"
                    className="p-2 -m-1 rounded-lg text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQty(line.lineKey, line.quantity - 1)}
                      aria-label="Decrease quantity"
                      className="h-10 w-10 rounded-lg border border-border bg-background text-foreground flex items-center justify-center hover:bg-accent/10 active:scale-95 transition-all"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="text-base font-semibold w-8 text-center text-foreground tabular-nums">{line.quantity}</span>
                    <button
                      onClick={() => updateQty(line.lineKey, line.quantity + 1)}
                      aria-label="Increase quantity"
                      className="h-10 w-10 rounded-lg border border-border bg-background text-foreground flex items-center justify-center hover:bg-accent/10 active:scale-95 transition-all"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <span className="text-sm font-bold text-foreground">
                    {formatPeso((line.unitPrice - line.itemDiscount) * line.quantity)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Discounts + Totals */}
      {!isEmpty && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {/* PWD / SC button */}
          {!orderDiscount && (
            <button
              onClick={onApplyPwdSc}
              className="w-full flex items-center gap-2 text-xs text-purple-500 hover:text-purple-400 font-medium py-1"
            >
              <Tag className="h-3.5 w-3.5" />
              Apply PWD / Senior Citizen Discount
            </button>
          )}
          {orderDiscount && (
            <div className="space-y-1 py-1 border-t border-dashed border-purple-400/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-purple-500 font-medium flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {orderDiscount.label} (20%)
                </span>
                <button onClick={removeOrderDiscount} className="text-muted-foreground/40 hover:text-red-500">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {/* PH-law breakdown (RA 9994 / RA 7277) */}
              <div className="bg-purple-500/10 rounded-lg px-2.5 py-2 space-y-1 text-[11px]">
                <div className="flex justify-between text-muted-foreground">
                  <span>{isVatRegistered ? 'VAT-excl. base' : 'Gross base'}</span>
                  <span>{formatPeso(orderDiscount.vatExclusiveBase)}</span>
                </div>
                <div className="flex justify-between text-purple-500 font-medium">
                  <span>20% discount on base</span>
                  <span>-{formatPeso(orderDiscount.discountOnBase)}</span>
                </div>
                {isVatRegistered && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>VAT relief on discount</span>
                    <span>-{formatPeso(orderDiscount.totalSavings - orderDiscount.discountOnBase)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-purple-500 border-t border-purple-400/30 pt-1">
                  <span>Total savings</span>
                  <span>-{formatPeso(orderDiscount.totalSavings)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatPeso(sub)}</span>
            </div>
            {(() => {
              const promoTotal = lines.reduce(
                (s, l) => s + (l.promotionApplied ? l.itemDiscount * l.quantity : 0), 0,
              );
              return promoTotal > 0 ? (
                <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                  <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" />Promo savings</span>
                  <span>-{formatPeso(promoTotal)}</span>
                </div>
              ) : null;
            })()}
            {disc > 0 && (
              <div className="flex justify-between text-sm text-red-500">
                <span>Discount</span>
                <span>-{formatPeso(disc)}</span>
              </div>
            )}
            {isVatRegistered && orderDiscount && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>VAT relief</span>
                <span>-{formatPeso(orderDiscount.totalSavings - orderDiscount.discountOnBase)}</span>
              </div>
            )}
            {isVatRegistered && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>VAT (12%)</span>
                <span>{formatPeso(vat)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-foreground pt-1 border-t border-border">
              <span>Total</span>
              <span style={{ color: 'var(--accent)' }}>{formatPeso(total)}</span>
            </div>
          </div>

          <Button
            onClick={onCheckout}
            size="lg"
            className="w-full mt-1"
            style={{ background: 'var(--accent)' }}
            disabled={isEmpty}
          >
            Charge {formatPeso(total)}
          </Button>
        </div>
      )}
    </div>
  );
}
