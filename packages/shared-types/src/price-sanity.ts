/**
 * Does this number make sense?
 *
 * The owner types a price for full cream milk. It has been ₱85 to ₱90 a pack
 * for months. Today it says ₱190 — a slipped finger, a pack price in a per-pack
 * box that expected something else, a digit too many. Nothing about ₱190 is
 * impossible, so no rule can refuse it. What can be done is to notice that it
 * is out of character and ask, once, before it blends into the average cost and
 * re-costs every drink that uses milk.
 *
 * These are the only rules for that question, in one place, so the screen that
 * hints while typing and the server that asks before saving can never disagree.
 * Everything here is pure: numbers in, a verdict out.
 */

export const PRICE_SANITY = {
  /** A cost this far either side of the usual price is worth asking about. */
  TREND_FACTOR: 1.35,
  /** Widens the band a little for things whose price genuinely wobbles (produce, eggs). */
  SPREAD_PAD: 1.1,
  /** With little history, or a pack size unlike the usual one, ask only at a bigger jump. */
  THIN_FACTOR: 1.75,
  /** How many past deliveries make a trend rather than an anecdote. */
  MIN_TREND_POINTS: 3,
  /** How many of the most recent deliveries define "usual". */
  MAX_POINTS: 8,
  /** How far back a delivery still says anything about today's price. */
  WINDOW_DAYS: 180,
  /** A pack at least this many times bigger or smaller than usual prices differently per unit. */
  PACK_CHANGE_FACTOR: 2,
  /** The existing guard: an order of magnitude is almost certainly the wrong unit. */
  MAGNITUDE_FACTOR: 10,
  /** A selling price this far either side of the one it replaces is worth asking about. */
  PRICE_FACTOR: 1.35,
  /** A recipe costing under this share of the price is almost always a unit mistake. */
  MARGIN_FLOOR_SHARE: 0.01,
  /** Philippine VAT. */
  VAT_RATE: 0.12,
} as const;

export type SanityDirection = 'high' | 'low';

