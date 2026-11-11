/**
 * Hours and pay-period windows shared by the in-app clock, the kiosk and
 * pay runs.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Regular hours in a day; anything above is overtime. */
export const REGULAR_DAY_HOURS = 8;

/**
 * A kiosk punch records no break. Labor Code Art. 85 gives at least 60
 * minutes of unpaid meal time, so a punch spanning more than 5 hours with
 * no break recorded has 60 minutes taken off. Without this, a 07:00-16:00
 * shift paid 9 hours, one of them as overtime.
 */
export const KIOSK_ASSUMED_MEAL_MINS = 60;
export const KIOSK_MEAL_AFTER_MINS = 5 * 60;

export function kioskBreakMins(spanMins: number): number {
  return spanMins > KIOSK_MEAL_AFTER_MINS ? KIOSK_ASSUMED_MEAL_MINS : 0;
}

/** Worked and overtime hours for one time entry. grossHours includes the overtime. */
export function hoursWorked(spanMins: number, breakMins: number): { grossHours: number; otHours: number } {
  const worked = Math.max(spanMins - Math.max(breakMins, 0), 0);
  const grossHours = round2(worked / 60);
  const otHours = round2(Math.max(grossHours - REGULAR_DAY_HOURS, 0));
  return { grossHours, otHours };
}

/**
 * Regular (non-overtime) hours of an entry. TimeEntry.grossHours includes the
 * overtime, so paying grossHours at the basic rate AND otHours at 125% paid
 * every overtime hour at 225%.
 */
export function regularHours(grossHours: number, otHours: number): number {
  return round2(Math.max(grossHours - otHours, 0));
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instants a pay run covers. periodStart and periodEnd are calendar
 * dates (stored as UTC midnight); the shop works in Manila time (UTC+8).
 * The run covers Manila midnight of periodStart up to, but not including,
 * Manila midnight after periodEnd. Before, `clockIn <= periodEnd` stopped at
 * 08:00 Manila on the last day, so later punches fell into no run.
 */
export function payRunWindow(periodStart: Date, periodEnd: Date): { from: Date; to: Date } {
  const startDay = Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate());
  const endDay = Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate());
  return {
    from: new Date(startDay - MANILA_OFFSET_MS),
    to: new Date(endDay + DAY_MS - MANILA_OFFSET_MS),
  };
}

/** Day of week (0 = Sunday) of an instant, in Manila time. */
export function manilaDayOfWeek(at: Date): number {
  return new Date(at.getTime() + MANILA_OFFSET_MS).getUTCDay();
}

/** True when two date ranges (inclusive calendar dates) share at least one day. */
export function periodsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}
