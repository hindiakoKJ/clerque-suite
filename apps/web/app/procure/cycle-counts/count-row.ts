/**
 * The second line under a count's number on the Cycle Counts list: when it
 * was started or posted, and where it came from.
 *
 * The list showed a number, a branch, a line count and a status -- no date --
 * and the counts a buy list starts ("remaining?" on a line) looked exactly like
 * the ones started here, so six one-line counts from six lists could not be
 * told apart. The buy list tags its count "[REQ:REQ-…]" in the notes.
 *
 * Kept free of React so Node's own test runner can check it:
 *   cd apps/web && node --test app/procure/cycle-counts/count-row.spec.mjs
 */

export interface CountRowInfo {
  status:    string;
  createdAt: string;
  postedAt:  string | null;
  notes:     string | null;
}

/** "Sep 21, 2026", on the shop's calendar (Manila), whatever the device is set to. */
function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Manila' });
}

/** The run of tags the server keeps at the front of a count's notes ("[WEEKLY:2026-09-21][ST:…]"). */
const TAGS = /^(?:\s*\[[A-Z]+:[^\]]*\])+/;
const cut = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 3)}…` : text);
/**
 * A weekly caption holds the station, a name of up to 40 letters and the time
 * it was sent: at 60 "sent by Carolina Cook, Sep 22 6:33 PM" lost its minute.
 */
const WEEKLY_CAPTION_MAX = 100;

/**
 * A kitchen or bar screen's weekly count: tagged [WEEKLY:<day>] in front. It
 * is opened with Review, never with the Count and Post of a count started
 * here.
 */
export function isWeeklyCount(notes: string | null | undefined): boolean {
  return /^\s*\[WEEKLY:/.test(notes ?? '');
}

/**
 * A weekly count's words after its tags run "Weekly count, Kitchen · Kitchen
 * sent by Joy, Sep 21 9:12 PM · Recount asked by …", newest last. The row
 * keeps the station and who sent it when: "weekly count, Kitchen · sent by
 * Joy, Sep 21 9:12 PM", or the newest line when it was never sent ("Never
 * sent; kept as a record.").
 */
function weeklyWords(plain: string): string {
  const said = plain.split(' · ').map((s) => s.trim()).filter(Boolean);
  const station = /^Weekly count, (.+)$/.exec(said[0] ?? '')?.[1] ?? null;
  const rest = station ? said.slice(1) : said;
  const shown = [...rest].reverse().find((s) => / sent by /.test(` ${s}`)) ?? rest[rest.length - 1] ?? null;
  const tail = shown && station && shown.startsWith(`${station} sent by `) ? shown.slice(station.length + 1) : shown;
  return [station ? `weekly count, ${station}` : 'weekly count', tail].filter(Boolean).join(' · ');
}

export function countCaption(c: CountRowInfo): string {
  const when = c.status === 'POSTED' && c.postedAt ? `Posted ${day(c.postedAt)}` : `Started ${day(c.createdAt)}`;
  const notes = (c.notes ?? '').trim();
  const fromList = /^\[REQ:([^\]]+)\]/.exec(notes);
  // Tags are for the server; the words after them ("Kitchen sent by Joy, …") are for people.
  const plain = notes.replace(TAGS, '').trim();
  const source = fromList
    ? `from buy list ${fromList[1]}`
    : isWeeklyCount(notes) ? cut(weeklyWords(plain), WEEKLY_CAPTION_MAX) : cut(plain);
  return source ? `${when} · ${source}` : when;
}

/** What posting a count answers (warehouse.service.ts postCycleCount), as far as this screen reads it. */
export interface PostResult {
  warnings?: string[];
  /** Items another count had already adjusted or counted again: "Left alone: Salt was already adjusted by count CC-2026-000009 (posted Sep 22)." */
  leftAlone?: Array<{ name?: string; message?: string }>;
  /** Set when every item was left alone. */
  message?: string | null;
}

/** The toast after Post. */
export function postedTitle(d: PostResult | undefined, isOpeningBalance: boolean): string {
  if (d?.message) return `Posted. ${d.message}`;
  if (isOpeningBalance) return 'Posted as opening stock — booked to Owner’s Capital.';
  return (d?.warnings?.length ?? 0) === 0 ? 'Posted — variances applied.' : 'Posted — the counts are saved.';
}

/** How many left-alone items a toast names before "and N more". */
const LEFT_SHOWN = 4;

/** The items the post left alone and why, one sentence each, or null when it left none. */
export function leftAloneText(d: PostResult | undefined): string | null {
  const said = (d?.leftAlone ?? []).map((l) => (l.message ?? '').trim()).filter(Boolean);
  if (said.length === 0) return null;
  const more = said.length - LEFT_SHOWN;
  return more > 0
    ? `${said.slice(0, LEFT_SHOWN).join(' ')} And ${more} more item${more === 1 ? '' : 's'} left alone the same way.`
    : said.join(' ');
}

export type BadgeTone = 'open' | 'recorded' | 'posted' | 'cancelled' | 'other';

/**
 * The status badge. A weekly count says what it means for the books:
 * RECORDED is the count as the station sent it, with stock and the books
 * untouched until the owner adjusts them. Any status the list does not know
 * yet is shown as it comes rather than breaking the row.
 */
export function countBadge(c: { status: string; notes: string | null }): { label: string; tone: BadgeTone } {
  const weekly = isWeeklyCount(c.notes);
  switch (c.status) {
    case 'RECORDED':  return { label: 'Recorded - books not changed', tone: 'recorded' };
    case 'OPEN':      return { label: weekly ? 'Counting now' : 'open', tone: 'open' };
    case 'POSTED':    return { label: weekly ? 'Books adjusted' : 'posted', tone: 'posted' };
    case 'CANCELLED': return { label: 'cancelled', tone: 'cancelled' };
    default:          return { label: String(c.status ?? '').toLowerCase() || 'unknown', tone: 'other' };
  }
}
