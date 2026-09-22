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
 * The lists to ask about when a receipt is started with no list picked: every
 * one of them, in one question.
 *
 * Shopping already saved as bought comes first (posting a receipt beside it
 * would put the same goods on the shelf twice), then the lists sent out for
 * buying; newest first within each, as the API sends them. An order still on
 * the way is not offered: a grocery receipt today is not the parcel.
 *
 * It used to ask about ONE list at a time -- "Is this the shopping for
 * REQ-…?" -- with no way to say "none of them". A shop with sixteen lists
 * waiting took sixteen taps before the form could be used, and the next
 * receipt asked all sixteen again.
 *
 * `declined` is what the person has already said "none of these" to. The
 * question comes back only when a list they have NOT been asked about turns
 * up, and then it shows every waiting list again, so the choice is complete.
 */
export function listsToAsk<T extends WaitingList>(lists: readonly T[], declined: readonly string[] = []): T[] {
  const waiting = lists.filter((r) => r.lines.some((l) => !l.receivedAt));
  const offered = [
    ...waiting.filter((r) => r.status === 'BOUGHT' && readTag(r.notes, 'ONTHEWAY') == null),
    ...waiting.filter((r) => r.status === 'SENT'),
  ];
  return offered.some((r) => !declined.includes(r.id)) ? offered : [];
}

/** "Sugar", "Sugar and Milk", "Sugar, Milk and Ice", "Sugar, Milk, Ice and 2 more". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/** The question above the choices, in words for whoever is holding the receipt. */
export const ASK_QUESTION = 'Is this receipt for a list that is already waiting?';
export const ASK_DETAIL   = 'If yes, tap the list: the receipt goes onto it, so nothing is added twice.';
export const ASK_NONE     = 'None of these — it is a separate trip';

/** One choice in the question: the list's number, where it is up to, and what is on it. */
export function askChoice(list: WaitingList): { label: string; detail: string } {
  const names = [...new Set(
    list.lines.filter((l) => !l.receivedAt).map((l) => l.rawMaterial?.name).filter((n): n is string => !!n),
  )];
  const what = list.status === 'BOUGHT' ? 'Saved as bought, not in stock yet' : 'Sent out for buying';
  return {
    label:  list.requestNumber,
    detail: `${what}${names.length ? `: ${nameList(names)}` : ''}`,
  };
}

/**
 * A cost per gram, millilitre or piece, with its unit: "₱0.098 / ml".
 *
 * Two decimals turned ₱0.098 into "₱0.10" and ₱0.0049 into "₱0.00"; a cost per
 * gram lives in its third and fourth decimals. Never fewer than two, so a
 * whole-peso cost still reads as money.
 */
export function unitCostText(unitCost: number, unit?: string | null): string {
  const n = Number.isFinite(unitCost) ? unitCost : 0;
  const money = `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return unit ? `${money} / ${unit}` : money;
}

/**
 * What stops a receipt with nothing marked as bought, in words that say what
 * to tap. A receipt opened on a sent list starts with every line on Skip (the
 * boxes are a head start, not a claim it was bought), and "Add at least one
 * line" was the wrong thing to say to somebody looking at twelve of them.
 */
export function nothingToPostText(rows: ReadonlyArray<{ kind: 'stock' | 'expense' | 'skip' }>): string | null {
  if (!rows.every((r) => r.kind === 'skip')) return null;
  return rows.length === 0
    ? 'Add at least one line.'
    : 'Every line is on Skip. Tap "Goes on the shelf" on what was bought.';
}

/**
 * The ingredients whose names share a word with what is printed on the
 * receipt line, best first, for the top of the "Which ingredient is this?"
 * picker.
 *
 * The reader fills that "Closest" group when it reads a photo. A line typed
 * by hand (the only way in when the reader is off) had nothing there, so the
 * person scrolled a list of every ingredient the shop has -- hundreds, on a
 * phone -- for each line. Words shorter than three letters are ignored; a
 * word matches when one starts with the other ("choc" finds "Chocolate").
 */
export function closestByName<T extends { name: string }>(text: string, items: readonly T[], max = 5): T[] {
  const words = (s: string) =>
    s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  const want = words(text);
  if (want.length === 0) return [];
  return items
    .map((it) => {
      const have = words(it.name);
      const score = want.filter((w) => have.some((h) => h.startsWith(w) || w.startsWith(h))).length;
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name))
    .slice(0, max)
    .map((x) => x.it);
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
