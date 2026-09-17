/**
 * Which list a receipt belongs to, and which day it carries.
 *
 * Kept free of React so it can be tested on its own:
 *   cd apps/web && node --test app/procure/receipts/receipt-list.spec.mjs
 */

/*
  The tags the server writes at the FRONT of a request's notes
  ([ONTHEWAY:date], [PREPAID:pocket], ...). Only that front run is read, the
  same way the API reads it, so a person's own words are never taken as one.
*/
const HEAD = /^(?:\s*\[[A-Z]+:[^\]]*\])+/;
const TAG  = /\[([A-Z]+):([^\]]*)\]/g;

export function readTag(notes: string | null | undefined, name: string): string | null {
  const head = HEAD.exec(notes ?? '')?.[0] ?? '';
  for (const m of head.matchAll(TAG)) if (m[1] === name) return m[2];
  return null;
}

/** A moment as the calendar day in Manila (YYYY-MM-DD), or null when it is not a date. */
export function manilaDay(at: Date | string): string | null {
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

/**
 * The receipt date a list starts the screen on.
 *
 * A list saved as bought carries the day it was bought -- read in Manila.
 * The API stores a typed "Bought on" day as Manila midnight, which is 16:00
 * UTC the day before, so cutting the stored value at "T" put every such
 * purchase one day early, and its stock and journal entries with it.
 *
 * An order still on the way is a different thing: whatever is posted from
 * it is arriving now, so it starts on today.
 */
export function receiptDateFor(
  request: { boughtAt?: string | null; notes?: string | null },
  today: string,
): string {
  if (readTag(request.notes, 'ONTHEWAY') != null) return today;
  if (!request.boughtAt) return today;
  return manilaDay(request.boughtAt) ?? today;
}

export interface WaitingList {
  id: string;
  requestNumber: string;
  status: string;
  notes?: string | null;
  lines: Array<{ receivedAt?: string | null; rawMaterial?: { name: string } | null }>;
}

/**
 * The list to ask about when a receipt is started with no list picked.
 *
 * Shopping already saved as bought comes first (posting a receipt beside it
 * would put the same goods on the shelf twice), then a list sent out for
 * buying. An order still on the way is not asked about: a grocery receipt
 * today is not the parcel. The lists come newest first, so the newest of
 * each kind is asked about first; a list the person said no to is not asked
 * about again.
 */
export function listToAsk<T extends WaitingList>(lists: readonly T[], declined: readonly string[] = []): T | null {
  const waiting = lists.filter((r) => !declined.includes(r.id) && r.lines.some((l) => !l.receivedAt));
  return waiting.find((r) => r.status === 'BOUGHT' && readTag(r.notes, 'ONTHEWAY') == null)
    ?? waiting.find((r) => r.status === 'SENT')
    ?? null;
}

/** "Sugar", "Sugar and Milk", "Sugar, Milk and Ice", "Sugar, Milk, Ice and 2 more". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/** The question, in words for whoever is holding the receipt. */
export function askText(list: WaitingList): { question: string; detail: string } {
  const names = [...new Set(
    list.lines.filter((l) => !l.receivedAt).map((l) => l.rawMaterial?.name).filter((n): n is string => !!n),
  )];
  const what = list.status === 'BOUGHT' ? 'That list is saved as bought but is not in stock yet' : 'That list was sent out for buying';
  return {
    question: `Is this the shopping for ${list.requestNumber}?`,
    detail:   `${what}${names.length ? `: ${nameList(names)}` : ''}. If yes, this receipt goes onto that list, so nothing is added twice.`,
  };
}

/** The parts of a screen row that decide where it lands. */
export interface LandableRow {
  kind: 'stock' | 'expense' | 'skip';
  rawMaterialId: string;
  createNew: boolean;
  description: string;
  packs: string;
  size: string;
  cost: string;
  brand: string;
  amount: string;
  fromLine: boolean;
}

/**
 * A list picked AFTER lines were already on screen (a photo read, lines
 * typed) must not throw that work away.
 *
 * The list's own rows come first. A line on screen for an ingredient the
 * list has lands on that row: the receipt's numbers are kept, except the
 * packs a shopper already recorded on the list, which a receipt reading does
 * not overwrite either. Everything else on screen stays below. An empty row
 * (the blank one a photo adds) is dropped.
 */
export function keepWorkOnList<R extends LandableRow>(
  listRows: R[],
  onScreen: readonly R[],
  recorded: (rawMaterialId: string) => boolean,
): R[] {
  const out = [...listRows];
  const leftover: R[] = [];
  for (const row of onScreen) {
    const work = row.description.trim() || row.rawMaterialId || row.amount.trim() || row.cost.trim();
    if (!work) continue;
    const idx = row.kind === 'stock' && !row.createNew && row.rawMaterialId
      ? out.findIndex((x, i) => i < listRows.length && x === listRows[i] && x.rawMaterialId === row.rawMaterialId)
      : -1;
    if (idx < 0) { leftover.push(row); continue; }
    const hit = out[idx];
    out[idx] = {
      ...row,
      kind:     'stock',
      packs:    recorded(row.rawMaterialId) ? hit.packs : row.packs,
      size:     row.size || hit.size,
      cost:     row.cost || hit.cost,
      brand:    row.brand || hit.brand,
      fromLine: true,
    };
  }
  return [...out, ...leftover];
}
