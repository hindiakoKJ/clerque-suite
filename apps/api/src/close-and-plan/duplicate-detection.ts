/**
 * Duplicate detection for raw-material lots received during the
 * Close & Plan flow. Tired owners at 10 PM frequently double-enter the
 * same delivery (multi-device, fatigue, two people both logging it).
 *
 * Heuristic: flag as potential duplicate when ALL four match an
 * existing ACTIVE lot in the same branch:
 *   1. Same `rawMaterialId`
 *   2. Quantity within ±5% (or both within 0.1 unit absolute)
 *   3. `receivedAt` within 24 hours
 *   4. `expirationDate` within 2 days (or both null)
 *
 * The "all four" rule prevents false positives: a bakery legitimately
 * receives 8 cartons of milk every Tuesday + Saturday, but those will
 * be 3-4 days apart so criterion 3 fails.
 *
 * Returns the matching candidates if any; the API surfaces them as a
 * soft warning the owner can override (Skip / Save anyway).
 */
import type { PrismaService } from '../prisma/prisma.service';

export interface DuplicateCandidate {
  id:                 string;
  rawMaterialName:    string;
  qtyReceived:        number;
  qtyRemaining:       number;
  expirationDate:     Date | null;
  receivedAt:         Date;
  ageMinutes:         number;
  /** Match score 0..1. Higher = more confident this is a duplicate. */
  score:              number;
}

export interface DuplicateCheckInput {
  tenantId:        string;
  branchId:        string;
  rawMaterialId:   string;
  qtyReceived:     number;
  expirationDate?: Date | null;
  /** Defaults to now() if omitted. */
  receivedAt?:     Date;
}

/** Window to search for potential dupes — 24 hours before/after. */
const RECEIVE_WINDOW_HOURS = 24;
/** Days-to-expiry tolerance — within 2 days of an existing lot's expiry. */
const EXPIRY_TOLERANCE_DAYS = 2;
/** Quantity tolerance — within 5% (relative) OR 0.1 absolute, whichever larger. */
const QTY_TOLERANCE_PCT = 0.05;
const QTY_TOLERANCE_ABS = 0.1;

function within(a: number, b: number, pct: number, abs: number): boolean {
  const tolerance = Math.max(Math.abs(a) * pct, abs);
  return Math.abs(a - b) <= tolerance;
}

function withinDays(a: Date | null | undefined, b: Date | null | undefined, days: number): boolean {
  // Both null = match (non-perishables can be duplicated too).
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const diffMs = Math.abs(a.getTime() - b.getTime());
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  return diffDays <= days;
}

/**
 * Scan recent active lots for potential duplicates of the given receive.
 *
 * @returns list of candidate matches, ordered by confidence DESC.
 *          Empty list = no warning needed.
 */
export async function detectDuplicateLot(
  prisma: PrismaService,
  input: DuplicateCheckInput,
): Promise<DuplicateCandidate[]> {
  const receivedAt = input.receivedAt ?? new Date();
  const windowStart = new Date(receivedAt.getTime() - RECEIVE_WINDOW_HOURS * 60 * 60 * 1000);
  const windowEnd   = new Date(receivedAt.getTime() + RECEIVE_WINDOW_HOURS * 60 * 60 * 1000);

  const candidates = await prisma.rawMaterialLot.findMany({
    where: {
      tenantId:        input.tenantId,
      branchId:        input.branchId,
      rawMaterialId:   input.rawMaterialId,
      receivedAt:      { gte: windowStart, lte: windowEnd },
      qtyRemaining:    { gt: 0 },  // skip depleted lots
    },
    include: { rawMaterial: { select: { name: true } } },
    orderBy: { receivedAt: 'desc' },
    take:    10,
  });

  const matches: DuplicateCandidate[] = [];
  for (const c of candidates) {
    const cQty = Number(c.qtyReceived);
    const qtyMatch    = within(cQty, input.qtyReceived, QTY_TOLERANCE_PCT, QTY_TOLERANCE_ABS);
    const expiryMatch = withinDays(c.expirationDate, input.expirationDate ?? null, EXPIRY_TOLERANCE_DAYS);

    if (!qtyMatch || !expiryMatch) continue;

    // Score by how close each criterion is.
    const qtyDistance     = Math.abs(cQty - input.qtyReceived) / Math.max(1, cQty);
    const ageMinutes      = Math.abs(c.receivedAt.getTime() - receivedAt.getTime()) / (60 * 1000);
    const recencyScore    = Math.max(0, 1 - ageMinutes / (RECEIVE_WINDOW_HOURS * 60));
    const qtyScore        = Math.max(0, 1 - qtyDistance / QTY_TOLERANCE_PCT);
    const score           = recencyScore * 0.6 + qtyScore * 0.4;

    matches.push({
      id:               c.id,
      rawMaterialName:  c.rawMaterial.name,
      qtyReceived:      cQty,
      qtyRemaining:     Number(c.qtyRemaining),
      expirationDate:   c.expirationDate,
      receivedAt:       c.receivedAt,
      ageMinutes:       Math.round(ageMinutes),
      score,
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

/** Test seam — re-exported constants so specs assert against same source. */
export const dupeDetectionConfig = {
  RECEIVE_WINDOW_HOURS,
  EXPIRY_TOLERANCE_DAYS,
  QTY_TOLERANCE_PCT,
  QTY_TOLERANCE_ABS,
};
