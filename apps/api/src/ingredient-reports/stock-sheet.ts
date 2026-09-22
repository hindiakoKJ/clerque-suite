import { NotFoundException } from '@nestjs/common';
import { PH_TIMEZONE } from '@repo/shared-types';
import type { PrismaService } from '../prisma/prisma.service';
import type { StationContext } from '../kds/station-access';
import { HOLDING_STATUSES, WAITING_LINE } from '../orders/held-usage';
import { usageQty } from '../telegram/messages';
import { sheetDays } from './end-of-day.scheduler';
import { movementsInWindow, SheetMovement } from './sheet-movements';
import { sheetWindow, SheetWindow } from './stock-day-balances';
import { stationItems, UNROUTED } from './station-items';

/**
 * The daily inventory sheet the kitchen and bar used to fill in by hand:
 * Beginning, In, Waste, Used, Ending -- per item, for one branch's business
 * day, with the rows one station uses (or every item, for the owner's copy).
 *
 *   Beginning  the closing balance saved the day before
 *   Ending     this day's saved closing balance, or the stock now while the
 *              day is still running (the book figure, stock held by waiting
 *              tickets included)
 *   Adjust     whatever the other columns don't explain: counts, corrections,
 *              transfers to another branch, anything not recorded in Clerque
 *
 * No costs, anywhere: the kitchen and bar see quantities only (owner's rule),
 * and the owner's copy is the same sheet.
 */

export type SectionKey = 'PREMADE' | 'INGREDIENTS' | 'SUPPLIES' | 'UNROUTED';

export const SECTION_TITLES: Record<SectionKey, string> = {
  PREMADE:     'Pre-made',
  INGREDIENTS: 'Ingredients',
  SUPPLIES:    'Supplies',
  // Plain words, the same the prep tiles use: "not routed" meant nothing to a cook.
  UNROUTED:    'No station set yet',
};
export const SECTION_ORDER: SectionKey[] = ['PREMADE', 'INGREDIENTS', 'SUPPLIES', 'UNROUTED'];

export interface SheetNumbers {
  beginning: number;
  in: number;
  waste: number;
  used: number;
  ending: number;
  adjust: number;
}

export interface SheetRow extends SheetNumbers {
  rawMaterialId: string;
  name: string;
  unit: string;
  /** What one pack held on the last purchase, in `unit`; null when never bought by the pack. */
  packSize: number | null;
  /** The other stations this item is on. */
  alsoOn: string[];
  /** The numbers as the sheet writes them. */
  cells: Record<keyof SheetNumbers, string>;
}

