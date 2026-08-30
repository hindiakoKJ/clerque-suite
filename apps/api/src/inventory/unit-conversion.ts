/**
 * Getting from the unit a thing is BOUGHT in to the unit it is USED in.
 *
 * Everything downstream — recipe cost, stock deduction, low-stock alerts,
 * maxProducible — speaks ONE unit per ingredient, and that unit is the
 * fine-grained one the recipe uses. `RawMaterial.unit` is a plain label: no
 * code converts it, so whatever number goes in is taken at face value against
 * whatever number the recipe says.
 *
 * That is fine until a kitchen arrives. Beans are bought and used in grams, so
 * drinks never noticed. Rice is bought by the sack and portioned by the gram,
 * and a cook who types the buying number gets a recipe that costs a thousand
 * times too much. The failure is loud — an absurd cost and zero producible —
 * but loud on the day the menu goes live, in front of customers.
 *
 * This lived inside the spreadsheet importer, where it was written for exactly
 * this problem and works. It is here so the app's own Add-ingredient form can
 * use the same table and give the same answers: two paths into the same field
 * that disagree is how a shop ends up with the same ingredient stocked twice.
 */

type Family = 'mass' | 'volume';

export const UNIT_FACTORS: Record<string, { family: Family; perBase: number }> = {
  mg: { family: 'mass', perBase: 0.001 },
  g: { family: 'mass', perBase: 1 },
  gram: { family: 'mass', perBase: 1 },
  grams: { family: 'mass', perBase: 1 },
  kg: { family: 'mass', perBase: 1000 },
  kilo: { family: 'mass', perBase: 1000 },
  kilogram: { family: 'mass', perBase: 1000 },
  oz: { family: 'mass', perBase: 28.349523125 },
  lb: { family: 'mass', perBase: 453.59237 },
  ml: { family: 'volume', perBase: 1 },
  milliliter: { family: 'volume', perBase: 1 },
  millilitre: { family: 'volume', perBase: 1 },
  cl: { family: 'volume', perBase: 10 },
  l: { family: 'volume', perBase: 1000 },
  li: { family: 'volume', perBase: 1000 },
  liter: { family: 'volume', perBase: 1000 },
  litre: { family: 'volume', perBase: 1000 },
  tsp: { family: 'volume', perBase: 4.92892159375 },
  tbsp: { family: 'volume', perBase: 14.78676478125 },
  cup: { family: 'volume', perBase: 240 },
  floz: { family: 'volume', perBase: 29.5735295625 },
};

/** Lowercase, strip punctuation/plurals so "Grams." and "gram" agree. */
export function normUnit(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[.\s]/g, '')
    .replace(/^(fluid|fl)ounces?$/, 'floz')
    .replace(/^floz(es)?$/, 'floz')
    .replace(/s$/, '');
}

/**
 * How many `to` there are in one `from` — 1000 for kg → g.
 *
 * Null when the two are not the same kind of measurement. A pack size is the
 * answer then, not a guess: nothing can know how many millilitres are in a
 * bottle except the person holding it.
 */
export function unitFactor(from: string, to: string): number | null {
  const f = UNIT_FACTORS[normUnit(from)];
  const t = UNIT_FACTORS[normUnit(to)];
  if (!f || !t || f.family !== t.family) return null;
  return f.perBase / t.perBase;
}

export interface BuyUnitResolution {
  unit: string;
  costPrice: number;
  /** Set when the caller must stop and tell the person what to fix. */
  error?: string;
}

/**
 * Resolve a buy unit and its price into the recipe unit.
 *
 * Mirrors the spreadsheet importer line for line, including which
 * combinations are refused, so the two paths cannot drift:
 *
 *   - no recipe unit, or the same unit          → nothing to do
 *   - convertible outright (kg → g)             → divide the cost by the factor,
 *                                                 and REFUSE a pack size, because
 *                                                 a shop that gave both meant
 *                                                 something and one of the two
 *                                                 would be silently ignored
 *   - a countable container (1 bottle = 750 ml) → divide the cost by the pack size
 *   - neither                                   → refuse and ask for a pack size
 */
export function resolveBuyUnit(args: {
  unit: string;
  costPrice: number | null | undefined;
  recipeUnit?: string | null;
  packSize?: number | null;
}): BuyUnitResolution {
  const unit = String(args.unit ?? '').trim();
  const cost = args.costPrice == null ? 0 : Number(args.costPrice);
  const recipeUnit = String(args.recipeUnit ?? '').trim();
  const packSize = args.packSize == null ? null : Number(args.packSize);

  if (packSize != null && (!Number.isFinite(packSize) || packSize <= 0)) {
    return {
      unit,
      costPrice: cost,
      error: 'Pack size has to be a positive number — how many of the recipe unit are in one of what you buy.',
    };
  }

  if (!recipeUnit || normUnit(recipeUnit) === normUnit(unit)) {
    return { unit, costPrice: cost };
  }

  const factor = unitFactor(unit, recipeUnit);
  if (factor != null) {
    if (packSize != null) {
      return {
        unit,
        costPrice: cost,
        error:
          `"${unit}" already converts to "${recipeUnit}", so leave Pack Size blank. ` +
          `Use Pack Size only when what you buy is a container (pc, pack, bottle, carton).`,
      };
    }
    return { unit: recipeUnit, costPrice: cost / factor };
  }

  if (packSize != null) {
    return { unit: recipeUnit, costPrice: cost / packSize };
  }

  return {
    unit,
    costPrice: cost,
    error:
      `Cannot get from "${unit}" to "${recipeUnit}". ` +
      `Add a Pack Size saying how many ${recipeUnit} are in one ${unit}.`,
  };
}
