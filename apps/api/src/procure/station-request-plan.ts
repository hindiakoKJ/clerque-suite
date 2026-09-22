import { PH_TIMEZONE } from '@repo/shared-types';
import { DAY_MS, manilaDayOf } from '../ingredient-reports/daily-usage';
import { usageQty } from '../telegram/messages';

/**
 * What a kitchen or bar tap on "Request what's running low" asks the owner to
 * buy. Pure: every number comes in, so every rule can be checked in a test.
 *
 * The list covers ONE day -- the day the shopping is for -- because the
 * cook's question is "will we get through tomorrow?", not "what will we need
 * this month?". Three things decide an item:
 *
 *   what the same weekday used the last few weeks (a Friday is not a Monday),
 *   what the preps that will have to be made take out of it, and
 *   the owner's own reorder level, the rule Check stock has always used.
 *
 * Less what is already on the shelf and already on its way. All amounts are in
 * the item's own unit (RawMaterial.unit).
 */

/** Room for a busier day than the average. */
export const SAFETY = 1.25;
/** A need 5% over a pack is still one pack: nobody buys a second bottle for 50 ml. */
export const PACK_SLACK = 0.10;
/** How many same weekdays back the forecast looks. */
export const WEEKS = 4;
/** A sent list this fresh, with nothing bought on it yet, is added to rather than started again. */
export const SENT_LIST_HOURS = 18;
/** With no pack size, a raise is news only when it adds this share of what was asked. */
export const RAISE_MIN_FRACTION = 0.10;
/** Before this hour (Manila) the shopping is still for today; from it, for tomorrow. */
export const PLAN_TODAY_BEFORE_HOUR = 10;
/**
 * Fewer open days than this behind a "lately" forecast, and Clerque is still
 * learning the shop's usage. The first days after go-live: the forecast sees
 * little or nothing, so an empty list is not an all-clear.
 */
export const LEARNING_DAYS = 3;

/** One day the shop was open, and what each item used that day. */
export interface HistoryDay {
  /** YYYY-MM-DD, Manila. */
  day: string;
  /** rawMaterialId -> sold + wasted, in the item's unit. */
  used: Map<string, number>;
}

export interface PlanItem {
  id: string;
  name: string;
  unit: string;
  /** INGREDIENT, KITCHEN_SUPPLY, BAR_SUPPLY or OFFICE_SUPPLY. */
  category: string;
  /** Made in the kitchen from a recipe, never bought. */
  isPrep: boolean;
  /** What one batch of a prep makes. */
  batchYield: number | null;
  lowStockAlert: number | null;
  /** The book less what waiting tickets hold (afterHeld). */
  available: number;
  /** What one pack held the last time it was bought, when Clerque knows. */
  packSize: number | null;
  /** In a recipe something on the menu is sold by, directly or through a prep. */
  inActiveRecipe: boolean;
}

export interface PlanInput {
  now: Date;
  /** The day the shopping is for. */
  plannedDay: string;
  /** Today, Manila. History before it is complete; today's is not. */
  today: string;
  /** Open days only. */
  history: HistoryDay[];
  items: PlanItem[];
  /** One batch of parentId takes qty of componentId. */
  recipes: Array<{ parentId: string; componentId: string; qty: number }>;
  /** rawMaterialId -> quantity already sent for or bought and not in yet, on other lists. */
  onTheWay: Map<string, number>;
  /** rawMaterialId -> qtyRequested on the list this tap adds to. */
  existing: Map<string, number>;
  /** Asked for by hand on the screen: rawMaterialId -> quantity in the item's unit. */
  extras?: Map<string, number>;
  /** Why a hand-added line is there: "Added by hand on the Kitchen screen". */
  extraReason?: string;
}

/** ADD: not on the list yet. RAISE: on it, and this asks for enough more to be news. KEEP: leave it. */
export type LineAction = 'ADD' | 'RAISE' | 'KEEP';