export interface DailySheet {
  shop: { name: string };
  /** Null on the owner's copy of every item at the branch. */
  station: { id: string; name: string; kind: string } | null;
  branch: { id: string; name: string };
  title: string;
  day: string;
  dayLabel: string;
  today: string;
  previousDay: string | null;
  previousDayLabel: string | null;
  nextDay: string | null;
  nextDayLabel: string | null;
  status: 'LIVE' | 'CLOSED';
  window: { from: string; to: string; fromLabel: string; toLabel: string };
  notes: string[];
  stillWaiting: number;
  showAdjust: boolean;
  sections: Array<{ key: SectionKey; title: string; rows: SheetRow[] }>;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const MINUS = '−';

/**
 * One row's numbers. With a saved Beginning, Adjust is what the movements do
 * not explain. With none (b null), Beginning is worked back from the rest and
 * there is nothing to adjust. A difference too small to be a real count --
 * rounding in recipe multiples -- is not called an Adjust.
 */
export function sheetRow(b: number | null, m: SheetMovement, e: number): SheetNumbers {
  const moved = m.in - m.waste - m.used;
  if (b == null) {
    return { beginning: round4(e - moved), in: round4(m.in), waste: round4(m.waste), used: round4(m.used), ending: round4(e), adjust: 0 };
  }
  let adjust = e - (b + moved);
  if (Math.abs(adjust) <= Math.max(0.001, 0.0005 * Math.max(Math.abs(b), Math.abs(e)))) adjust = 0;
  return { beginning: round4(b), in: round4(m.in), waste: round4(m.waste), used: round4(m.used), ending: round4(e), adjust: round4(adjust) };
}

/**
 * A quantity the way the sheet writes it: "12 pk + 815 g" when the item is
 * bought by the pack, else "1.25 kg" / "815 g" / "58 serving". Movements and
 * Adjust leave a zero blank, as a hand-filled sheet does; a balance says "0 g".
 *
 * Adjust (and the owner's Difference, written the same way) says which way in
 * words: "8 pk + 586 g short", "200 ml extra". A sign in front read wrong in
 * packs: "−8 pk + 586 g" looked like minus 8 packs, plus 586 g. A balance
 * below zero keeps its minus, over the packs and the rest together:
 * "−(2 pk + 500 g)", "−2 pk", "−5 g".
 */
export function sheetAmount(q: number, unit: string, packSize: number | null, kind: 'balance' | 'movement' | 'adjust'): string {
  // To the 4 places every amount is kept to, so a pack short by a rounding crumb still reads as a pack.
  const size = round4(Math.abs(q));
  if (size < 0.00005) return kind === 'balance' ? usageQty(0, unit) : '';
  let words = usageQty(size, unit);
  let split = false;
  if (packSize != null && packSize > 0 && size >= packSize) {
    const packs = Math.floor(size / packSize + 1e-9);
    const rest = round4(size - packs * packSize);
    split = rest >= 0.00005;
    words = `${packs} pk${split ? ` + ${usageQty(rest, unit)}` : ''}`;
  }
  if (kind === 'adjust') return `${words} ${q < 0 ? 'short' : 'extra'}`;
  if (q > 0) return words;
  return split ? `${MINUS}(${words})` : `${MINUS}${words}`;
}

// Some ICU builds put a narrow no-break space before AM/PM; the sheet and its tests want a plain one.
const plain = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ');
const NOON = (day: string) => new Date(`${day}T12:00:00+08:00`);

/** "Thu, Sep 17, 2026". */
export function sheetDayLabel(day: string): string {
  return plain(new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(NOON(day)));
}
/** "Wed, Sep 16". */
function shortDayLabel(day: string): string {
  return plain(new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(NOON(day)));
}
/** "Sep 16". */
function monthDayLabel(day: string): string {
  return plain(new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, month: 'short', day: 'numeric' }).format(NOON(day)));
}
/** "9:30 PM". */
export function timeLabel(at: Date): string {
  return plain(new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, hour: 'numeric', minute: '2-digit' }).format(at));
}
/** "Sep 15, 9:30 PM". */
export function dayTimeLabel(at: Date): string {
  return plain(new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at));
}

const ADJUST_NOTE = "Adjust is what the other columns don't explain: counts, corrections, transfers to another branch, or anything not recorded in Clerque.";

/** The plain-English notes over the sheet, in the order a reader needs them. */
export function sheetNotes(w: SheetWindow, extra: { stillWaiting: number; anyAdjust: boolean; now: Date }): string[] {
  const notes: string[] = [];
  const whose = w.day === w.today ? "today's" : "this day's";
  if (w.status === 'LIVE') {
    /*
      The day closes when its last shift is closed, so no clock time is
      promised. Past the fallback moment (closing + 2 hours) with no save yet,
      the job is saving it within minutes.
    */
    notes.push(w.closesAt == null
      ? 'Running totals so far.'
      : w.closesAt.getTime() > extra.now.getTime()
        ? 'Running totals so far. This sheet closes when the last shift of the day is closed.'
        : "Running totals so far. Clerque is saving this sheet's closing balance now.");
  } else if (w.closedBy === 'SHIFT') {
    /*
      Said plainly: a sheet closed at 10:19 AM with no word why read as a bug.
      A last shift closed within 2 hours of the closing time (or from 5 PM with
      no closing time) ends the day; earlier is a handover and closes nothing
      (end-of-day.scheduler.ts lastShiftCloseDue).
    */
    notes.push(`Closed at ${timeLabel(w.to)}, when the day's last shift was closed. Waste and batches since then go on the next sheet.`);
  } else if (w.closedBy === 'CLOCK') {
    notes.push(`Closed at ${timeLabel(w.to)} by Clerque: the day's last shift was not closed by then, so it closed on the clock.`);
  } else {
    notes.push(`Closed at ${timeLabel(w.to)}.`);
  }
  if (w.workedBack === 'NO_SAVE') notes.push(`No saved balance yet. Beginning is worked back from ${whose} numbers.`);
  if (w.workedBack === 'TOO_OLD') notes.push(`The last saved balance is more than a week old. Beginning is worked back from ${whose} numbers.`);
  if (w.missingSaveDay === w.day) {
    // Its own closing is the one missing: the sheet runs on to the next saved closing (or to now).
    notes.push(`Clerque did not save a closing balance on ${monthDayLabel(w.missingSaveDay)}. This sheet runs from ${dayTimeLabel(w.from)} ${
      w.status === 'CLOSED' ? `to ${dayTimeLabel(w.to)}` : 'until now'}.`);
  } else if (w.missingSaveDay) {
    notes.push(`Clerque did not save a closing balance on ${monthDayLabel(w.missingSaveDay)}. This sheet runs from ${dayTimeLabel(w.from)}.`);
  }
  if (w.status === 'LIVE' && extra.stillWaiting > 0) {
    const n = extra.stillWaiting;
    notes.push(n === 1
      ? '1 item still at the kitchen or bar screen is not in Used yet.'
      : `${n} items still at the kitchen or bar screen are not in Used yet.`);
  }
  if (extra.anyAdjust) notes.push(ADJUST_NOTE);
  return notes;
}