export interface CostVerdict {
  /** True when the typed cost is outside what this ingredient usually costs. */
  unusual: boolean;
  direction: SanityDirection | null;
  /**
   * What the judgement rests on:
   *   trend  — three or more recent deliveries
   *   thin   — one or two deliveries, or only the cost on file
   *   none   — nothing to compare against, so nothing is flagged
   */
  basis: 'trend' | 'thin' | 'none';
  /** How many deliveries were used. */
  points: number;
  median: number | null;
  /** The range to show a person as "usually". */
  usualLow: number | null;
  usualHigh: number | null;
  /** typed ÷ median (or ÷ the reference when there is no trend). */
  ratio: number | null;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * Judge a cost against what this ingredient has recently cost.
 *
 * Every number must be in the SAME unit and tax basis — the caller's job, since
 * only the caller knows how the value was typed. `history` is the newest
 * deliveries first; anything past MAX_POINTS is ignored.
 *
 * With five or more deliveries the band is built from the middle half of them,
 * so one price that somebody confirmed as correct cannot drag the band open for
 * every typo after it. With three or four there is no padding at all. With one
 * or two, or only the cost on file, the band is wider, because an anecdote is a
 * weaker claim than a trend.
 */
export function judgeCost(input: {
  typed: number;
  history: number[];
  /** Used when there is no trend: the ingredient's current cost on file. */
  reference?: number | null;
  /** True when the pack being bought is a very different size from the usual one. */
  packChanged?: boolean;
}): CostVerdict {
  const { typed } = input;
  const points = input.history.filter((v) => Number.isFinite(v) && v > 0).slice(0, PRICE_SANITY.MAX_POINTS);
  const sorted = [...points].sort((a, b) => a - b);
  const none: CostVerdict = { unusual: false, direction: null, basis: 'none', points: 0, median: null, usualLow: null, usualHigh: null, ratio: null };

  if (sorted.length >= PRICE_SANITY.MIN_TREND_POINTS) {
    const m = median(sorted);
    const factor = input.packChanged ? PRICE_SANITY.THIN_FACTOR : PRICE_SANITY.TREND_FACTOR;
    let upper = m * factor;
    let lower = m / factor;
    // With three or four deliveries the ends are anecdotes (one may be a price
    // somebody confirmed after being asked): "usually" is the middle of them.
    let usualLow = m;
    let usualHigh = m;
    if (sorted.length >= 5) {
      const lo = percentile(sorted, 0.25);
      const hi = percentile(sorted, 0.75);
      // Padding, but never past the thin-history band.
      upper = Math.min(Math.max(upper, hi * PRICE_SANITY.SPREAD_PAD), m * PRICE_SANITY.THIN_FACTOR);
      lower = Math.max(Math.min(lower, lo / PRICE_SANITY.SPREAD_PAD), m / PRICE_SANITY.THIN_FACTOR);
      usualLow = lo;
      usualHigh = hi;
    }
    const ratio = m > 0 ? typed / m : null;
    const high = typed > upper;
    const low = typed < lower;
    return {
      unusual: high || low, direction: high ? 'high' : low ? 'low' : null,
      basis: 'trend', points: sorted.length, median: m, usualLow, usualHigh, ratio,
    };
  }

  const reference = sorted.length > 0 ? median(sorted) : (input.reference != null && input.reference > 0 ? input.reference : null);
  if (reference == null) return none;
  const ratio = typed / reference;
  const high = typed >= reference * PRICE_SANITY.THIN_FACTOR;
  const low = typed <= reference / PRICE_SANITY.THIN_FACTOR;
  return {
    unusual: high || low, direction: high ? 'high' : low ? 'low' : null,
    basis: 'thin', points: sorted.length, median: reference,
    usualLow: sorted.length > 0 ? sorted[0]! : reference,
    usualHigh: sorted.length > 0 ? sorted[sorted.length - 1]! : reference,
    ratio,
  };
}

/** The existing guard's question: is this an order of magnitude off? Almost always a unit mistake. */
export function isMagnitudeOff(typed: number, reference: number | null | undefined): boolean {
  if (reference == null || !(reference > 0) || !(typed > 0)) return false;
  const factor = typed / reference;
  return factor >= PRICE_SANITY.MAGNITUDE_FACTOR || factor <= 1 / PRICE_SANITY.MAGNITUDE_FACTOR;
}

/** Whether a pack is so much bigger or smaller than usual that its per-unit price will differ. */
export function isPackChanged(packSize: number | null | undefined, usualPackSize: number | null | undefined): boolean {
  if (!(packSize && packSize > 0) || !(usualPackSize && usualPackSize > 0)) return false;
  const factor = packSize / usualPackSize;
  return factor >= PRICE_SANITY.PACK_CHANGE_FACTOR || factor <= 1 / PRICE_SANITY.PACK_CHANGE_FACTOR;
}

export interface PriceVerdict {
  unusual: boolean;
  direction: SanityDirection | null;
  /** The price would ring up as nothing. */
  free: boolean;
  ratio: number | null;
}

/**
 * Judge a new selling price against the one it replaces.
 *
 * Prices are overwritten in place, so the price being replaced is the only
 * history there is. A deliberate price rise of a third or more is rare enough
 * to be worth one question; a peso or two is not.
 */
export function judgePrice(input: { prior: number | null | undefined; typed: number }): PriceVerdict {
  const { typed } = input;
  const prior = input.prior != null && input.prior > 0 ? input.prior : null;
  const free = typed === 0 && prior != null;
  if (prior == null) return { unusual: false, direction: null, free: false, ratio: null };
  const ratio = typed / prior;
  const high = typed >= prior * PRICE_SANITY.PRICE_FACTOR;
  const low = typed > 0 && typed <= prior / PRICE_SANITY.PRICE_FACTOR;
  return { unusual: high || low || free, direction: high ? 'high' : (low || free) ? 'low' : null, free, ratio };
}

export interface MarginVerdict {
  /** The price the shop keeps after VAT — what the cost is compared with. */
  netPrice: number;
  /** (net price − cost) ÷ net price, or null when there is nothing to compare. */
  marginShare: number | null;
  /** It costs as much as it sells for, or more. */
  losesMoney: boolean;
  /** The cost is so small next to the price that a unit is almost certainly wrong. */
  suspiciouslyCheap: boolean;
}

/**
 * Judge what an item costs to make against what it sells for.
 *
 * Ingredient costs are kept net of VAT, so a VAT-registered shop's shelf price
 * is taken back to net before the two are compared. Otherwise a drink that
 * genuinely breaks even would look profitable by twelve percent.
 */
export function judgeMargin(input: { cost: number | null | undefined; price: number; vatable: boolean; vatTenant: boolean }): MarginVerdict {
  const netPrice = input.vatTenant && input.vatable ? input.price / (1 + PRICE_SANITY.VAT_RATE) : input.price;
  const cost = input.cost != null && input.cost > 0 ? input.cost : null;
  if (cost == null || !(netPrice > 0)) {
    return { netPrice, marginShare: null, losesMoney: false, suspiciouslyCheap: false };
  }
  return {
    netPrice,
    marginShare: (netPrice - cost) / netPrice,
    losesMoney: cost >= netPrice,
    suspiciouslyCheap: cost < netPrice * PRICE_SANITY.MARGIN_FLOOR_SHARE,
  };
}

/**
 * The form in which a confirmed value is echoed back.
 *
 * Six significant figures, not a fixed number of decimals: a per-gram cost of
 * ₱0.0680 and one of ₱0.0684 are different prices, and rounding both to two
 * places would let a confirmation for one wave through the other.
 */
export function sanityValueKey(value: number): string {
  return Number.isFinite(value) ? Number(value).toPrecision(6) : 'NaN';
}
