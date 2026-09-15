import type { Prisma } from '@prisma/client';

/**
 * A line the kitchen or bar has to mark ready: its product's category goes to
 * an active station that has a screen.
 *
 * Every other line -- a category routed nowhere, or to a station that only
 * prints -- is done at the till. Nothing can ever bump it, so it must never
 * hold an order at "Preparing". The sale, the station screen and a refund all
 * decide "does this order still wait?" with this one filter.
 */
export const WAITS_AT_A_SCREEN = { category: { station: { hasKds: true, isActive: true } } } satisfies Prisma.ProductWhereInput;

/** Whether a category's station makes a line wait for the kitchen or bar. */
export function waitsAtAScreen(category: { stationId?: string | null; station?: { hasKds: boolean; isActive: boolean } | null } | null | undefined): boolean {
  return !!category?.stationId && category.station?.hasKds === true && category.station.isActive === true;
}

/** Of these lines, how many still have something left to make. A fully refunded line has nothing. */
export function stillToMake(lines: Array<{ quantity: unknown; refundedQty: unknown }>): number {
  return lines.filter((l) => Number(l.quantity) - Number(l.refundedQty) > 1e-9).length;
}
