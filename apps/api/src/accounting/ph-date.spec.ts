/**
 * Timezone boundary tests for the GL/BIR date helpers.
 *
 * The GL business date, the Z-Read window, and the BIR month reports must all
 * agree on which Manila calendar day a sale belongs to. They did not: the JE
 * date came from `.toISOString()` (UTC) and the BIR month came from
 * `new Date(year, month-1, 1)` (server-local = UTC on Railway), while the
 * Z-Read alone used +08:00. A sale in the 00:00–07:59 PHT window — which a
 * 24/7 booking channel produces every night — landed on the wrong day, and at
 * a month boundary could post into a closed period and never post at all.
 *
 * These pin the two pure helpers at exactly those boundaries.
 */
import { phDateString } from './journal.service';
import { phMonthBounds } from '../bir/bir.service';

describe('phDateString — GL business date in Manila time', () => {
  it('keeps a mid-afternoon PH sale on its own day', () => {
    // 2026-07-26 15:00 PHT === 2026-07-26T07:00:00Z
    expect(phDateString(new Date('2026-07-26T07:00:00Z'))).toBe('2026-07-26');
  });

  it('puts a 00:30 PHT sale on the PH day, not the previous UTC day', () => {
    // 2026-07-27 00:30 PHT === 2026-07-26T16:30:00Z. UTC says the 26th; PH says
    // the 27th. The Z-Read counts it on the 27th, so the GL must too.
    expect(phDateString(new Date('2026-07-26T16:30:00Z'))).toBe('2026-07-27');
  });

  it('rolls a 00:30 PHT sale on the 1st into the new month (the closed-period case)', () => {
    // 2026-08-01 00:30 PHT === 2026-07-31T16:30:00Z. UTC says 31 July; if July
    // is closed the JE would fail and never retry. PH says 1 August — open.
    expect(phDateString(new Date('2026-07-31T16:30:00Z'))).toBe('2026-08-01');
  });

  it('rolls a 00:30 PHT new-year sale into January', () => {
    // 2027-01-01 00:30 PHT === 2026-12-31T16:30:00Z
    expect(phDateString(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });

  it('keeps 23:59 PHT on its own day', () => {
    // 2026-07-26 23:59 PHT === 2026-07-26T15:59:00Z
    expect(phDateString(new Date('2026-07-26T15:59:00Z'))).toBe('2026-07-26');
  });
});

describe('phMonthBounds — BIR month window in Manila time', () => {
  it('starts at PH midnight of the 1st, not UTC midnight', () => {
    const { from } = phMonthBounds(2026, 8);
    // PH 2026-08-01 00:00 === 2026-07-31T16:00:00Z
    expect(from.toISOString()).toBe('2026-07-31T16:00:00.000Z');
  });

  it('ends at an EXCLUSIVE next-month PH boundary (callers filter with lt)', () => {
    const { to } = phMonthBounds(2026, 8);
    // PH 2026-09-01 00:00 === 2026-08-31T16:00:00Z
    expect(to.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  });

  it('rolls December to the next January', () => {
    const { to } = phMonthBounds(2026, 12);
    // PH 2027-01-01 00:00 === 2026-12-31T16:00:00Z
    expect(to.toISOString()).toBe('2026-12-31T16:00:00.000Z');
  });

  it('labels the month from the inputs, not from the PH-midnight instant', () => {
    // `from` is 16:00Z on the prior day; formatting it on a UTC server would
    // name the wrong month. The label must come from (year, month).
    expect(phMonthBounds(2026, 8).label).toBe('August 2026');
    expect(phMonthBounds(2026, 1).label).toBe('January 2026');
    expect(phMonthBounds(2026, 12).label).toBe('December 2026');
  });

  it('a 00:30 PHT sale on 1 Aug falls inside August, not July', () => {
    const paidAt = new Date('2026-07-31T16:30:00Z'); // 2026-08-01 00:30 PHT
    const aug = phMonthBounds(2026, 8);
    const jul = phMonthBounds(2026, 7);
    expect(paidAt >= aug.from && paidAt < aug.to).toBe(true);
    expect(paidAt >= jul.from && paidAt < jul.to).toBe(false);
  });
});
