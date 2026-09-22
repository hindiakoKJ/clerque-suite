/**
 * The weekly count on a kitchen or bar screen: what the cook types (full packs
 * plus what is opened or loose), what that amount reads as, which item comes
 * next, and what each row's chip says. Pure, so Node's own test runner checks
 * it:
 *   cd apps/web && node --test components/pos/station-count.spec.mjs
 *
 * The count is a RECORD. Saving and sending never move the stock or the books;
 * the owner decides later whether to adjust the books to match. The form is
 * blind: the server never sends what the books say, so nothing here can show
 * it. Amounts only, no costs.
 *
 * Self-contained, like every helper Node's runner loads here: an import
 * without its extension does not load there, so the few lines it shares with
 * station-waste.ts (the pack wording) are written out again.
 */

/** The server's limit, and the 3 places the count column keeps. */
export const MAX_COUNT = 1_000_000;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * What the cook typed, as an amount. Zero is an answer here ("none left"),
 * unlike a waste amount. Blank, a minus, letters or two dots are not (null).
 */
export function parseCountAmount(text: string): number | null {
  const t = text.replace(/,/g, '').trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = round3(Number(t));
  return Number.isFinite(n) && n >= 0 && n <= MAX_COUNT ? n : null;
}

/** Full packs are whole: "3" reads, "2.5" does not (the half is loose). */
export function parsePacks(text: string): number | null {
  const t = text.replace(/,/g, '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_COUNT ? n : null;
}

/** The - and + beside Full packs. Never below zero; nonsense typed counts as nothing. */
export function stepPacks(text: string, by: 1 | -1): string {
  return String(Math.max(0, (parsePacks(text) ?? 0) + by));
}

export interface CountEntry { packs: string; loose: string }

const hasPacks = (packSize: number | null | undefined): packSize is number => packSize != null && packSize > 0;

/**
 * The amount Save sends: full packs times the pack size plus what is loose.
 * An item with no pack size has the one field (`loose`). Null until something
 * readable is typed; a blank field beside a typed one counts as zero.
 */
export function totalOf(entry: CountEntry, packSize: number | null): number | null {
  if (!hasPacks(packSize)) return parseCountAmount(entry.loose);
  const packsBlank = entry.packs.trim() === '';
  const looseBlank = entry.loose.trim() === '';
  if (packsBlank && looseBlank) return null;
  const packs = packsBlank ? 0 : parsePacks(entry.packs);
  const loose = looseBlank ? 0 : parseCountAmount(entry.loose);
  if (packs == null || loose == null) return null;
  const total = round3(packs * packSize + loose);
  return total <= MAX_COUNT ? total : null;
}

/** An amount back into the two fields, so a saved count opens ready to correct. */
export function splitPacks(qty: number | null, packSize: number | null): CountEntry {
  if (qty == null) return { packs: '', loose: '' };
  if (!hasPacks(packSize)) return { packs: '', loose: String(round3(qty)) };
  const packs = Math.floor(qty / packSize + 1e-9);
  const loose = round3(qty - packs * packSize);
  return { packs: String(packs), loose: loose > 0 ? String(loose) : '' };
}

/** "1,000" -- how an amount reads on the screen. */
export function countNumber(n: number): string {
  return n.toLocaleString('en-PH', { maximumFractionDigits: 3 });
}

/** "2 pk + 100 ml", "2 pk", or "350 g" below one pack or with no pack size. */
export function countWords(qty: number, unit: string, packSize: number | null): string {
  if (hasPacks(packSize) && qty >= packSize - 1e-9) {
    const { packs, loose } = splitPacks(qty, packSize);
    return `${packs} pk${loose ? ` + ${countNumber(Number(loose))} ${unit}` : ''}`;
  }
  return `${countNumber(qty)} ${unit}`;
}

/** The live line under the fields. */
export function liveLine(qty: number | null, unit: string, packSize: number | null): string | null {
  if (qty == null) return null;
  return qty === 0 ? 'None left.' : `That is ${countWords(qty, unit, packSize)}.`;
}

export const packsLabel = (packSize: number, unit: string) => `Full packs (${countNumber(packSize)} ${unit} each)`;
export const looseLabel = (unit: string) => `Opened or loose (${unit})`;
export const amountLabel = (unit: string) => `How much is there? (${unit})`;

// ─── Rows ────────────────────────────────────────────────────────────────────

/** Another station counted this item in the last 3 days; whoever counts it counts all of it in the shop. */
export interface OtherCount { station: string; words: string; at: string | null; message?: string | null }

export interface CountRowState {
  rawMaterialId: string;
  unit: string;
  packSize: number | null;
  counted: number | null;
  countedWords: string | null;
  recount: boolean;
  otherCount: OtherCount | null;
}

/**
 * Done for progress: this station counted it, or another station did lately
 * (unless the owner asked for it again). `hideOwn` is the moment after
 * "Count again": this station's sent figures belong to the record it sent, not
 * to the new count.
 */
export function isCounted(row: CountRowState, hideOwn = false): boolean {
  return (!hideOwn && row.counted != null) || (!row.recount && row.otherCount != null);
}

export function progressOf(rows: CountRowState[], hideOwn = false): { counted: number; total: number } {
  return { counted: rows.filter((r) => isCounted(r, hideOwn)).length, total: rows.length };
}

/** Where the panel opens: an item asked for again first, then the first one not counted, then the top. */
export function firstToCount(rows: CountRowState[], hideOwn = false): string | null {
  return (rows.find((r) => r.recount && (hideOwn || r.counted == null))
    ?? rows.find((r) => !isCounted(r, hideOwn))
    ?? rows[0])?.rawMaterialId ?? null;
}

/**
 * After Save: the next row down that is not counted yet, wrapping to the top.
 * An item the owner asked for again comes first while any is left, so a
 * recount goes from one asked-for item to the next. The one just saved is
 * never the answer, even before the screen has caught up with it. Null when
 * everything is counted.
 */
export function nextUncounted(rows: CountRowState[], currentId: string, hideOwn = false): string | null {
  const at = rows.findIndex((r) => r.rawMaterialId === currentId);
  const nextWhere = (wanted: (r: CountRowState) => boolean): string | null => {
    for (let step = 1; step < rows.length; step++) {
      const row = rows[(at + step + rows.length) % rows.length];
      if (row.rawMaterialId !== currentId && wanted(row)) return row.rawMaterialId;
    }
    return null;
  };
  return nextWhere((r) => r.recount && !isCounted(r, hideOwn)) ?? nextWhere((r) => !isCounted(r, hideOwn));
}

/**
 * The count going on holds only answers to the owner's "count these again"
 * (`recounted`, from the server): its Send is a recount, and the rest of the
 * sheet was never asked for. `left` is how many asked-for items are still to
 * count.
 */
export function recountState(rows: CountRowState[], recounted: string[], hideOwn = false): { only: boolean; left: number } {
  const answered = new Set(recounted);
  const own = hideOwn ? [] : rows.filter((r) => r.counted != null);
  return { only: own.length > 0 && own.every((r) => answered.has(r.rawMaterialId)), left: rows.filter((r) => r.recount).length };
}

/** "Sep 21" on the shop's calendar. */
export function shortDay(iso: string | null | undefined): string {
  const p = manilaParts(iso);
  return p ? `${p.month} ${p.day}` : '';
}

/** "Sep 21 9:12 PM" on the shop's clock. */
export function manilaStamp(iso: string | null | undefined): string {
  const p = manilaParts(iso);
  return p ? `${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod}` : '';
}

function manilaParts(iso: string | null | undefined): Record<string, string> | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d);
  return Object.fromEntries(parts.map((x) => [x.type, x.value]));
}

