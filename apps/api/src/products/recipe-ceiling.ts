/**
 * How many of a menu item the shelf can still make: the POS tile's
 * "16 left", as one rule the till and the buy list both read.
 *
 * The ingredient that runs out first sets the number. A product with its own
 * recipe is judged by that recipe. One whose recipes live only on its sizes
 * is judged by its best size, because the tile can sell whichever size still
 * has stock. A recipe product with no recipe at all can make nothing.
 *
 * Kept free of the database so the buy list can ask the same question about
 * the same rows without a second copy of the rule that could drift.
 */

export interface RecipeLine {
  rawMaterialId: string;
  quantity:      unknown;
  rawMaterial?:  { name: string; unit: string } | null;
}

export type LimitedBy = {
  rawMaterialId: string;
  name:          string;
  unit:          string;
  stock:         number;
  perUnit:       number;
} | null;

/**
 * Whole servings `stock` covers at `per` each.
 *
 * Quantities are Decimal(12,4) turned into JS numbers, and plain division
 * lands just under the true answer: 1.2 / 0.4 is 2.9999999999999996, so a
 * shelf holding exactly three servings said two. Worked in ten-thousandths,
 * the division is exact at that precision.
 */
export function servingsOf(stock: number, per: number): number {
  // Never a zero divisor: an amount below the stored precision still takes something.
  return Math.floor(Math.round(stock * 10000) / Math.max(1, Math.round(per * 10000)));
}

/** The ceiling of one recipe, from stock at one branch. */
export function ceilingOf(bom: RecipeLine[], stockOf: (rawMaterialId: string) => number): { max: number; limitedBy: LimitedBy } {
  let min = Number.POSITIVE_INFINITY;
  let limit: LimitedBy = null;
  for (const line of bom) {
    const stock = stockOf(line.rawMaterialId);
    const perUnit = Number(line.quantity);
    if (perUnit <= 0) continue;
    const producible = servingsOf(stock, perUnit);
    if (producible < min) {
      min = producible;
      limit = {
        rawMaterialId: line.rawMaterialId,
        name:          line.rawMaterial?.name ?? 'Unknown ingredient',
        unit:          line.rawMaterial?.unit ?? '',
        stock,
        perUnit,
      };
    }
  }
  return { max: min === Number.POSITIVE_INFINITY ? 0 : min, limitedBy: limit };
}

export interface CeilingProduct {
  bomItems: RecipeLine[];
  variants: Array<{ id: string; variantBomItems: RecipeLine[] }>;
}

/** A recipe product's ceiling by the POS tile's rules, with one ceiling per size that has its own recipe. */
export function productCeiling(p: CeilingProduct, stockOf: (rawMaterialId: string) => number): {
  maxProducible: number;
  limitedBy: LimitedBy;
  variantCeilings: Array<{ variantId: string; maxProducible: number; limitedBy: LimitedBy }>;
} {
  const variantCeilings = p.variants
    .filter((v) => v.variantBomItems.length > 0)
    .map((v) => { const c = ceilingOf(v.variantBomItems, stockOf); return { variantId: v.id, maxProducible: c.max, limitedBy: c.limitedBy }; });

  if (p.bomItems.length > 0) {
    const base = ceilingOf(p.bomItems, stockOf);
    return { maxProducible: base.max, limitedBy: base.limitedBy, variantCeilings };
  }
  if (variantCeilings.length > 0) {
    const best = variantCeilings.reduce((a, b) => (b.maxProducible > a.maxProducible ? b : a));
    return { maxProducible: best.maxProducible, limitedBy: best.limitedBy, variantCeilings };
  }
  return { maxProducible: 0, limitedBy: null, variantCeilings };
}
