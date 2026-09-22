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

export function countCaption(c: CountRowInfo): string {
  const when = c.status === 'POSTED' && c.postedAt ? `Posted ${day(c.postedAt)}` : `Started ${day(c.createdAt)}`;
  const notes = (c.notes ?? '').trim();
  const fromList = /^\[REQ:([^\]]+)\]/.exec(notes);
  const source = fromList
    ? `from buy list ${fromList[1]}`
    : notes.length > 60 ? `${notes.slice(0, 57)}…` : notes;
  return source ? `${when} · ${source}` : when;
}
