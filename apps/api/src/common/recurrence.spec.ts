/**
 * Sprint 22 — Unit tests for computeNextRunAt.
 *
 * Covers all 5 frequencies, month-end clamping (incl. leap year), year
 * rollover, and time-of-day preservation.
 */
import { computeNextRunAt } from './recurrence';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0));

describe('computeNextRunAt', () => {
  it('WEEKLY advances exactly 7 days', () => {
    expect(computeNextRunAt(utc(2026, 5, 12), 'WEEKLY', 2).toISOString())
      .toBe(utc(2026, 5, 19).toISOString());
  });

  it('WEEKLY across month boundary', () => {
    expect(computeNextRunAt(utc(2026, 5, 28), 'WEEKLY', 4).toISOString())
      .toBe(utc(2026, 6, 4).toISOString());
  });

  it('MONTHLY advances one month, same day', () => {
    expect(computeNextRunAt(utc(2026, 5, 15), 'MONTHLY', 15).toISOString())
      .toBe(utc(2026, 6, 15).toISOString());
  });

  it('MONTHLY clamps Jan 31 → Feb 28 in non-leap year (2026)', () => {
    expect(computeNextRunAt(utc(2026, 1, 31), 'MONTHLY', 31).toISOString())
      .toBe(utc(2026, 2, 28).toISOString());
  });

  it('MONTHLY clamps Jan 31 → Feb 29 in leap year (2024)', () => {
    expect(computeNextRunAt(utc(2024, 1, 31), 'MONTHLY', 31).toISOString())
      .toBe(utc(2024, 2, 29).toISOString());
  });

  it('MONTHLY clamps day 31 → 30 in April', () => {
    expect(computeNextRunAt(utc(2026, 3, 31), 'MONTHLY', 31).toISOString())
      .toBe(utc(2026, 4, 30).toISOString());
  });

  it('MONTHLY rolls over year Dec → Jan', () => {
    expect(computeNextRunAt(utc(2026, 12, 15), 'MONTHLY', 15).toISOString())
      .toBe(utc(2027, 1, 15).toISOString());
  });

  it('QUARTERLY advances 3 months', () => {
    expect(computeNextRunAt(utc(2026, 5, 10), 'QUARTERLY', 10).toISOString())
      .toBe(utc(2026, 8, 10).toISOString());
  });

  it('QUARTERLY clamps Nov 30 → Feb 28', () => {
    expect(computeNextRunAt(utc(2026, 11, 30), 'QUARTERLY', 31).toISOString())
      .toBe(utc(2027, 2, 28).toISOString());
  });

  it('SEMIANNUAL advances 6 months', () => {
    expect(computeNextRunAt(utc(2026, 3, 15), 'SEMIANNUAL', 15).toISOString())
      .toBe(utc(2026, 9, 15).toISOString());
  });

  it('SEMIANNUAL rolls over year (Aug → Feb)', () => {
    expect(computeNextRunAt(utc(2026, 8, 31), 'SEMIANNUAL', 31).toISOString())
      .toBe(utc(2027, 2, 28).toISOString());
  });

  it('YEARLY advances 12 months', () => {
    expect(computeNextRunAt(utc(2026, 5, 15), 'YEARLY', 15).toISOString())
      .toBe(utc(2027, 5, 15).toISOString());
  });

  it('YEARLY Feb 29 leap → next year Feb 28', () => {
    expect(computeNextRunAt(utc(2024, 2, 29), 'YEARLY', 29).toISOString())
      .toBe(utc(2025, 2, 28).toISOString());
  });

  it('preserves time-of-day across advances', () => {
    const got = computeNextRunAt(utc(2026, 5, 15, 9, 30), 'MONTHLY', 15);
    expect(got.toISOString()).toBe(utc(2026, 6, 15, 9, 30).toISOString());
  });

  it('throws on invalid Date input', () => {
    expect(() => computeNextRunAt(new Date('not-a-date'), 'MONTHLY', 1)).toThrow();
  });
});
