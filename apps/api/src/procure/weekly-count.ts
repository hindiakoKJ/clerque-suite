import { Prisma } from '@prisma/client';
import { PH_TIMEZONE } from '@repo/shared-types';
import type { PrismaService } from '../prisma/prisma.service';
import { DAY_MS, manilaDayOf } from '../ingredient-reports/daily-usage';
import { manilaDayLabel, usageQty } from '../telegram/messages';
import { appendNote, readTag, withTag, withoutTag } from './procure-notes';

/**
 * The weekly count a kitchen or bar screen takes, in plain code: the tags it
 * keeps in the notes columns, the words the owner reads, and when a count is
 * due. Nothing here writes; station-count.service.ts does.
 *
 * A weekly count is an ordinary CycleCount, one per station per counting
 * session, created on the first saved line. Send freezes it as RECORDED: a
 * record of counted against the book at that moment, kept for reconciliation.
 * Stock and the books move only when the owner chooses "Adjust the books to
 * match" (KJ, 2026-09-21: "this should not affect the count in the books but
 * as a basis for reconciliation").
 *
 * On the count, in front of CycleCount.notes (procure-notes.ts grammar):
 *   [WEEKLY:<Manila day>]      a weekly count, started that day. Always first.
 *   [ST:<stationId>]           the station counting into it
 *   [DONE:<st>=<iso>=<name>]   when it was sent and by whom ("|" between entries)
 *   [RECOUNT:<id>,<id>]        items the owner asked to count again (at most 40)
 *   [RECOUNTBY:<name>]         who asked
 *   [RECOUNTED:<id>,<id>]      on the next count: the items that answered a recount
 * On each line, in CycleCountLine.notes:
 *   [BY:<name>] [AT:<iso>] [ST:<stationId>]
 *
 * A name is typed on the tablet, so it is cut, stripped of brackets and has
 * the few characters the tags use escaped (%XX) before it goes in a tag.
 */

/** A station's count is due this many Manila days after it last sent one. */
export const WEEKLY_COUNT_DAYS = 7;
/** An OPEN count this many Manila days old was never sent: the next save keeps it as a record and starts a new one. */
export const ABANDONED_AFTER_DAYS = 3;
/** Another station's count of a shared item this recent counts as done on this station's panel. */
export const COUNTED_ELSEWHERE_DAYS = 3;
export const RECOUNT_MAX = 40;
export const COUNT_QTY_MAX = 1_000_000;
export const NAME_MAX = 40;
/** How every weekly count's notes start, so the database can narrow a search before the tags are read exactly. */
export const WEEKLY_PREFIX = '[WEEKLY:';
/** A difference under this is a match: the same 1 g / 1 ml precision posting uses (warehouse.service.ts). */
export const MATCH_BELOW = 0.001;

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ── names in tags ──────────────────────────────────────────────────────────

const ESCAPED = /[%|=,[\]]/g;