export interface PlanLine {
  rawMaterialId: string;
  name: string;
  unit: string;
  packSize: number | null;
  /** What to ask for, rounded to packs or a sensible step. */
  qty: number;
  /** The need before rounding; null when only a hand-added amount put it here. */
  shortBy: number | null;
  why: string[];
  /** What the list already asks for, or null. */
  existing: number | null;
  action: LineAction;
}

export interface PlanResult {
  plannedDay: string;
  /** Every item something wants, by name. KEEP lines included, so a caller can count them. */
  lines: PlanLine[];
  /** Low or needed, and already coming in full: nothing asked for. */
  onTheWay: Array<{ rawMaterialId: string; name: string; unit: string; packSize: number | null; qty: number }>;
  /** Preps that will need making, shallowest first. */
  toMake: Array<{ rawMaterialId: string; name: string; batches: number }>;
  /**
   * Items somebody has to look at by hand. Nothing is put here now: an item that
   * is out with nothing to size the ask by goes on the list with a starting
   * amount instead (startingQty), so a tap never sends nothing while items are
   * out. Kept so the screen's "Check these" section has its field.
   */
  check: Array<{ rawMaterialId: string; name: string; reason: string }>;
  /** Preps whose recipes loop back into each other; left out of the plan. */
  cycle: string[];
  /**
   * Too little sales history to forecast from (no open day, or fewer than
   * LEARNING_DAYS of them lately): only reorder levels and "+" can put
   * something on the list, so nothing on it does not mean nothing is low.
   */
  learning: boolean;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const EPS = 1e-9;

/** A Manila day `n` days from `day`. Noon, so no timezone can tip it over. */
export function addDays(day: string, n: number): string {
  return manilaDayOf(new Date(new Date(`${day}T12:00:00+08:00`).getTime() + n * DAY_MS));
}

const MANILA_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: PH_TIMEZONE, hour: '2-digit', hourCycle: 'h23' });

/** Today, and the day the shopping is for: today until 10:00 Manila, tomorrow from then. */
export function plannedDayFor(now: Date): { today: string; plannedDay: string } {
  const today = manilaDayOf(now);
  const hour = Number(MANILA_HOUR.formatToParts(now).find((p) => p.type === 'hour')?.value ?? 0);
  return { today, plannedDay: hour < PLAN_TODAY_BEFORE_HOUR ? today : addDays(today, 1) };
}

/**
 * From when a sent list counts as "already sent" for the closing fail-safe
 * running at `now`.
 *
 * The list the closing job would send is for the planned day, and taps plan
 * for that day from 10:00 Manila the day before it -- so a buy list sent from
 * then on already asked for it. (Which requests count as a buy list is the
 * caller's rule: StationRequestService.buyListSentSince.) Midnight of the business day would not do: a
 * bar closing at 01:00 has last night's own closing send (01:30) inside the
 * same calendar day, and the fail-safe would never go out again after its
 * first night. A morning list is for that morning's shopping, not tomorrow's.
 *
 * Never before the start of the business day being closed (`day`), which
 * only matters when a caller names a later day than the clock does.
 *
 * When the closing moment is known and earlier (a closing before 10:00 whose
 * catch-up runs past 10:00), a send since the closing counts too, so the
 * job's own send is never repeated by its next five-minute run.
 */
export function closingSentSince(now: Date, day: string, closingAt: Date | null = null): Date {
  const { plannedDay } = plannedDayFor(now);
  const hour = String(PLAN_TODAY_BEFORE_HOUR).padStart(2, '0');
  const planningStarted = new Date(`${addDays(plannedDay, -1)}T${hour}:00:00+08:00`);
  const dayStarted = new Date(`${day}T00:00:00+08:00`);
  const since = dayStarted.getTime() > planningStarted.getTime() ? dayStarted : planningStarted;
  return closingAt && closingAt.getTime() < since.getTime() ? closingAt : since;
}

/** "Fridays" for a YYYY-MM-DD day. */
export function weekdayPlural(day: string): string {
  const name = new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, weekday: 'long' }).format(new Date(`${day}T12:00:00+08:00`));
  return `${name}s`;
}

