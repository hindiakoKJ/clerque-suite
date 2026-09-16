import { Prisma } from '@prisma/client';
import { HOLDING_STATUSES } from '../orders/held-usage';
import { loadLineRecipes } from '../orders/line-recipes';

/**
 * What waiting kitchen/bar tickets let go of, since a count was opened,
 * without ever being made.
 *
 * A count opened while tickets wait expects the shelf short by what they hold
 * (startCycleCount, and a buy list's count). A ticket marked ready afterwards
 * takes its share off the book, and posting applies the variance to the live
 * figure, so that one is settled. A ticket voided or refunded instead was
 * never made: nothing leaves the book, and nothing left the shelf -- yet the
 * snapshot still has its share taken off. Posting the snapshot as it stands
 * books that share as stock found. This is that share, per ingredient, for
 * the post to hand back to what the count expected.
 *
 * Only a ticket that was holding when the count opened counts: paid before,
 * not yet marked ready, on an order still to be made. What it let go of:
 *   - voided since while still waiting: everything it held then;
 *   - refunded since: the refunded units, and only those refunded before it
 *     was marked ready -- a refund after that is of something that was made.
 *
 * Read from the recipe as it is now, the same recipe the hold is read from.
 */

/** rawMaterialId -> quantity no longer held. */
export type ReleasedMap = Map<string, number>;

type Db = Pick<Prisma.TransactionClient, 'orderItem' | 'bomItem' | 'variantBomItem' | 'modifierOption'>;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function releasedHolds(
  db: Db,
  tenantId: string,
  branchId: string,
  rawMaterialIds: string[],
  /** When the count was opened: the moment its expected figures were taken. */
  since: Date,
): Promise<ReleasedMap> {
  const released: ReleasedMap = new Map();
  if (rawMaterialIds.length === 0) return released;

  // The database narrows to likely lines; the rules themselves are applied below, in one place.
  const lines = await db.orderItem.findMany({
    where: {
      usageOnReady: true,
      OR: [{ usagePostedAt: null }, { usagePostedAt: { gte: since } }],
      order: {
        tenantId, branchId, deletedAt: null,
        paidAt: { lt: since },
        status: { in: [...HOLDING_STATUSES, 'VOIDED'] },
      },
      AND: [{
        OR: [
          { order: { voidedAt: { gte: since } } },
          { refunds: { some: { createdAt: { gte: since } } } },
        ],
      }],
    },
    select: {
      productId: true, variantId: true, quantity: true, usagePostedAt: true,
      modifiers: { select: { modifierOptionId: true } },
      order:     { select: { status: true, voidedAt: true } },
      refunds:   { select: { quantity: true, createdAt: true } },
    },
  });

  const start = since.getTime();
  const units = new Map<(typeof lines)[number], number>();
  for (const line of lines) {
    // Already marked ready when the count opened: it held nothing then.
    if (line.usagePostedAt && line.usagePostedAt.getTime() < start) continue;
    const voided = line.order.status === 'VOIDED';
    // Voided before the count opened: it held nothing then either.
    if (voided && !(line.order.voidedAt && line.order.voidedAt.getTime() >= start)) continue;

    const refundedBefore = line.refunds
      .filter((r) => r.createdAt.getTime() < start)
      .reduce((t, r) => t + Number(r.quantity), 0);
    const heldThen = round4(Number(line.quantity) - refundedBefore);
    if (heldThen <= 1e-9) continue;

    let gone: number;
    if (voided && !line.usagePostedAt) {
      gone = heldThen;
    } else {
      const readyAt = line.usagePostedAt ? line.usagePostedAt.getTime() : Infinity;
      gone = line.refunds
        .filter((r) => r.createdAt.getTime() >= start && r.createdAt.getTime() < readyAt)
        .reduce((t, r) => t + Number(r.quantity), 0);
    }
    gone = round4(Math.min(gone, heldThen));
    if (gone > 1e-9) units.set(line, gone);
  }
  if (units.size === 0) return released;

  const only = new Set(rawMaterialIds);
  const usageOf = await loadLineRecipes(db, tenantId, [...units.keys()]);
  for (const [line, gone] of units) {
    for (const u of usageOf(line)) {
      if (!only.has(u.rawMaterialId)) continue;
      released.set(u.rawMaterialId, round4((released.get(u.rawMaterialId) ?? 0) + u.perUnit * gone));
    }
  }
  return released;
}
