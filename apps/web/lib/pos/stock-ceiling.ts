/**
 * Stock ceiling at the till.
 *
 * The catalog payload (/products/pos) carries `maxProducible` per product:
 * finished goods on hand for a unit-based product, or the fewest servings any
 * ingredient allows for a recipe. The server refuses a POS order past it
 * (NOT_ENOUGH_INGREDIENTS) unless the owner opted to sell past the count or
 * recipe deduction is paused — `canOversell` on the same payload. These
 * helpers apply the same rule while the cart is being built, so the cashier
 * hears "only 3 can be made" at the tile or the "+" button, not at Charge.
 */

export interface CeilingProduct {
  id: string;
  name: string;
  maxProducible?: number | null;
  /** The ingredient that set the ceiling, for the message. */
  limitedByName?: string;
  /** The server will not refuse past the count, so neither does the till. */
  canOversell?: boolean;
}

/**
 * Units of `productId` already in the cart, across every line — a latte with
 * oat milk and one with fresh milk are two lines drawing on the same recipe.
 */
export function unitsInCart(
  lines: ReadonlyArray<{ product: { id: string }; quantity: number }>,
  productId: string,
): number {
  return lines.reduce((sum, l) => (l.product.id === productId ? sum + l.quantity : sum), 0);
}

/** The most of `product` one cart may hold, or null when nothing caps it. */
export function cartCeiling(product: CeilingProduct): number | null {
  if (product.canOversell) return null;
  if (product.maxProducible == null || !Number.isFinite(product.maxProducible)) return null;
  return Math.max(0, Math.floor(product.maxProducible));
}

/**
 * What to tell the cashier when the cart would hold `wanted` of `product`,
 * or null when that many fit.
 */
export function ceilingMessage(product: CeilingProduct, wanted: number): string | null {
  const ceiling = cartCeiling(product);
  if (ceiling === null || wanted <= ceiling) return null;
  const why = product.limitedByName ? ` — not enough ${product.limitedByName}` : '';
  if (ceiling === 0) return `${product.name} is out${why}.`;
  return `Only ${ceiling} ${product.name} can be made right now${why}.`;
}

interface OfflineSaleFields {
  maxProducible?: number | null;
  isOutOfStock?: boolean;
  isLowStock?: boolean;
  canOversell?: boolean;
  inventory?: { lowStockAlert?: number | null }[];
}

/**
 * The cached catalog after a sale rung while offline: each product sold comes
 * down by what was sold, and its out/low flags follow, so the tile does not
 * keep showing the number from before the connection dropped.
 *
 * Per product only. A latte and a mocha both drawing on the same milk is a
 * recipe fact the till does not have, so the mocha's tile stays put until the
 * server is asked again. Rows that did not change are returned as the same
 * object, so a caller can write back only the ones that did.
 */
export function afterOfflineSale<P extends { id: string }>(
  products: P[],
  sold: ReadonlyMap<string, number>,
): P[] {
  return products.map((p) => {
    const qty = sold.get(p.id);
    const row = p as P & OfflineSaleFields;
    if (!qty || row.maxProducible == null) return p;
    const left = Math.max(0, row.maxProducible - qty);
    // Same low-stock rule as the server: the product's own alert level, or 5.
    const lowAt = row.inventory?.[0]?.lowStockAlert ?? 5;
    return {
      ...p,
      maxProducible: left,
      isOutOfStock:  left === 0 && !row.canOversell,
      isLowStock:    row.isLowStock === true || left <= lowAt,
    };
  });
}
