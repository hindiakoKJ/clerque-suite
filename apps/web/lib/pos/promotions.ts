/**
 * Promotions utility for POS checkout.
 * Pure functions — no side effects, fully testable.
 */

export interface ActivePromotion {
  id: string;
  name: string;
  discountPercent: number | null;
  fixedPrice: number | null;
  appliesToAll: boolean;
  isStackable: boolean;
  productIds: string[];
}

export interface CartLine {
  product: { id: string; price: number };
  unitPrice: number;
  quantity: number;
}

export interface LineDiscount {
  promoId: string;
  promoName: string;
  discountAmount: number;
}

/**
 * Compute the best applicable promotion discount for a single cart line.
 *
 * Rules:
 * - A promotion applies if `appliesToAll` is true OR `productIds` includes the
 *   line's product ID.
 * - `discountPercent` is applied as a percentage of `unitPrice * quantity`.
 * - `fixedPrice` means the product sells at that price; discount is
 *   `(unitPrice - fixedPrice) * quantity`. Only applied when fixedPrice < unitPrice.
 * - Among all applicable promotions, the one yielding the highest `discountAmount`
 *   wins (best deal for the customer).
 * - Returns `null` if no applicable promotion exists or none produces a positive
 *   discount.
 */
export function getLinePromoDiscount(
  line: CartLine,
  promotions: ActivePromotion[],
): LineDiscount | null {
  const lineTotal = line.unitPrice * line.quantity;
  let best: LineDiscount | null = null;

  for (const promo of promotions) {
    // Check applicability
    const applies =
      promo.appliesToAll || promo.productIds.includes(line.product.id);
    if (!applies) continue;

    let discountAmount = 0;

    if (promo.discountPercent !== null) {
      discountAmount = (promo.discountPercent / 100) * lineTotal;
    } else if (promo.fixedPrice !== null && promo.fixedPrice < line.unitPrice) {
      discountAmount = (line.unitPrice - promo.fixedPrice) * line.quantity;
    }

    if (discountAmount <= 0) continue;

    if (best === null || discountAmount > best.discountAmount) {
      best = {
        promoId: promo.id,
        promoName: promo.name,
        discountAmount,
      };
    }
  }

  return best;
}
