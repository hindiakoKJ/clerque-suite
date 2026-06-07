/**
 * Compute the StickerTier for a given lot:
 *   - USE_FIRST     — soonest-expiring ACTIVE lot of its rawMaterial in
 *                     its branch. Owner prints a yellow/inverted sticker;
 *                     cook grabs this one first.
 *   - EXPIRING_SOON — ≤ 3 days to expiry but not the soonest. Visual
 *                     escalation; usually means "consume in next 1-2 days".
 *   - EXPIRED       — past expiry. Should be written off, not used.
 *   - NORMAL        — everything else. Plain sticker.
 *
 * Called by:
 *   - batchReceive() — recomputes tiers across all ACTIVE lots of the
 *     same rawMaterial when a new lot lands.
 *   - daily 3 AM cron — reassesses all ACTIVE lots, flips tiers if days-
 *     to-expiry crossed a threshold, marks stickerLastPrintedAt < now()
 *     as "needs reprint" for the owner.
 */
import type { PrismaService } from '../prisma/prisma.service';
import { StickerTier } from '@prisma/client';

const EXPIRING_SOON_DAYS = 3;

export interface LotForTier {
  id:             string;
  rawMaterialId:  string;
  branchId:       string;
  expirationDate: Date | null;
  qtyRemaining:   number;
}

/** Pure function — given a lot's position in the FEFO order and its
 *  expirationDate, return the tier. No DB access. */
export function tierForLot(
  isSoonestExpiring: boolean,
  expirationDate:    Date | null,
  now:               Date = new Date(),
): StickerTier {
  if (!expirationDate) {
    // Non-perishable; only "USE_FIRST" hint matters in FEFO order.
    return isSoonestExpiring ? StickerTier.USE_FIRST : StickerTier.NORMAL;
  }
  const msToExpiry = expirationDate.getTime() - now.getTime();
  if (msToExpiry < 0) return StickerTier.EXPIRED;
  const daysToExpiry = msToExpiry / (24 * 60 * 60 * 1000);
  if (isSoonestExpiring) return StickerTier.USE_FIRST;
  if (daysToExpiry <= EXPIRING_SOON_DAYS) return StickerTier.EXPIRING_SOON;
  return StickerTier.NORMAL;
}

/**
 * Recompute tier for every ACTIVE lot of a given (rawMaterialId, branchId).
 * Cheap enough to call after every batchReceive — the FEFO sort across
 * a tenant's active lots of a single ingredient is rarely > 20 rows.
 *
 * Sets `stickerLastPrintedAt` to NULL on any lot whose tier changed —
 * the UI then surfaces a "needs reprint" badge for those lots.
 *
 * @returns rows whose tier changed (so the API can return them to the UI
 *          for the print queue).
 */
export async function recomputeStickerTiersForItem(
  prisma:        PrismaService,
  rawMaterialId: string,
  branchId:      string,
  now:           Date = new Date(),
): Promise<{ id: string; oldTier: StickerTier | null; newTier: StickerTier }[]> {
  const lots = await prisma.rawMaterialLot.findMany({
    where: {
      rawMaterialId,
      branchId,
      qtyRemaining: { gt: 0 },
    },
    select: {
      id: true,
      expirationDate: true,
      stickerTier: true,
      qtyRemaining: true,
    },
    // FEFO: soonest expiry first; null expiry last; receivedAt break tie.
    orderBy: [{ expirationDate: 'asc' }, { receivedAt: 'asc' }],
  });

  if (lots.length === 0) return [];

  // First non-null-expiry lot is the soonest-expiring perishable.
  // If all are null-expiry, the first row by receivedAt is "USE_FIRST".
  const firstPerishableIndex = lots.findIndex((l) => l.expirationDate !== null);
  const soonestIndex = firstPerishableIndex === -1 ? 0 : firstPerishableIndex;

  const changes: { id: string; oldTier: StickerTier | null; newTier: StickerTier }[] = [];
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    const isSoonest = i === soonestIndex;
    const newTier   = tierForLot(isSoonest, lot.expirationDate, now);
    if (newTier !== lot.stickerTier) {
      await prisma.rawMaterialLot.update({
        where: { id: lot.id },
        data:  {
          stickerTier: newTier,
          // Clear the print timestamp so the UI surfaces it for reprint.
          stickerLastPrintedAt: null,
        },
      });
      changes.push({ id: lot.id, oldTier: lot.stickerTier, newTier });
    }
  }
  return changes;
}

export const stickerTierConfig = {
  EXPIRING_SOON_DAYS,
};
