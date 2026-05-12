/**
 * Sprint 22 — Recurring invoice/bill recurrence helper.
 *
 * Pure function. No DB, no IO. Given a "current" run date, a frequency, and a
 * "day-of-period" anchor, return the next run date in UTC.
 *
 * Day-of-period semantics:
 *   WEEKLY                  — 0=Sun..6=Sat. Always advances exactly 7 days
 *                             from `current` (the original anchor day is set
 *                             at template create time; we just step by 7).
 *   MONTHLY/QUARTERLY/
 *   SEMIANNUAL/YEARLY       — day-of-month (1-31). Month-end clamps:
 *                               dayOfPeriod=31 in Feb (non-leap) → 28
 *                               dayOfPeriod=31 in Apr           → 30
 *                             Year and month roll forward by 1/3/6/12 months.
 *
 * All dates are treated as UTC. The materializer scheduler runs at 01:05 UTC
 * daily, so a template with nextRunAt=2026-05-15T00:00:00Z materializes on
 * 2026-05-15's run. Templates created on Feb 31 simply land on Feb 28/29.
 */

import { RecurrenceFrequency } from '@prisma/client';

/**
 * Last day of `month` (1-12) in `year`. Uses the JS Date trick: day=0 of the
 * next month = last day of the current month.
 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Compute the next run date.
 *
 * @param current      The previous run date (or template.startDate for the
 *                     first call). UTC.
 * @param frequency    WEEKLY | MONTHLY | QUARTERLY | SEMIANNUAL | YEARLY
 * @param dayOfPeriod  For monthly+ frequencies: target day-of-month 1-31
 *                     (clamped to month length).
 *                     For WEEKLY: unused at advance time (only used at
 *                     initial anchor); we just add 7 days.
 *
 * @returns The next run date at the same UTC time-of-day as `current`. For
 *          monthly+ frequencies the date component is set to `dayOfPeriod`
 *          (clamped); for WEEKLY it's `current + 7 days`.
 */
export function computeNextRunAt(
  current:     Date,
  frequency:   RecurrenceFrequency,
  dayOfPeriod: number,
): Date {
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
    throw new Error('computeNextRunAt: invalid `current` Date');
  }

  if (frequency === 'WEEKLY') {
    const next = new Date(current.getTime());
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }

  // Monthly-family frequencies: step year/month forward, clamp day.
  const monthStep =
    frequency === 'MONTHLY'    ? 1 :
    frequency === 'QUARTERLY'  ? 3 :
    frequency === 'SEMIANNUAL' ? 6 :
    frequency === 'YEARLY'     ? 12 :
    (() => { throw new Error(`computeNextRunAt: unsupported frequency ${frequency}`); })();

  const y0 = current.getUTCFullYear();
  const m0 = current.getUTCMonth();           // 0-indexed
  const targetMonthIdx = m0 + monthStep;       // may overflow >= 12
  const ny = y0 + Math.floor(targetMonthIdx / 12);
  const nm = ((targetMonthIdx % 12) + 12) % 12; // 0-11

  // Clamp dayOfPeriod (1..31) to the target month's length.
  const requestedDay = Math.max(1, Math.min(31, Math.floor(dayOfPeriod)));
  const maxDay = lastDayOfMonth(ny, nm + 1);   // lastDayOfMonth wants 1-12
  const day = Math.min(requestedDay, maxDay);

  // Preserve UTC time-of-day from `current`.
  return new Date(Date.UTC(
    ny,
    nm,
    day,
    current.getUTCHours(),
    current.getUTCMinutes(),
    current.getUTCSeconds(),
    current.getUTCMilliseconds(),
  ));
}
