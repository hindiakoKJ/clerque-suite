'use client';
import { ShoppingCart, X } from 'lucide-react';
import { CartPanel } from '@/components/pos/CartPanel';

/**
 * The till's cart below 1024 px, where there is no room for the cart rail:
 * a floating button with the item count and total, which opens the cart full
 * screen (with Charge). Built for the food-and-drink till and shared with the
 * retail till so a parts shop can sell from an Android phone browser.
 *
 * The overlay is `absolute inset-0`, so the parent must be `relative`.
 */
export function MobileCart({
  open,
  onOpen,
  onClose,
  cartCount,
  total,
  onCheckout,
  onApplyPwdSc,
  onOpenParkedSales,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  cartCount: number;
  total: number;
  onCheckout: () => void;
  onApplyPwdSc: () => void;
  onOpenParkedSales: () => void;
}) {
  return (
    <>
      {/* Mobile: full-screen cart overlay */}
      {open && (
        <div className="lg:hidden absolute inset-0 z-30 flex flex-col bg-background">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
            <h2 className="font-semibold text-foreground">Current Order</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <CartPanel
              onCheckout={onCheckout}
              onApplyPwdSc={onApplyPwdSc}
              onOpenParkedSales={onOpenParkedSales}
            />
          </div>
        </div>
      )}

      {/* Mobile floating cart button */}
      {!open && cartCount > 0 && (
        <button
          onClick={onOpen}
          className="lg:hidden fixed bottom-6 right-4 z-20 flex items-center gap-2 hover:opacity-90 text-white rounded-2xl px-5 py-3.5 shadow-xl transition-all active:scale-95"
          style={{ background: 'var(--accent)' }}
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="font-bold text-sm">{cartCount} item{cartCount > 1 ? 's' : ''}</span>
          <span className="bg-white/20 rounded-lg px-2 py-0.5 text-sm font-bold">
            ₱{total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </button>
      )}
    </>
  );
}
