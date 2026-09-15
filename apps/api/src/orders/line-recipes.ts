import { Prisma } from '@prisma/client';
import { recipeUsagePerUnit, UsagePerUnit } from './recipe-usage';

/**
 * The recipes of order lines already written, loaded in three queries.
 *
 * The sale works from the cart it is ringing up; everything that looks at a
 * line afterwards -- what a waiting ticket holds, what the ready tap takes --
 * works from the saved line: its product, its size and its add-ons. Both read
 * the recipe as it is now and walk it with the same recipeUsagePerUnit, so a
 * held amount and the amount the tap takes are the same number.
 */

export interface RecipeRawMaterial {
  name: string;
  unit: string;
  costPrice: Prisma.Decimal | null;
  lotsTracked: boolean;
}

export interface LineForRecipe {
  productId: string;
  variantId: string | null;
  modifiers: Array<{ modifierOptionId: string | null }>;
}

type Db = Pick<Prisma.TransactionClient, 'bomItem' | 'variantBomItem' | 'modifierOption'>;

const RAW = { name: true, unit: true, costPrice: true, lotsTracked: true } as const;

export async function loadLineRecipes(
  db: Db,
  tenantId: string,
  lines: LineForRecipe[],
): Promise<(line: LineForRecipe) => Array<UsagePerUnit<RecipeRawMaterial>>> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const optionIds = [...new Set(lines.flatMap((l) => l.modifiers.map((m) => m.modifierOptionId)).filter((o): o is string => !!o))];

  const bom = productIds.length
    ? await db.bomItem.findMany({
        where:  { productId: { in: productIds }, product: { tenantId } },
        select: { productId: true, rawMaterialId: true, quantity: true, rawMaterial: { select: RAW } },
      })
    : [];
  const variantBom = variantIds.length
    ? await db.variantBomItem.findMany({
        where:  { variantId: { in: variantIds }, variant: { product: { tenantId } } },
        select: { variantId: true, rawMaterialId: true, quantity: true, rawMaterial: { select: RAW } },
      })
    : [];
  const options = optionIds.length
    ? await db.modifierOption.findMany({
        where:  { id: { in: optionIds } },
        select: {
          id: true, recipeMultiplier: true,
          ingredients: { select: { rawMaterialId: true, quantity: true, rawMaterial: { select: RAW } } },
        },
      })
    : [];

  const byProduct = new Map<string, typeof bom>();
  for (const b of bom) byProduct.set(b.productId, [...(byProduct.get(b.productId) ?? []), b]);
  const byVariant = new Map<string, typeof variantBom>();
  for (const b of variantBom) byVariant.set(b.variantId, [...(byVariant.get(b.variantId) ?? []), b]);
  const optionById = new Map(options.map((o) => [o.id, o]));

  return (line) => recipeUsagePerUnit<RecipeRawMaterial>(
    byProduct.get(line.productId) ?? [],
    line.variantId ? byVariant.get(line.variantId) : undefined,
    line.modifiers
      .map((m) => (m.modifierOptionId ? optionById.get(m.modifierOptionId) : undefined))
      .filter((o): o is NonNullable<typeof o> => o != null),
  );
}