/** "Kitchen counted: 2 pk + 100 ml (Sep 21)". */
export function otherChip(other: OtherCount): string {
  if (other.message) return other.message;
  const day = shortDay(other.at);
  return `${other.station} counted: ${other.words}${day ? ` (${day})` : ''}`;
}

export type ChipTone = 'todo' | 'done' | 'again' | 'other';

/** The chip on each row: "Not counted", "2 pk + 100 ml", "Count again" or "Bar counted: ...". */
export function rowChip(row: CountRowState, hideOwn = false): { text: string; tone: ChipTone } {
  if (!hideOwn && row.counted != null) {
    return { text: row.countedWords ?? countWords(row.counted, row.unit, row.packSize), tone: 'done' };
  }
  if (row.recount) return { text: 'Count again', tone: 'again' };
  if (row.otherCount) return { text: otherChip(row.otherCount), tone: 'other' };
  return { text: 'Not counted', tone: 'todo' };
}

/** Said above the fields when saving would replace a count already there. */
export function replaceNote(row: CountRowState, hideOwn = false): string | null {
  if (!hideOwn && row.counted != null) {
    return `Counted ${row.countedWords ?? countWords(row.counted, row.unit, row.packSize)}. Saving again replaces it.`;
  }
  if (row.otherCount) return `${row.otherCount.station} already counted this. Saving replaces it.`;
  return null;
}

