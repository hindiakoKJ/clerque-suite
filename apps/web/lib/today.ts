/**
 * Today, as the person looking at the screen would write it.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, not the local one.
 * Manila is UTC+8, so between midnight and 08:00 local it returns YESTERDAY.
 * That is precisely the window a cafe is open before service: the milk and
 * bread arrive at 06:00, the owner records the delivery, and it is booked to
 * the previous day. On the first of the month it lands in the previous
 * accounting PERIOD, which may already be closed.
 *
 * The same trap catches "first of the month": `new Date(y, m, 1)` is LOCAL
 * midnight, and `.toISOString()` on it is 16:00 UTC the day BEFORE, at any
 * hour of the day. September came out as "Aug 31 to Sep 29".
 *
 * Every date the user is shown as a default should come from here. Filenames
 * and export stamps can keep using UTC — nobody reconciles against those.
 */

/** A Date's day on the wall clock (local getters, never UTC), as YYYY-MM-DD. */
export function localIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayIso(): string {
  // Local getters, then pad — this is the date on the wall clock, whatever
  // timezone the tablet is set to.
  return localIso(new Date());
}

/** `todayIso()` shifted by whole days. Negative goes back. */
export function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localIso(d);
}

/** The first day of the month we are in, by the wall clock. */
export function startOfMonthIso(): string {
  return `${todayIso().slice(0, 7)}-01`;
}

/** The first day of the year we are in, by the wall clock. */
export function startOfYearIso(): string {
  return `${todayIso().slice(0, 4)}-01-01`;
}

/**
 * A YYYY-MM-DD day moved by whole days. Pure calendar arithmetic: the day is
 * parsed and printed in UTC on both sides, so no timezone can shift it.
 * Anything after the first ten characters is ignored, so an API timestamp
 * such as "2026-09-30T00:00:00.000Z" is fine to pass in. A cleared date box
 * ("") gives "" back instead of throwing.
 */
export function addDaysIso(iso: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso ?? '') || !Number.isFinite(days)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The last day of the month a YYYY-MM-DD day falls in ("" for a cleared date box). */
export function endOfMonthIso(iso: string): string {
  if (!/^\d{4}-\d{2}/.test(iso ?? '')) return '';
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
