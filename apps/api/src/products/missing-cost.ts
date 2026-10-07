import { Prisma } from '@prisma/client';

/**
 * Which active products sell at a wrong cost, shared by the POS dashboard
 * list (GET /products/missing-cost) and the Ledger dashboard count, so the two
 * never disagree.
 *
 * Three ways a product books the wrong cost:
 *   1. It has no cost price at all.
 *   2. It has no recipe (none of its own, none on any size), so the sale books
 *      its own cost price, and that price is ₱0: a retail tea or a kitchen
 *      dish nobody has costed yet sells as free.
 *   3. Its cost comes from its recipe, and a recipe line uses an ingredient
 *      with no price or a price of 0. The sale books that line at ₱0
 *      (costPrice ?? 0), so the plate looks cheaper than it is. A recipe
 *      product's own cost is recomputed as a number and is never null, so
 *      check 1 alone can never catch this.
 *
 * Cost comes from the recipe when the product is marked RECIPE_BASED, or the
 * whole shop is (the same rule the till uses in orders.service).
 */

/** An ingredient with nothing to cost a recipe line with: blank, or 0 or less. */
export const UNPRICED_INGREDIENT: Prisma.RawMaterialWhereInput = {
  OR: [{ costPrice: null }, { costPrice: { lte: 0 } }],
};

export function missingCostWhere(tenantId: string, houseUsesRecipes: boolean): Prisma.ProductWhereInput {
  const costedByRecipe: Prisma.ProductWhereInput = houseUsesRecipes ? {} : { inventoryMode: 'RECIPE_BASED' };
  return {
    tenantId,
    isActive: true,
    OR: [
      { costPrice: null },
      {
        costPrice: { lte: 0 },
        bomItems: { none: {} },
        NOT: { variants: { some: { isActive: true, variantBomItems: { some: {} } } } },
      },
      { ...costedByRecipe, bomItems: { some: { rawMaterial: UNPRICED_INGREDIENT } } },
      {
        ...costedByRecipe,
        variants: { some: { isActive: true, variantBomItems: { some: { rawMaterial: UNPRICED_INGREDIENT } } } },
      },
    ],
  };
}

/**
 * The unpriced ingredient names on one product, sorted and without repeats.
 * Empty when the product is not costed by its recipe, because then the
 * ingredient prices never reach its cost.
 */
export function unpricedIngredientNames(
  p: {
    inventoryMode: string;
    bomItems?: Array<{ rawMaterial: { name: string } | null }>;
    variants?: Array<{ variantBomItems: Array<{ rawMaterial: { name: string } | null }> }>;
  },
  houseUsesRecipes: boolean,
): string[] {
  if (!houseUsesRecipes && p.inventoryMode !== 'RECIPE_BASED') return [];
  const names = new Set<string>();
  for (const b of p.bomItems ?? []) if (b.rawMaterial) names.add(b.rawMaterial.name);
  for (const v of p.variants ?? []) for (const b of v.variantBomItems) if (b.rawMaterial) names.add(b.rawMaterial.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}
