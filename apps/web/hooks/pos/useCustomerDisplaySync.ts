'use client';
import { useEffect, useRef } from 'react';
import { useCartStore } from '@/store/pos/cart';
import { useAuthStore } from '@/store/auth';
import { publishCustomerDisplay } from '@/lib/pos/customer-display-channel';

/**
 * Cashier-side hook that mirrors the cart to the customer display.
 * Subscribes to cart changes and publishes a fresh state on every update.
 *
 * Deliberately NOT gated on Tenant.hasCustomerDisplay.
 *
 * That flag defaults false and is only ever set by the floor-layout wizard or
 * an admin, so a shop that simply opened /pos/customer-display in a second tab
 * — which is all the feature actually requires — got no cart updates at all.
 * Worse, it half-worked: the payment-complete publish on the terminal page
 * ignores the flag, so the display sat on WELCOME through the entire sale and
 * then suddenly showed the receipt. That reads as "the customer screen needs a
 * refresh", because refreshing rehydrates it from the last persisted state.
 *
 * Publishing is cheap — BroadcastChannel and localStorage cost nothing, and
 * the server relay is fire-and-forget at a few writes per sale — so there is
 * nothing to save by gating it. If nobody has a display open, the messages go
 * nowhere and that is fine.
 *
 * Mount this once on the terminal page. The hook handles publish-deduping and
 * the WELCOME-on-empty-cart state automatically.
 */
export function useCustomerDisplaySync() {
  // NEVER fall back to an identifier here. This string is shown on the
  // customer-facing screen, and the old `?? layout?.tenant?.id` fallback
  // printed a raw database id (e.g. "cmofudy340000o201wloxhods") across the
  // display for any tenant that had not filled in Business Profile yet.
  // Passing undefined lets the display fall through to its own 'Welcome'.
  const businessName = useAuthStore((s) => s.user?.businessName ?? null);
  const cashierName = useAuthStore((s) => s.user?.name ?? null);

  // Track cart-level fields with selector subscriptions so we re-publish
  // only when something user-visible changes.
  const lines = useCartStore((s) => s.lines);
  const orderDiscount = useCartStore((s) => s.orderDiscount);
  const additionalPwdScEntries = useCartStore((s) => s.additionalPwdScEntries);
  const subtotal = useCartStore((s) => s.subtotal);
  const totalDiscount = useCartStore((s) => s.totalDiscount);
  const vatAmount = useCartStore((s) => s.vatAmount);
  const grandTotal = useCartStore((s) => s.grandTotal);

  const lastPublishedSig = useRef<string>('');

  useEffect(() => {
    // Build a deterministic signature so we don't publish identical states.
    const sig = JSON.stringify({
      n: lines.length,
      lk: lines.map((l) => `${l.lineKey}:${l.quantity}:${l.unitPrice}:${l.itemDiscount}`).join(','),
      d: orderDiscount?.totalSavings ?? 0,
      a: additionalPwdScEntries.length,
    });
    if (sig === lastPublishedSig.current) return;
    lastPublishedSig.current = sig;

    if (lines.length === 0) {
      publishCustomerDisplay({
        type: 'WELCOME',
        lines: [],
        subtotal: 0,
        discount: 0,
        vatAmount: 0,
        total: 0,
        businessName: businessName ?? undefined,
        cashierName: cashierName ?? undefined,
      });
      return;
    }

    publishCustomerDisplay({
      type: 'CART_UPDATE',
      lines: lines.map((l) => ({
        productName: l.product.name,
        quantity:    l.quantity,
        unitPrice:   l.unitPrice,
        lineTotal:   (l.unitPrice - l.itemDiscount) * l.quantity,
        modifiers:   l.modifiers?.map((m) => m.optionName),
      })),
      subtotal:  subtotal(),
      discount:  totalDiscount() - lines.reduce((sum, l) => sum + l.itemDiscount * l.quantity, 0),
      vatAmount: vatAmount(),
      total:     grandTotal(),
      businessName: businessName ?? undefined,
      cashierName: cashierName ?? undefined,
    });
  }, [
    lines,
    orderDiscount,
    additionalPwdScEntries,
    subtotal,
    totalDiscount,
    vatAmount,
    grandTotal,
    businessName,
    cashierName,
  ]);
}