/** A typed name made safe for a tag value: the tag characters become %XX. */
export function encodeTagText(s: string): string {
  return s.replace(ESCAPED, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

export function decodeTagText(s: string): string {
  return s.replace(/%([0-9A-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** What the tablet typed as "Who is counting?": trimmed, one space between words, no brackets, at most 40 characters. */
export function cleanCounterName(by: unknown): string {
  if (typeof by !== 'string') return '';
  return [...by.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('').trim();
}

// ── the count's tags ───────────────────────────────────────────────────────

/** The notes a new weekly count starts with. */
export function weeklyCountNotes(day: string, station: { id: string; name: string }): string {
  return appendNote(withTag(withTag(null, 'WEEKLY', day), 'ST', station.id), `Weekly count, ${station.name}`);
}

/** The day a weekly count was started and its station; null when the count is not a weekly one. */
export function readWeekly(notes: string | null | undefined): { day: string; stationId: string | null } | null {
  if (!(notes ?? '').startsWith(WEEKLY_PREFIX)) return null;
  const day = readTag(notes, 'WEEKLY');
  return day ? { day, stationId: readTag(notes, 'ST') } : null;
}

export interface DoneEntry { stationId: string; at: Date; by: string }

export function doneEntries(notes: string | null | undefined): DoneEntry[] {
  return (readTag(notes, 'DONE') ?? '').split('|').flatMap((part) => {
    const [stationId, iso, name] = part.split('=');
    const at = new Date(iso ?? '');
    return stationId && !Number.isNaN(at.getTime()) ? [{ stationId, at, by: decodeTagText(name ?? '') }] : [];
  });
}

/** Set one station's DONE entry, keeping the others. */
export function withDone(notes: string | null | undefined, entry: DoneEntry): string {
  const kept = doneEntries(notes).filter((d) => d.stationId !== entry.stationId);
  const value = [...kept, entry].map((d) => `${d.stationId}=${d.at.toISOString()}=${encodeTagText(d.by)}`).join('|');
  return withTag(notes, 'DONE', value);
}

function idList(notes: string | null | undefined, tag: string): string[] {
  return [...new Set((readTag(notes, tag) ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
}

/** A list of ids as a tag, the newest `max` kept; the tag is dropped when the list is empty. */
function withIdList(notes: string | null | undefined, tag: string, ids: string[], max = RECOUNT_MAX): string | null {
  const unique = [...new Set(ids)].slice(-max);
  return unique.length > 0 ? withTag(notes, tag, unique.join(',')) : withoutTag(notes, tag);
}

export const recountIds = (notes: string | null | undefined) => idList(notes, 'RECOUNT');
export const withRecount = (notes: string | null | undefined, ids: string[]) => withIdList(notes, 'RECOUNT', ids);
export const recountedIds = (notes: string | null | undefined) => idList(notes, 'RECOUNTED');
export const withRecounted = (notes: string | null | undefined, ids: string[]) => withIdList(notes, 'RECOUNTED', ids);

export function recountAskedBy(notes: string | null | undefined): string | null {
  const by = readTag(notes, 'RECOUNTBY');
  return by ? decodeTagText(by) : null;
}

export function withRecountAskedBy(notes: string | null | undefined, name: string): string {
  return withTag(notes, 'RECOUNTBY', encodeTagText(name));
}

// ── the line's tags ────────────────────────────────────────────────────────

export interface LineTags { by: string | null; at: Date | null; stationId: string | null }

export function lineNotes(t: { by: string; at: Date; stationId: string }): string {
  return withTag(withTag(withTag(null, 'BY', encodeTagText(t.by)), 'AT', t.at.toISOString()), 'ST', t.stationId);
}

export function readLineTags(notes: string | null | undefined): LineTags {
  const by = readTag(notes, 'BY');
  const at = new Date(readTag(notes, 'AT') ?? '');
  return { by: by ? decodeTagText(by) : null, at: Number.isNaN(at.getTime()) ? null : at, stationId: readTag(notes, 'ST') };
}

// ── words ──────────────────────────────────────────────────────────────────

export type DifferenceKind = 'SHORT' | 'OVER' | 'MATCH';

export function differenceOf(counted: number, book: number): { kind: DifferenceKind; amount: number } {
  const d = round3(counted - book);
  if (Math.abs(d) < MATCH_BELOW) return { kind: 'MATCH', amount: 0 };
  return { kind: d < 0 ? 'SHORT' : 'OVER', amount: Math.abs(d) };
}

/** "Milk: counted 2.1 L, book 3.4 L, short 1.3 L" -- or "over 200 g", or "matches". Owner-side only. */
export function countLineWords(name: string, unit: string, counted: number, book: number): string {
  const d = differenceOf(counted, book);
  const tail = d.kind === 'MATCH' ? 'matches' : `${d.kind === 'SHORT' ? 'short' : 'over'} ${usageQty(d.amount, unit)}`;
  return `${name}: counted ${usageQty(counted, unit)}, book ${usageQty(book, unit)}, ${tail}`;
}

/** "Milk short 1.3 L", for the bell where room is short. */
export function differenceWords(name: string, unit: string, counted: number, book: number): string {
  const d = differenceOf(counted, book);
  return d.kind === 'MATCH' ? `${name} matches` : `${name} ${d.kind === 'SHORT' ? 'short' : 'over'} ${usageQty(d.amount, unit)}`;
}

/** How far off a line is for its size: 1.3 L short of 3.4 L outranks 200 g over 5 kg. */
export function relativeDifference(counted: number, book: number): number {
  const d = Math.abs(counted - book);
  return d < MATCH_BELOW ? 0 : d / Math.max(Math.abs(book), Math.abs(counted), 1);
}

// Some ICU builds put a narrow no-break space before AM/PM; the words and their tests want a plain one.
const plain = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ');
const MONTH_DAY = new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, month: 'short', day: 'numeric' });
const CLOCK = new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, hour: 'numeric', minute: '2-digit' });

/** "Sep 21". */
export function monthDay(at: Date): string {
  return plain(MONTH_DAY.format(at));
}

/** "Sep 21 9:12 PM". */
export function whenLabel(at: Date): string {
  return `${monthDay(at)} ${plain(CLOCK.format(at))}`;
}

// ── due ────────────────────────────────────────────────────────────────────

/** Whole Manila days from one YYYY-MM-DD to another. */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);
}

/**
 * Rolling, by the shop's calendar: sent on a Monday, due again the next
 * Monday whatever the hour. Never sent is due.
 */
export function dueState(lastSentAt: Date | null, now: Date): { isDue: boolean; lastSentOn: string | null; daysSince: number | null } {
  if (!lastSentAt) return { isDue: true, lastSentOn: null, daysSince: null };
  const lastSentOn = manilaDayOf(lastSentAt);
  const daysSince = daysBetween(lastSentOn, manilaDayOf(now));
  return { isDue: daysSince >= WEEKLY_COUNT_DAYS, lastSentOn, daysSince };
}

export function isDue(lastSentAt: Date | null, now: Date): boolean {
  return dueState(lastSentAt, now).isDue;
}

/** The tablet's banner, or null when nothing is due. */
export function dueMessage(lastSentOn: string | null, due: boolean): string | null {
  if (!due) return null;
  return lastSentOn ? `Weekly count is due. Last sent ${manilaDayLabel(lastSentOn)}.` : 'Weekly count is due. Nothing has been sent yet.';
}

// ── the owner's bell ───────────────────────────────────────────────────────

export interface SentLine { name: string; unit: string; counted: number; book: number }

/** Names as a list a phone can show: the first few, then how many more. */
export function namesList(names: string[], shown = 8): string {
  if (names.length <= shown) return names.join(', ');
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}

/**
 * "Recorded. Nothing has moved. 23 of 25 counted, 5 differ. Milk short 1.3 L
 * · Eggs short 2 pc · +2 more. Recounted: Milk. Not counted: Salt, Cooking oil."
 *
 * "Nothing has moved" comes first: the bell shows two lines, and that is the
 * one thing the owner must not miss. A recount (every line answered the
 * owner's "Ask for a recount") names what was counted again instead of how
 * much of the sheet was; `recounted` names the items a full count answered.
 */
export function weeklyCountBellBody(c: {
  counted: number; total: number; lines: SentLine[]; notCounted: string[]; recount: boolean; recounted?: string[];
}): string {
  const differing = c.lines
    .filter((l) => differenceOf(l.counted, l.book).kind !== 'MATCH')
    .sort((a, b) => relativeDifference(b.counted, b.book) - relativeDifference(a.counted, a.book));
  const parts: string[] = ['Recorded. Nothing has moved.'];
  const counted = c.recount ? `Counted again: ${namesList(c.lines.map((l) => l.name))}` : `${c.counted} of ${c.total} counted`;
  if (differing.length === 0) {
    parts.push(`${counted}. All match the book.`);
  } else {
    const top = differing.slice(0, 3).map((l) => differenceWords(l.name, l.unit, l.counted, l.book));
    const more = differing.length - top.length;
    const differ = `${differing.length} differ${differing.length === 1 ? 's' : ''}`;
    parts.push(c.recount ? `${counted}. ${differ}.` : `${counted}, ${differ}.`);
    parts.push(`${top.join(' · ')}${more > 0 ? ` · +${more} more` : ''}.`);
  }
  if (!c.recount && (c.recounted?.length ?? 0) > 0) parts.push(`Recounted: ${namesList(c.recounted!)}.`);
  if (c.notCounted.length > 0) parts.push(`Not counted: ${namesList(c.notCounted)}.`);
  return parts.join(' ');
}

// ── reading counts ─────────────────────────────────────────────────────────

type Db = Pick<Prisma.TransactionClient, 'cycleCount'> | Pick<PrismaService, 'cycleCount'>;

/** The newest Send at a branch -- of one station, or of any. */
export async function lastWeeklySend(db: Db, tenantId: string, branchId: string, stationId?: string): Promise<DoneEntry | null> {
  const rows = await db.cycleCount.findMany({
    where: {
      tenantId, branchId, status: { in: ['RECORDED', 'POSTED'] },
      notes: { startsWith: WEEKLY_PREFIX, contains: '[DONE:' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { notes: true },
  });
  let last: DoneEntry | null = null;
  for (const r of rows) {
    for (const d of doneEntries(r.notes)) {
      if (stationId && d.stationId !== stationId) continue;
      if (!last || d.at > last.at) last = d;
    }
  }
  return last;
}

/**
 * The sentence the end-of-day bell and Telegram message carry about the
 * weekly count, or null when there is nothing to say:
 *   "Weekly count from Sep 21 is recorded. 5 items differ from the book."  (on the day it was sent)
 *   "No weekly count has been sent for 8 days."
 *   "No weekly count has been sent yet."
 * Only in a shop with a kitchen or bar screen: a shop without one cannot count this way.
 */
export async function weeklyCountNote(
  db: Pick<PrismaService, 'cycleCount' | 'station'>,
  tenantId: string,
  branchId: string,
  /** The sheet's hours and its business day (YYYY-MM-DD, Manila). */
  window: { from: Date; to: Date; day: string },
): Promise<string | null> {
  if ((await db.station.count({ where: { tenantId, isActive: true } })) === 0) return null;

  const sent = await db.cycleCount.findMany({
    where: {
      tenantId, branchId, status: { in: ['RECORDED', 'POSTED'] },
      notes: { startsWith: WEEKLY_PREFIX, contains: '[DONE:' },
      createdAt: { lte: window.to },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { notes: true, lines: { select: { rawMaterialId: true, countedQty: true, expectedQty: true, notes: true } } },
  });
  const sentIn = (c: { notes: string | null }) => doneEntries(c.notes).filter((d) => d.at >= window.from && d.at < window.to);
  const inWindow = sent.filter((c) => sentIn(c).length > 0);
  if (inWindow.length > 0) {
    // An item both stations counted is one item: the newer count of it is the one that stands.
    const newest = new Map<string, { at: number; differs: boolean }>();
    for (const c of inWindow) {
      for (const l of c.lines) {
        const at = readLineTags(l.notes).at?.getTime() ?? 0;
        const was = newest.get(l.rawMaterialId);
        if (!was || at >= was.at) {
          newest.set(l.rawMaterialId, { at, differs: differenceOf(Number(l.countedQty), Number(l.expectedQty)).kind !== 'MATCH' });
        }
      }
    }
    const differ = [...newest.values()].filter((v) => v.differs).length;
    const sentOn = new Date(Math.min(...inWindow.flatMap((c) => sentIn(c).map((d) => d.at.getTime()))));
    const what = differ === 0 ? 'Every item matches the book.' : `${differ} item${differ === 1 ? ' differs' : 's differ'} from the book.`;
    return `Weekly count from ${monthDay(sentOn)} is recorded. ${what}`;
  }

  let last: Date | null = null;
  for (const c of sent) for (const d of doneEntries(c.notes)) if (!last || d.at > last) last = d.at;
  if (!last) return 'No weekly count has been sent yet.';
  const days = daysBetween(manilaDayOf(last), window.day);
  return days >= WEEKLY_COUNT_DAYS ? `No weekly count has been sent for ${days} days.` : null;
}

/**
 * The owner's daily sheet: what a sent weekly count found for each item on
 * that sheet's hours, and how far it was from the book at that moment.
 * The newest count of an item wins. Never the station's copy.
 */
export async function countedOnSheet(
  db: Pick<PrismaService, 'cycleCount'>,
  tenantId: string,
  branchId: string,
  from: Date,
  to: Date,
): Promise<Map<string, { counted: number; difference: number; at: Date }>> {
  const counts = await db.cycleCount.findMany({
    where: {
      tenantId, branchId, status: { in: ['RECORDED', 'POSTED'] },
      notes: { startsWith: WEEKLY_PREFIX },
      // A count's lines are all saved after it was started, and it changes no more once it is sent.
      createdAt: { lte: to },
      updatedAt: { gte: from },
    },
    select: { createdAt: true, lines: { select: { rawMaterialId: true, countedQty: true, expectedQty: true, notes: true } } },
  });
  const out = new Map<string, { counted: number; difference: number; at: Date }>();
  for (const c of counts) {
    for (const l of c.lines) {
      const at = readLineTags(l.notes).at ?? c.createdAt;
      if (at < from || at > to) continue;
      const was = out.get(l.rawMaterialId);
      if (was && was.at > at) continue;
      const counted = Number(l.countedQty);
      out.set(l.rawMaterialId, { counted, difference: round3(counted - Number(l.expectedQty)), at });
    }
  }
  return out;
}