// ─── Banners and Send ────────────────────────────────────────────────────────

/** "3 orders are still being made. ..." Null when nothing is waiting. */
export function waitingText(n: number): string | null {
  if (!(n > 0)) return null;
  return `${n} order${n === 1 ? ' is' : 's are'} still being made. Finish them first, or count only what is on the shelf.`;
}

/**
 * A partial count asks before it goes: "23 of 25 counted. Send anyway?" Null
 * when every item is counted. A recount is measured against what was asked
 * for, not the whole sheet: it goes without a question once every asked-for
 * item is counted again.
 */
export function sendQuestion(
  progress: { counted: number; total: number },
  recount: { only: boolean; left: number } = { only: false, left: 0 },
): string | null {
  if (recount.only) {
    return recount.left > 0
      ? `${recount.left} item${recount.left === 1 ? '' : 's'} the owner asked for ${recount.left === 1 ? 'is' : 'are'} not counted yet. Send anyway?`
      : null;
  }
  return progress.counted < progress.total ? `${progress.counted} of ${progress.total} counted. Send anyway?` : null;
}

/** What the panel says once the count is sent. */
export function sentHeadline(outcome: string | null | undefined): string {
  return `${outcome === 'ALREADY_SENT' ? 'Already sent.' : 'Sent.'} Counting again starts a new count.`;
}

/**
 * Opened after this station sent its count and nobody has started a new one:
 * the rows show what was sent, read-only, until "Count again". Not when the
 * count is due again or the owner asked for a recount -- then it opens ready.
 */
export function opensSent(view: {
  count: unknown; sentAt: string | null; due: { isDue: boolean } | null; recount: unknown;
  sections: Array<{ rows: Array<{ counted: number | null }> }>;
}): boolean {
  return !view.count && !!view.sentAt && !view.due?.isDue && !view.recount
    && view.sections.some((s) => s.rows.some((r) => r.counted != null));
}

/** The name typed on a paired tablet: no brackets (the server keeps tags in brackets), 40 characters. */
export function cleanName(text: string): string {
  return text.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** What Save sends. `by` only when there is a name to send (a logged-in person is named by the server). */
export function saveBody(input: { rawMaterialId: string; qty: number; by?: string | null }):
  { rawMaterialId: string; qty: number; by?: string } {
  const by = cleanName(input.by ?? '');
  return { rawMaterialId: input.rawMaterialId, qty: input.qty, ...(by ? { by } : {}) };
}

/**
 * The saved row on screen at once, before the refetch. When there was no
 * count running, the save started a new one: the other rows' figures belonged
 * to the sent record, so they are cleared too. Saving an item the owner asked
 * for again answers the recount, as the server marks it.
 */
export function withSavedRow<V extends {
  count: unknown;
  recounted?: string[];
  sections: Array<{ rows: Array<CountRowState & { countedBy: string | null; countedAt: string | null }> }>;
}>(view: V, saved: { rawMaterialId: string; counted: number; countedWords: string | null; countedBy: string | null; countedAt: string | null }): V {
  const startsNew = !view.count;
  const asked = view.sections.some((s) => s.rows.some((r) => r.rawMaterialId === saved.rawMaterialId && r.recount));
  const recounted = startsNew ? [] : (view.recounted ?? []);
  return {
    ...view,
    count: view.count ?? { countNumber: '', startedOn: '' },
    recounted: asked && !recounted.includes(saved.rawMaterialId) ? [...recounted, saved.rawMaterialId] : recounted,
    sections: view.sections.map((s) => ({
      ...s,
      rows: s.rows.map((r) => r.rawMaterialId === saved.rawMaterialId
        ? { ...r, counted: saved.counted, countedWords: saved.countedWords, countedBy: saved.countedBy, countedAt: saved.countedAt, recount: false }
        : startsNew ? { ...r, counted: null, countedWords: null, countedBy: null, countedAt: null } : r),
    })),
  } as V;
}
