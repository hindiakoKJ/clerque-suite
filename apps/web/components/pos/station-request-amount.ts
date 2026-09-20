/**
 * The amount on a "+ Add something" line, kept apart from the panel so Node's
 * own test runner can check it (see station-request-amount.spec.mjs).
 *
 * The first days after go-live Clerque knows no pack sizes (they come from the
 * first purchases posted), so a tap moves 100 g or ml -- and 2 kg of beans was
 * twenty taps. The amount can now be typed as well, and a tap from a typed
 * amount lands on a whole step again.
 */

/** The server's limit (station-request.service.ts MAX_EXTRA_QTY). */
export const MAX_QTY = 1_000_000;

const EPS = 1e-9;

/** Four decimals, as the server accepts: a 750.5 ml pack stepped three times must not send 2251.4999999. */
export const qty4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * One tap of the stepper: a whole pack when Clerque knows the pack (the server
 * rounds to packs anyway), 100 g or ml, otherwise one of the unit.
 */
export function stepOf(unit: string, packSize: number | null): number {
  if (packSize != null && packSize > 0) return packSize;
  const u = unit.trim().toLowerCase();
  return u === 'g' || u === 'ml' ? 100 : 1;
}

/** "+": the next whole step above, never past the limit. 1,500 ml with 1,000 ml packs is 2,000. */
export function stepUp(qty: number, step: number): number {
  const next = (Math.floor(qty / step + EPS) + 1) * step;
  return qty4(Math.min(MAX_QTY, next));
}

/** "-": the whole step below, never under one step. 1,500 ml with 1,000 ml packs is 1,000. */
export function stepDown(qty: number, step: number): number {
  const prev = (Math.ceil(qty / step - EPS) - 1) * step;
  return qty4(Math.max(step, prev));
}

/** A typed amount: "2000", "2,000" or "1.5". Null for anything the server would refuse. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= MAX_QTY ? qty4(n) : null;
}

/** "2 packs (2,000 ml)" when the pack is known, else "2,000 ml". */
export function amountWords(qty: number, unit: string, packSize: number | null): string {
  const plain = `${qty.toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${unit}`;
  if (packSize != null && packSize > 0) {
    const packs = Math.round((qty / packSize) * 100) / 100;
    return `${packs} pack${packs === 1 ? '' : 's'} (${plain})`;
  }
  return plain;
}
