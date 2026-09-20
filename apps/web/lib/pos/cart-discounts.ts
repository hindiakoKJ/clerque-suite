/**
 * Small rules for the till's Senior/PWD and manual discounts, kept apart from
 * the cart store so Node's own test runner can check them
 * (see cart-discounts.spec.mjs). No imports on purpose.
 */

/** The parts of a cart line these rules read. */
export interface DiscountLine {
  lineKey: string;
  quantity: number;
  unitPrice: number;
  itemDiscount: number;
  product: { isVatable: boolean };
}

/**
 * What a Senior/PWD discount is taken on: ONE unit of each chosen line.
 *
 * RA 9994 / RA 7277: the 20% covers one unit per item per transaction, so
 * 2 lattes on one line are one latte at 20% off and one at full price.
 */
export function oneUnitSubtotal(lines: DiscountLine[], lineKeys: Iterable<string>): number {
  const keys = new Set(lineKeys);
  return lines.reduce((sum, l) => (keys.has(l.lineKey) ? sum + (l.unitPrice - l.itemDiscount) : sum), 0);
}

/**
 * The vatable amount no Senior/PWD discount covers: every unit of a line
 * nobody claimed, and the units past the first on a claimed line (they are
 * sold at full price, so they carry full VAT).
 */
export function unclaimedVatableSubtotal(lines: DiscountLine[], claimed: Set<string>): number {
  return lines
    .filter((l) => l.product.isVatable)
    .reduce((sum, l) => {
      const fullPriceUnits = claimed.has(l.lineKey) ? Math.max(0, l.quantity - 1) : l.quantity;
      return sum + (l.unitPrice - l.itemDiscount) * fullPriceUnits;
    }, 0);
}

/**
 * What the till says when a change to the order takes a discount off, or null
 * when there was no discount to take off.
 *
 * A discount is worked out from the order as it was when it was applied. Once
 * an item is added, removed or its quantity changed, that amount is wrong (a
 * senior's discount still on a drink that was taken off, a 10% that no longer
 * is 10%), so it comes off and the cashier applies it again.
 */
export function discountRemovedMessage(
  orderDiscount: { type: string } | null | undefined,
  additionalPwdScCount = 0,
): string | null {
  if (!orderDiscount && additionalPwdScCount === 0) return null;
  const isPwdSc = orderDiscount?.type === 'PWD' || orderDiscount?.type === 'SENIOR_CITIZEN' || additionalPwdScCount > 0;
  return isPwdSc
    ? 'The order changed, so the Senior/PWD discount was taken off. Please apply it again.'
    : 'The order changed, so the discount was taken off. Please apply it again.';
}
