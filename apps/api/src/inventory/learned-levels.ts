import { usedByDay, manilaDayStart, DAY_MS } from '../ingredient-reports/daily-usage';

/**
 * A reorder level each shop gets without typing one.
 *
 * "Is this low?" used to be answered only for ingredients somebody had given
 * a reorder level by hand. A shop that imported 375 ingredients set it on
 * three, so the buy list, Check stock and the 3 am alert watched three
 * things and were silent about the rest -- a second shop onboarding would be
 * in exactly the same place. The shop already knows the answer: what it
 * actually used. So an ingredient with no level of its own is judged against
 * COVER_DAYS of its own average daily use over the last LEARN_DAYS.
 *
 * A level typed by hand always wins; this only fills the gap. Something the
 * shop MAKES (a prep with its own recipe) is left alone: an empty parked batch
 * is normal for half its life, and its par is a kitchen decision.
 */

/** Days of use kept on the shelf before an ingredient counts as low: one to buy it, one to spare. */
export const COVER_DAYS = positive(process.env.LOW_STOCK_COVER_DAYS, 2);
/** How far back use is read. Two weeks takes in both weekends. */
export const LEARN_DAYS = 14;
/** Recomputed at most this often per branch: every buy-list screen asks, and the answer moves slowly. */
const CACHE_MS = 30 * 60 * 1000;

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

type Db = Parameters<typeof usedByDay>[0];

const cache = new Map<string, { at: number; levels: Map<string, number> }>();

/** For tests, and after a bulk import that changes the picture at once. */
export function clearLearnedLevels(): void {
  cache.clear();
}

/**
 * The learned level per ingredient at one branch: average daily use since
 * the first day in the window the shop used anything, times COVER_DAYS,
 * rounded up to a whole unit. An ingredient not used in the window has no
 * learned level (a shop that has not sold it yet does not know its pace).
 */
export async function learnedLevels(
  db: Db,
  tenantId: string,
  branchId: string,
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const key = `${tenantId}:${branchId}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.levels;

  const to = now;
  const from = new Date(to.getTime() - LEARN_DAYS * DAY_MS);
  const levels = new Map<string, number>();
  try {
    const usage = await usedByDay(db, tenantId, branchId, from, to);
    if (usage.days.length > 0) {
      /*
        Divide by the days the shop has actually been trading in the window,
        not by fourteen: a shop that opened on Monday used Monday's milk in
        one day, not in two weeks.
      */
      const firstDay = manilaDayStart(usage.days[0].day).getTime();
      const span = Math.max(1, Math.ceil((to.getTime() - Math.max(firstDay, from.getTime())) / DAY_MS));
      for (const row of usage.rows) {
        if (!(row.total > 0)) continue;
        levels.set(row.rawMaterialId, Math.ceil((row.total / span) * COVER_DAYS));
      }
    }
  } catch {
    // A usage read that fails leaves the hand-typed levels in charge, as before; it never blocks a screen.
  }
  cache.set(key, { at: now.getTime(), levels });
  return levels;
}
