import type { PrismaService } from '../prisma/prisma.service';
import { canSeePurchaseCosts, COST_DECIDER_ROLES } from '../procure/cost-visibility';

/**
 * What the prep board says about money, and to whom.
 *
 * The board is the cook's screen, and it carried what every prep costs per
 * gram; recording a batch answered with what the batch was worth. An owner who
 * turned off "show purchase costs to staff" still had those figures in front
 * of every cook and barista -- on the card, and one network tab away.
 *
 * Only the RESPONSE is filtered, here at the controller's door. The service
 * keeps reading and writing the real costs: making a batch blends them into
 * the average, and the profit reports run on that average. Blanking the stored
 * figure to hide it would zero every margin in the shop.
 */

/**
 * Whether this viewer may see what the shop paid. Read per request, not from
 * the JWT, so the owner's switch takes effect on the next load and not after
 * every member of staff has logged out.
 */
export async function prepCostsVisibleTo(
  prisma: Pick<PrismaService, 'tenant'>,
  tenantId: string,
  role: string | null | undefined,
): Promise<boolean> {
  // The people who decide always see; only for everyone else is it worth a query.
  if (COST_DECIDER_ROLES.includes(role ?? '')) return true;
  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { showPurchaseCostsToStaff: true },
  });
  return canSeePurchaseCosts(role, tenant?.showPurchaseCostsToStaff);
}

/** One prep board row with its cost per unit taken off. Everything else stays. */
export function boardRowWithoutCost<T extends object>(row: T): Omit<T, 'costPrice'> {
  const { costPrice: _hidden, ...rest } = row as T & { costPrice?: unknown };
  return rest;
}

/** One recipe (GET :id) without its cost, or the cost of anything it is made from. */
export function recipeWithoutCosts<T extends object>(recipe: T) {
  const { costPrice: _hidden, subRecipeItems, ...rest } = recipe as T & {
    costPrice?: unknown;
    subRecipeItems?: Array<{ rawMaterial?: ({ costPrice?: unknown } & object) | null }>;
  };
  return {
    ...rest,
    ...(subRecipeItems
      ? {
          subRecipeItems: subRecipeItems.map((line) => {
            if (!line.rawMaterial) return line;
            const { costPrice: _lineCost, ...rawMaterial } = line.rawMaterial;
            return { ...line, rawMaterial };
          }),
        }
      : {}),
  };
}

/**
 * The answer to "I made a batch", without what it was worth: the cost per
 * unit, the value of what went in, and the new average. What was made, how
 * much, and from what all stay -- that is the cook's own work.
 */
export function batchResultWithoutCosts<T extends object>(result: T) {
  const { unitCost: _u, inputValue: _i, newWac: _w, ...rest } =
    result as T & { unitCost?: unknown; inputValue?: unknown; newWac?: unknown };
  return rest;
}