export interface SheetScope {
  tenantId: string;
  branch: { id: string; name: string };
  /** Null for every item at the branch (the owner's copy). */
  station: { id: string; name: string; kind: string } | null;
}

/** A kitchen or bar screen's sheet, for the station and branch its caller resolved to. */
export function stationSheet(prisma: PrismaService, ctx: StationContext, day: string | null, now: Date): Promise<DailySheet> {
  return buildSheet(prisma, { tenantId: ctx.tenantId, branch: ctx.branch, station: ctx.station }, day, now);
}

/**
 * Pack sizes from the last purchases bought by the pack. Never the pack's
 * cost. The weekly count reads the same, so its "2 pk + 100 ml" and the
 * sheet's always agree.
 */
export async function sheetPackSizes(
  prisma: Pick<PrismaService, 'purchaseRequestLine'>, tenantId: string, ids: string[],
): Promise<Map<string, number | null>> {
  const packs = ids.length
    ? await prisma.purchaseRequestLine.findMany({
        where:    {
          rawMaterialId: { in: ids }, receivedAt: { not: null }, packSize: { gt: 0 }, packsBought: { gt: 0 },
          purchaseRequest: { tenantId },
        },
        orderBy:  { receivedAt: 'desc' },
        distinct: ['rawMaterialId'],
        select:   { rawMaterialId: true, packSize: true },
      })
    : [];
  return new Map(packs.map((p) => [p.rawMaterialId, p.packSize != null ? Number(p.packSize) : null]));
}

