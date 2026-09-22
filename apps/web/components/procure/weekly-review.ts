/**
 * The owner's review of a weekly count: the words on the status strip, the
 * station strip, each line's second line, the filters, and what "Adjust the
 * books to match" will and will not touch -- said BEFORE it is tapped. Pure,
 * so Node's own test runner checks it:
 *   cd apps/web && node --test components/procure/weekly-review.spec.mjs
 *
 * A weekly count is a record of what the shelf held (status RECORDED). Stock
 * and the books move only when the owner adjusts them from it, and a line
 * counted again later (by the other station, or a recount) is left alone.
 *
 * Self-contained, like every helper Node's runner loads here.
 */

/** Below this a difference is a match: the same threshold posting uses. */
export const MATCH = 0.001;

export interface ReviewLineInfo {
  rawMaterialId: string;
  name: string;
  difference: number;
  inPacks: string | null;
  countedBy: string | null;
  countedAt: string | null;
  superseded: string | null;
  /** Other open counts of the branch holding the same item (a buy list's, or one started on the counts screen). */
  alsoOpenIn?: string[];
}

export interface ReviewStationInfo {
  name: string;
  sentAt: string | null;
  countedBy: string | null;
  counted: number;
  total: number;
}

export type LineTone = 'short' | 'over' | 'match';

export function lineTone(difference: number): LineTone {
  if (Math.abs(difference) < MATCH) return 'match';
  return difference < 0 ? 'short' : 'over';
}

/** "Sep 21 9:12 PM" on the shop's clock. */
export function manilaStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/**
 * The strip under the title: what this count is, for the books.
 *   RECORDED  "Recorded Sep 21 9:12 PM by Joy (Kitchen). Stock and the books have not changed."
 *   POSTED    "Books adjusted Sep 22 10:05 AM by Anne. Stock moved by the difference this count found."
 *   OPEN      "Kitchen is still counting. Nothing is recorded yet."
 * Anything else is named as it comes.
 */
export function reviewStatusLine(view: {
  status: string; stations: ReviewStationInfo[]; postedAt: string | null; postedBy: string | null;
}): string {
  const st = view.stations[0];
  const where = view.stations.map((s) => s.name).filter(Boolean).join(', ');
  switch (view.status) {
    case 'RECORDED': {
      const when = manilaStamp(st?.sentAt);
      const who = st?.countedBy ? ` by ${st.countedBy}` : '';
      return `Recorded${when ? ` ${when}` : ''}${who}${where ? ` (${where})` : ''}. Stock and the books have not changed.`;
    }
    case 'POSTED': {
      const when = manilaStamp(view.postedAt);
      return `Books adjusted${when ? ` ${when}` : ''}${view.postedBy ? ` by ${view.postedBy}` : ''}. Stock moved by the difference this count found.`;
    }
    case 'OPEN':
      return `${where || 'The station'} is still counting. Nothing is recorded yet.`;
    case 'CANCELLED':
      return 'Cancelled. Nothing was changed.';
    default:
      return `Status: ${String(view.status ?? '').toLowerCase() || 'unknown'}.`;
  }
}

/**
 * "Kitchen: sent by Joy, Sep 21 9:12 PM · 23 of 25" or "Bar: not sent yet".
 * A count left open for days and kept as a record was never sent, and can no
 * longer be: "Kitchen: never sent (kept as a record) · 20 of 25".
 */
export function stationStrip(s: ReviewStationInfo, status?: string): string {
  if (!s.sentAt) {
    return status && status !== 'OPEN' ? `${s.name}: never sent (kept as a record) · ${s.counted} of ${s.total}` : `${s.name}: not sent yet`;
  }
  const who = s.countedBy ? ` by ${s.countedBy}` : '';
  return `${s.name}: sent${who}, ${manilaStamp(s.sentAt)} · ${s.counted} of ${s.total}`;
}

/** The muted line under each sentence: "2 pk + 100 ml · Kitchen screen (Joy) · Sep 21 9:05 PM". */
export function countedLine(l: ReviewLineInfo): string {
  return [l.inPacks, l.countedBy, manilaStamp(l.countedAt)].filter(Boolean).join(' · ');
}

export type ReviewFilter = 'differ' | 'all' | 'missing';

/** Differences first (the default): what the owner is here for. */
export function linesFor<L extends ReviewLineInfo>(lines: L[], filter: ReviewFilter): L[] {
  if (filter === 'differ') return lines.filter((l) => lineTone(l.difference) !== 'match');
  if (filter === 'all') return lines;
  return [];
}

const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/**
 * What "Adjust the books to match" will do, in the owner's words, and whether
 * there is anything for it to do. The server decides the same way: a line
 * counted again later is skipped, a match moves nothing.
 *
 * Adjusting moves today's stock by the difference the count found; it does
 * not set it to the counted figure, so the sales since the count are kept.
 *
 * An item that will move and is also on another open count (a buy list's)
 * is named, with that count to post first. Posted first, whichever of the
 * two counted the item later sets it and the other leaves it alone (newest
 * count wins, warehouse newer-count.ts). Adjusted first, this record sets it
 * even where that count counted it later, and that count's later figure is
 * lost.
 */
export function adjustPlan(lines: ReviewLineInfo[], recountAsked: string[]): {
  move: number; leftAlone: number; waiting: number; nothing: boolean; notes: string[];
} {
  const standing = lines.filter((l) => !l.superseded);
  const move = standing.filter((l) => lineTone(l.difference) !== 'match').length;
  const leftAlone = lines.length - standing.length;
  const asked = new Set(recountAsked);
  const waiting = standing.filter((l) => asked.has(l.rawMaterialId) || asked.has(l.name)).length;
  const notes: string[] = [];
  if (move > 0) notes.push(`${items(move)} will move by the difference this count found (sales since the count are kept).`);
  if (leftAlone > 0) notes.push(`${items(leftAlone)} ${leftAlone === 1 ? 'was' : 'were'} counted again later and ${leftAlone === 1 ? 'is' : 'are'} left alone.`);
  if (waiting > 0) notes.push(`${items(waiting)} ${waiting === 1 ? 'is' : 'are'} waiting for a recount. Adjusting now uses this count for ${waiting === 1 ? 'it' : 'them'}.`);
  const onOpen = standing.filter((l) => lineTone(l.difference) !== 'match' && (l.alsoOpenIn?.length ?? 0) > 0);
  if (onOpen.length > 0) {
    const counts = [...new Set(onOpen.flatMap((l) => l.alsoOpenIn ?? []))];
    const one = onOpen.length === 1;
    const oneCount = counts.length === 1;
    notes.push(`${onOpen.map((l) => l.name).join(', ')} ${one ? 'is' : 'are'} also on open count ${counts.join(', ')}. `
      + `Post ${oneCount ? 'that count' : 'those counts'} first, so the ${oneCount ? 'newer' : 'newest'} count${one ? '' : ' of each'} sets it.`);
  }
  return { move, leftAlone, waiting, nothing: move === 0, notes };
}

/** The toast after adjusting. */
export function adjustedMessage(adjusted: number, skipped: string[]): string {
  const moved = adjusted === 0 ? 'Nothing needed to change.' : `Books adjusted: ${items(adjusted)} moved by the counted difference.`;
  return skipped.length ? `${moved} Left alone (counted again later): ${skipped.join(', ')}.` : moved;
}
