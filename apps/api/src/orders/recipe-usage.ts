import { Prisma } from '@prisma/client';

/**
 * What one sold line uses up, worked out one way everywhere.
 *
 * The sale, Recipe Catch-Up and (next) the kitchen's ready tap all have to
 * agree on the recipe of a line. Each used to carry its own copy of the walk,
 * and the copies drifted: Catch-Up never read size recipes, so a replayed
 * Large deducted a Regular's milk. The rules, once:
 *
 *   - A size (variant) with its own recipe REPLACES the product's recipe; a
 *     size without one uses the product's.
 *   - The highest recipe multiplier among the chosen add-ons scales that base
 *     recipe (a "Grande" at 1.25). Highest, never compounded.
 *   - Each chosen add-on's own ingredients are added. They are signed: a
 *     negative line cancels a base ingredient, which is how "oat milk instead
 *     of dairy" is expressed.
 *   - Netted per ingredient, then floored at zero: over-cancelling settles at
 *     "none used", never at stock or cost handed back.
 */

type Qty = number | Prisma.Decimal | { toString(): string };

export interface RecipeLine<R> {
  rawMaterialId: string;
  quantity: Qty;
  rawMaterial?: R | null;
}

export interface RecipeOption<R> {
  recipeMultiplier: Qty | null;
  ingredients: Array<RecipeLine<R>>;
}

export interface UsagePerUnit<R> {
  rawMaterialId: string;
  /** How much one finished unit uses, in the ingredient's own unit. */
  perUnit: number;
  rawMaterial: R | null;
}

/** Per finished unit, netted and floored, in the order the base recipe then the add-ons name them. */
export function recipeUsagePerUnit<R>(
  productBom: Array<RecipeLine<R>>,
  variantBom: Array<RecipeLine<R>> | null | undefined,
  options: Array<RecipeOption<R>>,
): Array<UsagePerUnit<R>> {
  const multiplier = options.reduce((max, o) => {
    const m = Number(o.recipeMultiplier);
    return Number.isFinite(m) && m > max ? m : max;
  }, 1);
  const base = variantBom && variantBom.length > 0 ? variantBom : productBom;

  const netted = new Map<string, UsagePerUnit<R>>();
  const add = (line: RecipeLine<R>, qty: number) => {
    const existing = netted.get(line.rawMaterialId);
    if (existing) existing.perUnit += qty;
    else netted.set(line.rawMaterialId, { rawMaterialId: line.rawMaterialId, perUnit: qty, rawMaterial: line.rawMaterial ?? null });
  };
  for (const line of base) add(line, Number(line.quantity) * multiplier);
  for (const o of options) for (const ing of o.ingredients) add(ing, Number(ing.quantity));

  return [...netted.values()]
    .map((l) => ({ ...l, perUnit: Math.max(l.perUnit, 0) }))
    .filter((l) => l.perUnit > 0);
}

/**
 * What two lines of one order share when they use the same recipe: the
 * product, the size and the add-ons. Two lines with the same key use and cost
 * the same per unit; a Regular and a Large of one product do not.
 */
export function recipeKey(productId: string, variantId: string | null | undefined, optionIds: Array<string | null | undefined>): string {
  return `${productId}|${variantId ?? ''}|${optionIds.filter((id): id is string => !!id).sort().join(',')}`;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** The order a sale takes lot layers in: soonest expiry first for a lot-tracked ingredient, else oldest received. */
export function lotDrainOrder(lotsTracked: boolean): Prisma.RawMaterialLotOrderByWithRelationInput[] {
  return lotsTracked
    ? [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }, { id: 'asc' }]
    : [{ receivedAt: 'asc' }, { id: 'asc' }];
}

export interface LotDrain {
  /** How much was actually taken from lots; less than asked when the layers ran out. */
  qty: number;
  /** What that cost, at each layer's own unit cost. */
  cost: number;
  /** Each layer taken from, so the use can be given back exactly. */
  lots: Array<{ lotId: string; qty: number; unitCost: number }>;
}

/**
 * Take `qty` from an ingredient's lot layers at a branch.
 *
 * Each take is a relative decrement guarded on what the layer still holds.
 * The old absolute write ("this layer now holds X") let two sales that read
 * the same layer both set it, so one drain vanished and the layer later gave
 * the same cheap stock to a third sale. A guarded take that loses the race
 * touches nothing, and the layers are read again.
 */
export async function drainLots(
  tx: Prisma.TransactionClient,
  where: { branchId: string; rawMaterialId: string },
  qty: number,
  lotsTracked: boolean,
): Promise<LotDrain> {
  const out: LotDrain = { qty: 0, cost: 0, lots: [] };
  let remaining = round4(qty);
  // A few passes: a lost race re-reads the layers; nothing left to read ends it.
  for (let pass = 0; pass < 5 && remaining > 0; pass++) {
    const lots = await tx.rawMaterialLot.findMany({
      where:   { ...where, qtyRemaining: { gt: 0 } },
      orderBy: lotDrainOrder(lotsTracked),
      select:  { id: true, qtyRemaining: true, unitCost: true },
    });
    if (lots.length === 0) break;
    let lostARace = false;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = round4(Math.min(Number(lot.qtyRemaining), remaining));
      if (take <= 0) continue;
      const res = await tx.rawMaterialLot.updateMany({
        where: { id: lot.id, qtyRemaining: { gte: new Prisma.Decimal(take) } },
        data:  { qtyRemaining: { decrement: new Prisma.Decimal(take) } },
      });
      // Lost the race for this layer: read the layers again rather than skip past it, so oldest-first holds.
      if (res.count !== 1) { lostARace = true; break; }
      const unitCost = Number(lot.unitCost);
      out.qty = round4(out.qty + take);
      out.cost += take * unitCost;
      out.lots.push({ lotId: lot.id, qty: take, unitCost });
      remaining = round4(remaining - take);
    }
    if (!lostARace) break;
  }
  return out;
}
