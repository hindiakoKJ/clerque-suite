/**
 * Small rules for what the Buy list screen shows, kept apart from the page so
 * Node's own test runner can check them (see buy-list-view.spec.mjs).
 */

/** A list somebody still has to act on: being built, sent, or bought and not yet in stock. */
export const isStillOpen = (status: string) => status !== 'RECEIVED' && status !== 'CANCELLED';

/**
 * The request chips above the list: every still-open list first (newest first,
 * as the API sends them), then the finished ones, cut to `max`.
 *
 * Cutting the newest eight used to push a Shopee order that was still on the
 * way off the chips once eight newer lists had been made, and then nobody could
 * open it on the day the parcel came.
 */
export function chipsInOrder<T extends { status: string }>(all: T[], max = 8): T[] {
  const open = all.filter((r) => isStillOpen(r.status));
  const done = all.filter((r) => !isStillOpen(r.status));
  return [...open, ...done].slice(0, max);
}

/**
 * Which still-open list the screen opens on, from `live` (newest first).
 *
 * The owner or manager: a delivery waiting to be posted, then shopping waiting
 * to be recorded, then the list being built, then an order still on the way.
 *
 * Staff: the list being built, when there is one. Their part is adding what is
 * short and saving a walk-in buy, and both happen on that list. Most days a
 * sent list exists (the kitchen's tap or the closing job sent it), so opening
 * on it hid Add behind a small "Building" chip.
 */
export function listToOpen<T extends { status: string }>(
  live: T[],
  staff: boolean,
  isOnTheWay: (r: T) => boolean,
): T | null {
  const open = live.find((r) => r.status === 'OPEN');
  if (staff && open) return open;
  return live.find((r) => r.status === 'BOUGHT' && !isOnTheWay(r))
    ?? live.find((r) => r.status === 'SENT')
    ?? open
    ?? live.find((r) => r.status === 'BOUGHT')
    ?? null;
}

/**
 * The tick a line starts with before anyone touches it. A recorded line starts
 * ticked, so "Add it all to stock" posts the shopping in one tap -- except on
 * an order that is on the way, where the person ticks what is in the box.
 * Otherwise a list that mixes a grocery run with a Shopee order posts the
 * parcel along with the milk.
 */
export const startsTicked = (line: { packsBought: unknown }, onTheWay: boolean): boolean =>
  line.packsBought != null && !onTheWay;

/**
 * A line just added through "Record something you bought" starts ticked, so
 * its packs and price boxes are already open: it was bought, that is why it
 * was added. Only until something is recorded on it.
 */
export const startsTickedAsWalkIn = (
  line: { rawMaterialId: string; packsBought: unknown; receivedAt: unknown },
  walkInItems: ReadonlySet<string>,
): boolean => walkInItems.has(line.rawMaterialId) && line.packsBought == null && line.receivedAt == null;

/**
 * Whether somebody allowed to record what was bought can do it on a list at
 * this status. An open list too (KJ, 2026-09-17): a barista's walk-in buy is
 * saved without waiting for the owner's Send, and saving it sends the list.
 * The server says the same (ProcureService.recordBought).
 */
export const recordsOn = (status: string): boolean =>
  status === 'OPEN' || status === 'SENT' || status === 'BOUGHT';

/**
 * Whether the Packs / size / price boxes show: on a sent or bought list,
 * always; on an open list, only once something is ticked as bought. An open
 * list is still being built through the day, and a row of boxes under every
 * line would bury the list people are adding to.
 */
export const showsRecordBoxes = (status: string, ticked: boolean): boolean =>
  status !== 'OPEN' || ticked;

// ── a shop that hides purchase costs from staff (KJ, 2026-09-21) ─────────────

/**
 * What the boxes ask staff to fill in. Staff on a shop that hides purchase
 * costs never see a price box: they record packs and what one holds, and the
 * server prices it from last time for the owner to check.
 */
export const fillInWords = (withPrice: boolean): string => (withPrice ? 'packs and price' : 'packs');

/**
 * What a row being saved still needs, in the words the Save shows, or null
 * when it is complete. Only whoever sees costs is asked for a price.
 */
export function stillNeeds(
  row: { packsBought: number; packSize: number; packCost?: number },
  withPrice: boolean,
): string | null {
  const complete = row.packsBought > 0 && row.packSize > 0 && (!withPrice || (row.packCost ?? 0) > 0);
  if (complete) return null;
  return withPrice ? 'fill in packs, what one holds, and the price.' : 'fill in packs and what one holds.';
}

/**
 * The lines staff recorded without a price that the server priced from last
 * time: the request's [LASTPRICE:<line ids>] tag (ProcureService.recordBought).
 * Ids only; a price saved by the owner takes its line off.
 */
export function lastPricedLines(notes: string | null | undefined): Set<string> {
  const m = /\[LASTPRICE:([^\]]*)\]/.exec(notes ?? '');
  return new Set((m?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * What the owner is told about the price on a bought line not yet in stock:
 * nothing, when somebody who sees costs typed it; a nudge to check it when it
 * is last time's; and that it is missing when there was no last time.
 */
export function priceCheck(
  line: { id: string; packsBought: unknown; packCost: unknown; receivedAt: unknown },
  lastPriced: ReadonlySet<string>,
): string | null {
  if (line.receivedAt != null || line.packsBought == null) return null;
  if (line.packCost == null) return 'No price yet — add it from the receipt before posting.';
  if (lastPriced.has(line.id)) return 'Price from last purchase — check the receipt.';
  return null;
}

/**
 * The first line about to be posted with no price, saved or typed now. The
 * server refuses it too; asking here keeps the rest of the post from going
 * ahead without it.
 */
export function firstWithoutPrice<T extends { packCost: unknown }>(
  posting: T[],
  typedCost: (l: T) => number | undefined,
): T | null {
  return posting.find((l) => !((typedCost(l) ?? Number(l.packCost ?? 0)) > 0)) ?? null;
}
