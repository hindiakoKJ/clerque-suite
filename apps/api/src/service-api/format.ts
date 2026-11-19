import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isManilaDay, manilaDayOf, manilaDayStart, DAY_MS } from '../ingredient-reports/daily-usage';

/**
 * How the service API writes numbers, days and times (contract: money as
 * strings with 2 decimals, quantities with 4, days YYYY-MM-DD, times ISO 8601
 * in the shop's own offset). Decimal arithmetic throughout: a float would
 * print 0.1 + 0.2 as 0.30000000000000004 before it rounded.
 */

type Num = Prisma.Decimal | number | string;

function dec(x: Num): Prisma.Decimal {
  return x instanceof Prisma.Decimal ? x : new Prisma.Decimal(x);
}

/** A quantity: "1.2500". Null stays null. */
export function qty4(x: Num | null | undefined): string | null {
  return x == null ? null : dec(x).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
}

/** Pesos: "125.50". Null stays null. */
export function money2(x: Num | null | undefined): string | null {
  return x == null ? null : dec(x).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Manila is UTC+8 all year (no daylight saving). */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** An instant as ISO 8601 in Manila time, to the second: "2026-11-20T08:10:00+08:00". */
export function manilaIso(at: Date | null | undefined): string | null {
  if (!at) return null;
  return new Date(at.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 19) + '+08:00';
}

/** The Manila calendar day of an instant: "2026-11-27". */
export function manilaDay(at: Date | null | undefined): string | null {
  return at ? manilaDayOf(at) : null;
}

/** A required YYYY-MM-DD, or a 400 naming the field. */
export function requireDay(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isManilaDay(value)) {
    throw new BadRequestException(`${field} must be a real date written YYYY-MM-DD.`);
  }
  return value;
}

/** [start of `from`, start of the day after `to`) in Manila time: whole days, `to` included. */
export function manilaWindow(from: string, to: string): { start: Date; end: Date } {
  const start = manilaDayStart(from);
  const end = new Date(manilaDayStart(to).getTime() + DAY_MS);
  return { start, end };
}

/**
 * A non-negative decimal written as a string (or a plain number), with at
 * most `places` decimals. Returned as a Decimal so nothing is lost to floats.
 */
export function parseDecimal(value: unknown, field: string, places: number, opts: { positive?: boolean } = {}): Prisma.Decimal {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,12}(\.\d+)?$/.test(text.trim())) {
    throw new BadRequestException(`${field} must be a non-negative number written as a string, e.g. "12.5000".`);
  }
  const d = new Prisma.Decimal(text.trim());
  if (d.decimalPlaces() > places) {
    throw new BadRequestException(`${field} has more than ${places} decimals.`);
  }
  if (opts.positive && d.lessThanOrEqualTo(0)) {
    throw new BadRequestException(`${field} must be more than zero.`);
  }
  return d;
}

/** Optional short text: trimmed, at most `max` characters, brackets removed (they are tag syntax in notes). */
export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be text.`);
  const t = value.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > max) throw new BadRequestException(`${field} is longer than ${max} characters.`);
  return t || null;
}

/**
 * The caller's reference for a draft: what makes a retry return the first
 * draft. Letters, digits and . _ : / - only, at most 100 characters.
 */
export function requireReference(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,100}$/.test(value)) {
    throw new BadRequestException('reference is required: 1 to 100 letters, digits or . _ : / -');
  }
  return value;
}

/** A required id (cuid-like): refuses anything that is not a plain token. */
export function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new BadRequestException(`${field} is required.`);
  }
  return value;
}
