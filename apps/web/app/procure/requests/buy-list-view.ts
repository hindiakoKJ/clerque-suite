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
 * The tick a line starts with before anyone touches it. A recorded line starts
 * ticked, so "Add it all to stock" posts the shopping in one tap -- except on
 * an order that is on the way, where the person ticks what is in the box.
 * Otherwise a list that mixes a grocery run with a Shopee order posts the
 * parcel along with the milk.
 */
export const startsTicked = (line: { packsBought: unknown }, onTheWay: boolean): boolean =>
  line.packsBought != null && !onTheWay;

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
