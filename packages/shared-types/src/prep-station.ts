/**
 * Every pre-made item at one station, for the screen the bar or kitchen looks
 * at during service -- and the use-by dates on its batches.
 *
 * The rotation (prep-rotation.ts) says what to do about the ready-to-use
 * sauces. This adds what it does not cover: the parked and in-between stages
 * as items of their own, and batches that are past their use-by or about to
 * be. Pure, so the station screen and the alert say the same thing.
 *
 * How much of a batch is still on the shelf is an estimate. A batch writes a
 * lot with its use-by date; a sale takes from the item's stock without saying
 * which batch it came out of. What is on hand is therefore read as the newest
 * batches -- the oldest used first, the way a kitchen is meant to work -- and
 * never as more than is on hand.
 */

import type { RotationRow } from './prep-rotation';

/** One batch (stock lot) of a prep, as stored. */
export interface PrepLot {
  id: string;
  rawMaterialId: string;
  qtyRemaining: number;
  receivedAt: Date | string;
  expirationDate: Date | string | null;
}

export interface UseBy {
  /** Past its use-by: about how much, and the earliest date among those batches. */
  expired: { qty: number; at: string; lotIds: string[] } | null;
  /** Use-by within the window: about how much, and the soonest date. */
  soon: { qty: number; at: string; lotIds: string[] } | null;
}

const ms = (d: Date | string) => new Date(d).getTime();
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * What of each batch is taken to be still here: on hand, filled from the
 * newest batch back. A batch with nothing left of it is not listed.
 */
export function lotsStillHere(onHand: number, lots: PrepLot[]): Array<{ lot: PrepLot; qty: number }> {
  let left = Math.max(0, onHand);
  const out: Array<{ lot: PrepLot; qty: number }> = [];
  for (const lot of [...lots].sort((a, b) => ms(b.receivedAt) - ms(a.receivedAt))) {
    if (left <= 1e-9) break;
    const qty = Math.min(left, Math.max(0, lot.qtyRemaining));
    if (qty > 1e-9) out.push({ lot, qty: round(qty) });
    left -= qty;
  }
  return out;
}

/** Past its use-by, and due within `soonHours`, from the batches still here. */
export function useByOf(onHand: number, lots: PrepLot[], now: Date, soonHours = 24): UseBy {
  const t = now.getTime();
  const horizon = t + soonHours * 3_600_000;
  const pick = (test: (at: number) => boolean) => {
    const hit = lotsStillHere(onHand, lots).filter(({ lot }) => lot.expirationDate != null && test(ms(lot.expirationDate)));
    if (hit.length === 0) return null;
    const at = Math.min(...hit.map(({ lot }) => ms(lot.expirationDate!)));
    return { qty: round(hit.reduce((s, h) => s + h.qty, 0)), at: new Date(at).toISOString(), lotIds: hit.map((h) => h.lot.id) };
  };
  return { expired: pick((at) => at <= t), soon: pick((at) => at > t && at <= horizon) };
}

/**
 *   EXPIRED  some of it is past its use-by
 *   OUT      none on hand
 *   DO_NOW   the rotation says move, make or buy now (a ready-to-use item at or below par)
 *   SOON     some of it is due within the window
 *   LOW      at or below its own par (a parked or in-between stage)
 *   OK       nothing to do
 *   NO_PAR   no par level: shown, never warned about
 */
export type PrepStatus = 'EXPIRED' | 'OUT' | 'DO_NOW' | 'SOON' | 'LOW' | 'OK' | 'NO_PAR';

export const PREP_STATUS_ORDER: Record<PrepStatus, number> = { EXPIRED: 0, OUT: 1, DO_NOW: 2, SOON: 3, LOW: 4, OK: 5, NO_PAR: 6 };

export function prepStatusOf(item: { onHand: number; parLevel: number | null }, rotation: RotationRow | null, useBy: UseBy): PrepStatus {
  if (useBy.expired) return 'EXPIRED';
  if (item.onHand <= 0 && (item.parLevel != null || rotation)) return 'OUT';
  if (rotation && (rotation.state === 'TOP_UP' || rotation.state === 'COOK_NOW')) return 'DO_NOW';
  if (useBy.soon) return 'SOON';
  if (item.parLevel != null && item.onHand <= item.parLevel) return 'LOW';
  if (item.parLevel == null && !rotation) return item.onHand <= 0 ? 'OUT' : 'NO_PAR';
  if (item.parLevel == null) return 'NO_PAR';
  return 'OK';
}

/** For the chip on a tile. */
export const PREP_STATUS_LABEL: Record<PrepStatus, string> = {
  EXPIRED: 'Past use-by',
  OUT:     'Out',
  DO_NOW:  'Do now',
  SOON:    'Use first',
  LOW:     'Low',
  OK:      'OK',
  NO_PAR:  'No par set',
};

function amount(n: number, unit: string): string {
  return `${Math.max(0, n).toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${unit}`;
}

/** "Sep 14, 2:00 PM", or "2:00 PM" when it is today, in Manila. */
export function useByWhen(at: string, now: Date): string {
  const day = (d: Date) => d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
  const time = new Date(at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  return day(new Date(at)) === day(now)
    ? time
    : `${new Date(at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })}, ${time}`;
}

/** "About 400 g past its use-by (2:00 PM)." / "About 400 g to use by 6:00 PM." Null when neither. */
export function useBySentences(useBy: UseBy, unit: string, now: Date): string[] {
  const out: string[] = [];
  if (useBy.expired) out.push(`About ${amount(useBy.expired.qty, unit)} past its use-by (${useByWhen(useBy.expired.at, now)}).`);
  if (useBy.soon) out.push(`About ${amount(useBy.soon.qty, unit)} to use by ${useByWhen(useBy.soon.at, now)}.`);
  return out;
}

/** The bell alert for a batch past its use-by or about to be. */
export function useByAlertTitle(name: string, useBy: UseBy, where = ''): string | null {
  if (useBy.expired) return `${name}${where}: past its use-by`;
  if (useBy.soon) return `${name}${where}: use it first`;
  return null;
}
