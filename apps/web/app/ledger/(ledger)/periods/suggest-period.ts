/**
 * The dates "New Period" pre-fills. Pure, so it can be tested without a browser.
 *
 * Everything here works on YYYY-MM-DD strings. The old version built a Date at
 * LOCAL midnight and printed it with toISOString(), which in Manila (UTC+8) is
 * the day before: September 2026 was offered as Aug 31 to Sep 29, and an owner
 * who accepted it locked the wrong days when she closed the month.
 */
import { addDaysIso, endOfMonthIso } from '@/lib/today';

export interface SuggestedPeriod {
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * @param latestEndDate end date of the latest period on file, as the API sends
 *   it ("2026-09-30T00:00:00.000Z": the typed day at UTC midnight), or null
 *   when there is no period yet.
 * @param today the wall-clock day, from todayIso().
 */
export function suggestNextPeriod(latestEndDate: string | null | undefined, today: string): SuggestedPeriod {
  // No period yet: this calendar month. Otherwise: the day after the latest
  // one ends, to the end of that month, so periods never overlap or leave a gap.
  const startDate = latestEndDate ? addDaysIso(latestEndDate, 1) : `${today.slice(0, 7)}-01`;
  const endDate = endOfMonthIso(startDate);
  const [y, m] = startDate.split('-').map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-PH', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  return { name, startDate, endDate };
}

/**
 * The small badge on an open period. `days` is whole days until the end of the
 * period's last day; zero or less means that day has already passed, and
 * "-51d left" is not something anyone should have to read.
 */
export function daysLeftText(days: number): string {
  if (days >= 1) return `${days}d left`;
  const ago = 1 - days;
  return `ended ${ago} day${ago === 1 ? '' : 's'} ago`;
}