/**
 * The daily usage report's days, as the forecast reads them.
 *
 * A day counts as open only when something was sold: a day the shop was shut
 * would otherwise pull the average down. Used is what was sold plus what was
 * made and wasted -- what the menu took. What went into preps is left out
 * (the preps' own use is pushed down onto their ingredients instead, so it is
 * never counted twice) and so are write-offs (spoilage is not demand).
 */
export function historyFromUsage(
  days: Array<{ day: string; rows: Array<{ rawMaterialId: string; sold: number; wasted: number }> }>,
): HistoryDay[] {
  return days
    .filter((d) => d.rows.some((r) => r.sold > 0))
    .map((d) => ({
      day: d.day,
      used: new Map(d.rows.map((r) => [r.rawMaterialId, round4(r.sold + r.wasted)] as [string, number]).filter(([, q]) => q > 0)),
    }));
}

/**
 * Round a need up to what somebody would actually buy.
 *   A known pack: whole packs, at least one, with a 10% slack.
 *   Grams or millilitres: the next 100 (the next 10 under 100).
 *   Kilograms or litres: the next 0.1.
 *   Anything else (pc, box, roll): the next whole one.
 */
export function roundQty(need: number, unit: string, packSize: number | null): number {
  if (!(need > 0)) return 0;
  if (packSize != null && packSize > 0) {
    const packs = Math.max(1, Math.ceil(need / packSize - PACK_SLACK - EPS));
    return round4(packs * packSize);
  }
  const u = unit.trim().toLowerCase();
  if (u === 'g' || u === 'ml') {
    const step = need < 100 ? 10 : 100;
    return Math.ceil(need / step - EPS) * step;
  }
  if (u === 'kg' || u === 'l') return round4(Math.ceil(need * 10 - EPS) / 10);
  return Math.ceil(need - EPS);
}

/**
 * What to ask for when an item is out and there is nothing to size the ask by:
 * no pack size, no sales history, no reorder level. One round amount in the
 * item's own unit -- a kilo, a litre, or one of whatever it is counted in --
 * and the line says so (STARTING_AMOUNT_WHY), so nobody reads it as a forecast.
 */
export function startingQty(unit: string): number {
  const u = unit.trim().toLowerCase();
  return u === 'g' || u === 'ml' ? 1000 : 1;
}

/** Why a starting amount is on the list, in the words the kitchen and the owner both read. */
export const STARTING_AMOUNT_WHY = 'Out. No pack size or sales history yet, so this is a starting amount. Add more with + if you need it.';

/** The smallest step roundQty moves in, for an amount this size. */
export function roundingStep(qty: number, unit: string, packSize: number | null): number {
  if (packSize != null && packSize > 0) return packSize;
  const u = unit.trim().toLowerCase();
  if (u === 'g' || u === 'ml') return qty < 100 ? 10 : 100;
  if (u === 'kg' || u === 'l') return 0.1;
  return 1;
}

/**
 * Whether asking for `planned` where the list says `existing` is news.
 *
 * Never lower a number: somebody may have raised it by hand for a reason the
 * plan cannot see. And only raise by at least a pack (or a tenth, with no pack
 * known): every sale moves the forecast a little, and a bell for 20 g more
 * sugar every time somebody taps teaches the owner to ignore the bell.
 */
export function isRaise(planned: number, existing: number, unit: string, packSize: number | null): boolean {
  if (!(planned > existing)) return false;
  const threshold = packSize != null && packSize > 0
    ? packSize
    : Math.max(existing * RAISE_MIN_FRACTION, roundingStep(planned, unit, null));
  return planned - existing >= threshold - EPS;
}

