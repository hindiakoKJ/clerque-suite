import { Prisma } from '@prisma/client';
import { loadLineRecipes } from './line-recipes';

/**
 * Ingredients promised to tickets still waiting at a kitchen or bar screen.
 *
 * Under the owner's rule a waiting line takes nothing from stock until it is
 * marked ready. The milk for it is still on the books -- and, as far as the
 * next customer is concerned, already spoken for. Every place that decides
 * what can still be made, bought, moved or counted takes this away from the
 * book figure; places that record what physically happened (a write-off, a
 * receipt, a count being posted, a valuation) keep the book figure.
 *
 * Read fresh each time, from the recipe as it is now -- the same recipe the
 * ready tap will take -- so a tap lowers the book and the hold together and
 * what is available does not jump.
 */

/** A line that waits at a screen and has not taken its ingredients yet. */
export const WAITING_LINE = { usageOnReady: true, usagePostedAt: null } satisfies Prisma.OrderItemWhereInput;

/** Orders whose waiting lines hold stock. A voided order's lines will never be made. */
export const HOLDING_STATUSES = ['PAID', 'COMPLETED'] as const;

/** branchId -> rawMaterialId -> quantity held. */
export type HeldMap = Map<string, Map<string, number>>;

type Db = Pick<Prisma.TransactionClient, 'orderItem' | 'bomItem' | 'variantBomItem' | 'modifierOption'>;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function heldUsage(
  db: Db,
  tenantId: string,
  /** The branches to look at; null for every branch of the shop. */
  branchIds: string[] | null,
  opts: { rawMaterialIds?: string[]; excludeOrderId?: string } = {},
): Promise<HeldMap> {
  const held: HeldMap = new Map();
  if (branchIds && branchIds.length === 0) return held;

  const lines = await db.orderItem.findMany({
    where: {
      ...WAITING_LINE,
      order: {
        tenantId,
        deletedAt: null,
        status: { in: [...HOLDING_STATUSES] },
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(opts.excludeOrderId ? { id: { not: opts.excludeOrderId } } : {}),
      },
    },
    select: {
      productId: true, variantId: true, quantity: true, refundedQty: true,
      modifiers: { select: { modifierOptionId: true } },
      order: { select: { branchId: true } },
    },
  });
  const live = lines.filter((l) => Number(l.quantity) - Number(l.refundedQty) > 1e-9);
  if (live.length === 0) return held;

  const only = opts.rawMaterialIds ? new Set(opts.rawMaterialIds) : null;
  const usageOf = await loadLineRecipes(db, tenantId, live);
  for (const line of live) {
    const units = Number(line.quantity) - Number(line.refundedQty);
    const branch = held.get(line.order.branchId) ?? new Map<string, number>();
    for (const u of usageOf(line)) {
      if (only && !only.has(u.rawMaterialId)) continue;
      branch.set(u.rawMaterialId, round4((branch.get(u.rawMaterialId) ?? 0) + u.perUnit * units));
    }
    held.set(line.order.branchId, branch);
  }
  return held;
}

/** What is held of one ingredient at one branch. */
export function heldAt(held: HeldMap, branchId: string, rawMaterialId: string): number {
  return held.get(branchId)?.get(rawMaterialId) ?? 0;
}

/** Everything held of one ingredient, across the branches in the map. */
export function heldAcross(held: HeldMap, rawMaterialId: string): number {
  let total = 0;
  for (const b of held.values()) total += b.get(rawMaterialId) ?? 0;
  return round4(total);
}

/** On hand less what waiting tickets hold, never below zero. */
export function availableQty(onHand: number, heldQty: number): number {
  return Math.max(0, round4(onHand - heldQty));
}
