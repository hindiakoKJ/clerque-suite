import { Prisma } from '@prisma/client';

/**
 * An ingredient some live recipe actually uses: an active product's recipe, an
 * active size's recipe, an active add-on, or an active prep.
 *
 * The shop's list holds twins that no recipe uses ("Ice Cubes" beside the
 * "Ice" that 48 drinks use). A purchase recorded against the twin moves its
 * stock and cost and never the recipe's, so the till still reads Ice as empty
 * and refuses iced drinks. Knowing which record the recipes use is what lets
 * the purchase screens put that one first.
 */
export const IN_A_RECIPE: Prisma.RawMaterialWhereInput = {
  OR: [
    { bomItems:                { some: { product: { isActive: true } } } },
    { variantBomItems:         { some: { variant: { isActive: true, product: { isActive: true } } } } },
    { modifierIngredientLinks: { some: { option: { isActive: true } } } },
    { usedInSubRecipes:        { some: { parent: { isActive: true } } } },
  ],
};

type Db = { rawMaterial: { findMany: (args: any) => Promise<Array<{ id: string }>> } };

/** The ids of this shop's ingredients that a live recipe uses. */
export async function idsInARecipe(db: Db, tenantId: string, ids?: string[]): Promise<Set<string>> {
  const rows = await db.rawMaterial.findMany({
    where:  { tenantId, ...(ids ? { id: { in: ids } } : {}), ...IN_A_RECIPE },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