export async function buildSheet(prisma: PrismaService, scope: SheetScope, day: string | null, now: Date): Promise<DailySheet> {
  const { tenantId, branch, station } = scope;
  const place = await prisma.branch.findFirst({
    where:  { id: branch.id, tenantId },
    select: { closesAt: true, tenant: { select: { name: true } } },
  });
  if (!place) throw new NotFoundException('Branch not found.');

  const w = await sheetWindow(prisma, branch.id, day, sheetDays(place.closesAt, now), now);

  const [beginRows, endRows, moves, catalogue, stillWaiting] = await Promise.all([
    w.begin
      ? prisma.stockDayBalance.findMany({ where: { branchId: branch.id, day: w.begin.day }, select: { rawMaterialId: true, endingQty: true } })
      : Promise.resolve(null),
    w.end
      ? prisma.stockDayBalance.findMany({ where: { branchId: branch.id, day: w.end.day }, select: { rawMaterialId: true, endingQty: true } })
          .then((rows) => rows.map((r) => ({ rawMaterialId: r.rawMaterialId, quantity: r.endingQty })))
      : prisma.rawMaterialInventory.findMany({ where: { tenantId, branchId: branch.id }, select: { rawMaterialId: true, quantity: true } }),
    movementsInWindow(prisma, tenantId, branch.id, w.from, w.to),
    stationItems(prisma, tenantId),
    w.status === 'LIVE'
      ? prisma.orderItem.count({
          where: { ...WAITING_LINE, order: { tenantId, branchId: branch.id, deletedAt: null, status: { in: [...HOLDING_STATUSES] } } },
        })
      : Promise.resolve(0),
  ]);

  const begin = beginRows ? new Map(beginRows.map((r) => [r.rawMaterialId, Number(r.endingQty)])) : null;
  const end = new Map(endRows.map((r) => [r.rawMaterialId, Number(r.quantity)]));
  const stationName = new Map(catalogue.stations.map((s) => [s.id, s.name]));

  // Which rows, and under which heading.
  const chosen: Array<{ id: string; section: SectionKey; alsoOn: string[] }> = [];
  for (const [id, item] of catalogue.items) {
    const kindSection: SectionKey = item.isPrep ? 'PREMADE' : item.category === 'INGREDIENT' ? 'INGREDIENTS' : 'SUPPLIES';
    if (!station) {
      chosen.push({ id, section: kindSection, alsoOn: [] });
      continue;
    }
    const onlyUnrouted = item.on.size === 1 && item.on.has(UNROUTED);
    if (!item.on.has(station.id) && !onlyUnrouted) continue;
    chosen.push({
      id,
      section: onlyUnrouted ? 'UNROUTED' : kindSection,
      alsoOn: [...item.on].filter((s) => s !== station.id && s !== UNROUTED).map((s) => stationName.get(s)).filter((n): n is string => !!n).sort(),
    });
  }

  const packOf = await sheetPackSizes(prisma, tenantId, chosen.map((c) => c.id));

  const zero: SheetMovement = { in: 0, waste: 0, used: 0 };
  const bySection = new Map<SectionKey, SheetRow[]>();
  let anyAdjust = false;
  for (const c of chosen) {
    const item = catalogue.items.get(c.id)!;
    const numbers = sheetRow(begin ? begin.get(c.id) ?? 0 : null, moves.get(c.id) ?? zero, end.get(c.id) ?? 0);
    if (numbers.adjust !== 0) anyAdjust = true;
    const packSize = packOf.get(c.id) ?? null;
    const cell = (q: number, kind: 'balance' | 'movement' | 'adjust') => sheetAmount(q, item.unit, packSize, kind);
    const row: SheetRow = {
      rawMaterialId: c.id,
      name: item.name,
      unit: item.unit,
      packSize,
      alsoOn: c.alsoOn,
      ...numbers,
      cells: {
        beginning: cell(numbers.beginning, 'balance'),
        in:        cell(numbers.in, 'movement'),
        waste:     cell(numbers.waste, 'movement'),
        used:      cell(numbers.used, 'movement'),
        ending:    cell(numbers.ending, 'balance'),
        adjust:    cell(numbers.adjust, 'adjust'),
      },
    };
    bySection.set(c.section, [...(bySection.get(c.section) ?? []), row]);
  }

  // A heading with no rows under it is left off.
  const sections = SECTION_ORDER
    .filter((key) => (bySection.get(key)?.length ?? 0) > 0)
    .map((key) => ({
      key,
      title: SECTION_TITLES[key],
      rows: (bySection.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return {
    shop: { name: place.tenant.name },
    station,
    branch,
    title: `${(station?.name ?? 'Daily').toUpperCase()} INVENTORY`,
    day: w.day,
    dayLabel: sheetDayLabel(w.day),
    today: w.today,
    previousDay: w.previousDay,
    previousDayLabel: w.previousDay ? shortDayLabel(w.previousDay) : null,
    nextDay: w.nextDay,
    nextDayLabel: w.nextDay ? shortDayLabel(w.nextDay) : null,
    status: w.status,
    window: { from: w.from.toISOString(), to: w.to.toISOString(), fromLabel: dayTimeLabel(w.from), toLabel: dayTimeLabel(w.to) },
    notes: sheetNotes(w, { stillWaiting, anyAdjust, now }),
    stillWaiting,
    showAdjust: anyAdjust,
    sections,
  };
}
