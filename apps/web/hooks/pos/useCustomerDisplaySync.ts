'use client';
import { useEffect, useRef } from 'react';
import { useCartStore } from '@/store/pos/cart';
import { useAuthStore } from '@/store/auth';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { publishCustomerDisplay } from '@/lib/pos/customer-display-channel';

/**
 * Cashier-side hook that mirrors the cart to the customer display.
 * Subscribes to cart changes and publishes a fresh state on every update.
 *
 * No-op when the tenant doesn't have a customer display configured
 * (CS_1 with toggle off, or no CS tier set).
 *
 * Mount this once on the terminal page. The hook handles publish-throttling
 * and the WELCOME-on-empty-cart state automatically.
 */
export function useCustomerDisplaySync() {
  const { hasCustomerDisplay, layout } = useFloorLayout();
  const businessName = useAuthStore((s) => s.user?.businessName ?? layout?.tenant?.id ?? null);
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
    if (!hasCustomerDisplay) return;

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
    hasCustomerDisplay,
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