export function planRequest(input: PlanInput): PlanResult {
  const { plannedDay, today, items, recipes } = input;
  const byId = new Map(items.map((i) => [i.id, i]));
  const extras = input.extras ?? new Map<string, number>();

  // ── 1. expected use on the planned day ─────────────────────────────────────
  const usedOn = new Map(input.history.map((h) => [h.day, h.used]));
  const sameDays = Array.from({ length: WEEKS }, (_, i) => addDays(plannedDay, -7 * (i + 1)))
    .filter((d) => d < today && usedOn.has(d));
  const recentDays = Array.from({ length: 7 }, (_, i) => addDays(today, -(i + 1))).filter((d) => usedOn.has(d));
  // Two same weekdays make a pattern; one is an accident. Short of that, the last week will do.
  const basis: 'WEEKDAY' | 'RECENT' | 'NONE' = sameDays.length >= 2 ? 'WEEKDAY' : recentDays.length >= 1 ? 'RECENT' : 'NONE';
  const basisDays = basis === 'WEEKDAY' ? sameDays : basis === 'RECENT' ? recentDays : [];
  const learning = basis === 'NONE' || (basis === 'RECENT' && recentDays.length < LEARNING_DAYS);
  const expected = (id: string): number => basisDays.length === 0
    ? 0
    : round4(basisDays.reduce((t, d) => t + (usedOn.get(d)?.get(id) ?? 0), 0) / basisDays.length);
  const expectedWords = (id: string, unit: string): string | null => {
    const e = expected(id);
    if (!(e > 0)) return null;
    return basis === 'WEEKDAY'
      ? `${weekdayPlural(plannedDay)} use about ${usageQty(e, unit)}`
      : `Lately about ${usageQty(e, unit)} a day`;
  };

  // ── 2. preps, from the ones nothing uses down to their deepest parts ───────
  const pushed = new Map<string, number>();
  const madeFor = new Map<string, string[]>();
  const toMake: PlanResult['toMake'] = [];
  const preps = items.filter((i) => i.isPrep).sort((a, b) => a.name.localeCompare(b.name));
  const prepIds = new Set(preps.map((p) => p.id));
  const parts = new Map<string, Array<{ componentId: string; qty: number }>>();
  const usedByPreps = new Map<string, number>(preps.map((p) => [p.id, 0]));
  for (const r of recipes) {
    if (!prepIds.has(r.parentId)) continue;
    parts.set(r.parentId, [...(parts.get(r.parentId) ?? []), { componentId: r.componentId, qty: r.qty }]);
    if (prepIds.has(r.componentId)) usedByPreps.set(r.componentId, (usedByPreps.get(r.componentId) ?? 0) + 1);
  }
  // Kahn's order: a prep is planned only after every prep that uses it, so all of its demand is in.
  const queue = preps.filter((p) => usedByPreps.get(p.id) === 0);
  const planned = new Set<string>();
  while (queue.length > 0) {
    const p = queue.shift()!;
    planned.add(p.id);
    if (p.batchYield != null && p.batchYield > 0) {
      const demand = expected(p.id) * SAFETY + (pushed.get(p.id) ?? 0);
      const target = Math.max(demand, p.lowStockAlert ?? 0);
      const make = Math.max(0, target - p.available);
      const batches = make > EPS ? Math.ceil(make / p.batchYield - EPS) : 0;
      if (batches > 0) {
        toMake.push({ rawMaterialId: p.id, name: p.name, batches });
        for (const c of parts.get(p.id) ?? []) {
          pushed.set(c.componentId, round4((pushed.get(c.componentId) ?? 0) + batches * c.qty));
          if (!prepIds.has(c.componentId)) {
            madeFor.set(c.componentId, [...(madeFor.get(c.componentId) ?? []), `For ${batches} batch${batches === 1 ? '' : 'es'} of ${p.name}`]);
          }
        }
      }
    }
    for (const c of parts.get(p.id) ?? []) {
      if (!prepIds.has(c.componentId)) continue;
      const left = (usedByPreps.get(c.componentId) ?? 0) - 1;
      usedByPreps.set(c.componentId, left);
      if (left === 0) queue.push(byId.get(c.componentId)!);
    }
  }
  const cycle = preps.filter((p) => !planned.has(p.id)).map((p) => p.name);

  // ── 3-5. what to buy ───────────────────────────────────────────────────────
  const lines: PlanLine[] = [];
  const onTheWay: PlanResult['onTheWay'] = [];
  const check: PlanResult['check'] = [];
  for (const item of items) {
    if (item.isPrep) continue;   // made, never bought
    const supply = item.category !== 'INGREDIENT';
    const level = item.lowStockAlert;
    const shortOfLevel = level != null ? level - item.available : 0;
    // Check stock's rule: past the line, double the shortfall; exactly on it, the level itself.
    const lowWanted = level != null && item.available <= level
      ? (shortOfLevel > 0 ? shortOfLevel * 2 : (level > 0 ? level : 1))
      : 0;
    const exp = supply ? 0 : expected(item.id);
    // A supply is in no recipe: only its reorder level or a hand-added amount puts it on the list.
    const forecastNeed = supply ? 0 : exp * SAFETY + (pushed.get(item.id) ?? 0) - item.available;
    const coming = input.onTheWay.get(item.id) ?? 0;
    let need = round4(Math.max(lowWanted, forecastNeed) - coming);
    const extra = extras.get(item.id);
    let outNoHistory = false;
    let startingAmount = false;

    if (need <= 0 && item.available <= 0 && item.inActiveRecipe && !(coming > 0) && level == null) {
      // Out, on the menu, and no sales yet to learn from.
      if (item.packSize != null && item.packSize > 0) {
        need = item.packSize;
        outNoHistory = true;
      } else if (extra == null) {
        /*
          No pack size either -- most of a new shop's items, until each has been
          bought once. It used to be left off the list under "Check these", so a
          tap with 25 items out could send nothing. It goes on the list with a
          round starting amount in its own unit, and the line says that is what
          it is: the owner sees it is out, and buys the usual pack.
        */
        need = startingQty(item.unit);
        startingAmount = true;
      }
    }
    if (need <= 0 && coming > 0 && Math.max(lowWanted, forecastNeed) > 0 && extra == null) {
      onTheWay.push({ rawMaterialId: item.id, name: item.name, unit: item.unit, packSize: item.packSize, qty: round4(coming) });
    }

    const fromPlan = need > 0 ? roundQty(need, item.unit, item.packSize) : 0;
    const byHand = extra != null && extra > 0 ? roundQty(extra, item.unit, item.packSize) : 0;
    // A hand-added amount is "at least this much", not "this much more": two taps of the same number are one ask.
    const qty = Math.max(fromPlan, byHand);
    if (!(qty > 0)) continue;

    const why: string[] = [];
    if (lowWanted > 0 && level != null) {
      why.push(`Low now: ${usageQty(Math.max(0, item.available), item.unit)} left, reorder at ${usageQty(level, item.unit)}`);
    }
    const said = supply ? null : expectedWords(item.id, item.unit);
    if (said && fromPlan > 0) why.push(said);
    if (fromPlan > 0) why.push(...(madeFor.get(item.id) ?? []));
    if (coming > 0) why.push(`${usageQty(coming, item.unit)} already on the way`);
    if (outNoHistory) why.push('Out, no sales history yet');
    if (startingAmount && fromPlan > 0) why.push(STARTING_AMOUNT_WHY);
    if (byHand > 0 && input.extraReason) why.push(input.extraReason);

    const existing = input.existing.get(item.id);
    lines.push({
      rawMaterialId: item.id,
      name: item.name,
      unit: item.unit,
      packSize: item.packSize,
      qty,
      // A starting amount is a guess, not a shortfall: the buy list must not say "short by 1,000 g".
      shortBy: need > 0 && !startingAmount ? need : null,
      why,
      existing: existing ?? null,
      action: existing == null ? 'ADD' : isRaise(qty, existing, item.unit, item.packSize) ? 'RAISE' : 'KEEP',
    });
  }
  lines.sort((a, b) => a.name.localeCompare(b.name));
  onTheWay.sort((a, b) => a.name.localeCompare(b.name));
  check.sort((a, b) => a.name.localeCompare(b.name));

  return { plannedDay, lines, onTheWay, toMake, check, cycle, learning };
}
