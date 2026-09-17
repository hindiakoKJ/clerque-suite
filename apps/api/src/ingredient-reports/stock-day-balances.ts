import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { DAY_MS, isManilaDay, manilaDayOf, manilaDayStart } from './daily-usage';

/**
 * The closing balance: each branch's stock, saved once per business day at
 * closing, so the next day's inventory sheet starts from a number that was
 * really on the book rather than one worked back from sales.
 *
 * Which business day, and when it closes, is the end-of-day scheduler's rule
 * (lastShiftCloseDue / saveDue / sheetDays there): the day closes when its
 * last shift is closed, or 2 hours after the closing time if nobody closes it,
 * and the saved balance, the usage message and the sheet all name an hour's
 * day the same way. This file only reads and writes the saves.
 */

const HALF_DAY_MS = DAY_MS / 2;
const WEEK_MS = 7 * DAY_MS;

/** The Manila day before a YYYY-MM-DD day. Noon, so no clock can tip it. */
export function dayBefore(day: string): string {
  return manilaDayOf(new Date(manilaDayStart(day).getTime() - HALF_DAY_MS));
}

/** The Manila day after a YYYY-MM-DD day. */
export function dayAfter(day: string): string {
  return manilaDayOf(new Date(manilaDayStart(day).getTime() + DAY_MS + HALF_DAY_MS));
}

type SaveDb = Pick<PrismaService, 'stockDayBalance' | '$transaction'>;

/**
 * Save one branch's closing balance for `day`: every stock row it has, as the
 * book shows it (stock held by waiting tickets included), all stamped with
 * one `takenAt` -- the moment the stock was read, not when the job started.
 *
 * Once per branch per day, never overwritten: a second call returns null and
 * writes nothing. Returns how many rows were saved. Only items with a stock
 * row are saved; once a save exists, an item missing from it had 0.
 */
export async function saveClosingBalances(
  prisma: SaveDb,
  branch: { id: string; tenantId: string },
  day: string,
  clock: () => Date = () => new Date(),
): Promise<number | null> {
  // A cheap look first: the job runs every five minutes for hours after closing.
  if (await prisma.stockDayBalance.findFirst({ where: { branchId: branch.id, day }, select: { id: true } })) return null;
  return prisma.$transaction(async (tx) => {
    // Two runs at once (a slow run overlapping the next, or two servers) queue here; the second finds the first's rows.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock-day-${branch.id}-${day}`}))`;
    if (await tx.stockDayBalance.findFirst({ where: { branchId: branch.id, day }, select: { id: true } })) return null;
    const takenAt = clock(); // the read time, never the job's start time
    const rows = await tx.rawMaterialInventory.findMany({
      where:  { tenantId: branch.tenantId, branchId: branch.id },
      select: { rawMaterialId: true, quantity: true },
    });
    if (rows.length) {
      await tx.stockDayBalance.createMany({
        data: rows.map((r) => ({
          tenantId: branch.tenantId, branchId: branch.id, rawMaterialId: r.rawMaterialId, day, endingQty: r.quantity, takenAt,
        })),
        skipDuplicates: true,
      });
    }
    return rows.length;
  }, { timeout: 30_000 });
}

/** When each of `days` was saved at a branch (days with no save are left out). */
export async function closingSaves(
  db: { stockDayBalance: Pick<Prisma.TransactionClient['stockDayBalance'], 'findMany'> },
  branchId: string,
  days: string[],
): Promise<Map<string, Date>> {
  const rows = await db.stockDayBalance.findMany({
    where:    { branchId, day: { in: days } },
    distinct: ['day'],
    select:   { day: true, takenAt: true },
  });
  return new Map(rows.map((r) => [r.day, r.takenAt]));
}

/** What `sheetDays` in the end-of-day scheduler says about a branch at `now`. */
export interface SheetDaysInput {
  running: string;
  runningDueAt: Date;
  last: string;
  lastDueAt: Date;
  lastInCatchUp: boolean;
  dueAt: (day: string) => Date;
}

export interface SheetWindow {
  day: string;
  /** The newest sheet that can be opened. */
  today: string;
  /** Null when there is no earlier sheet to open. */
  previousDay: string | null;
  nextDay: string | null;
  status: 'LIVE' | 'CLOSED';
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
  /** The save Beginning is read from; null when Beginning is worked back. */
  begin: { day: string; takenAt: Date } | null;
  /** The save Ending is read from; null for the stock as it is now. */
  end: { day: string; takenAt: Date } | null;
  /** Why Beginning is worked back: no save before this day, or the last one is over a week old. */
  workedBack: 'NO_SAVE' | 'TOO_OLD' | null;
  /** A day in the window whose closing balance Clerque did not save. */
  missingSaveDay: string | null;
  /** LIVE only: when this sheet's closing balance is due. */
  closesAt: Date | null;
}

type WindowDb = { stockDayBalance: Pick<Prisma.TransactionClient['stockDayBalance'], 'findFirst'> };

/**
 * The hours a branch's sheet for `day` covers (the default sheet when null).
 *
 * It runs from the closing balance saved before it to its own: CLOSED once
 * that is saved, LIVE (up to now) while it is the newest sheet. A past day
 * whose save is missing runs to the next save. With no save before it, or one
 * over a week old, it starts when the day before's closing fell due (the same
 * hours the usage message covers) and Beginning is worked back from the other
 * columns.
 *
 * Which sheet opens by default: the one that just closed, while its fallback
 * moment is less than the catch-up window ago (staff finishing up want
 * tonight's sheet), else the one running.
 *
 * A day closed early by its last shift is CLOSED from that moment: it still
 * opens by default until its fallback moment's catch-up is over, and the next
 * day can already be opened, LIVE from that close.
 */
export async function sheetWindow(
  db: WindowDb,
  branchId: string,
  day: string | null,
  days: SheetDaysInput,
  now: Date,
): Promise<SheetWindow> {
  if (day != null && !isManilaDay(day)) {
    throw new BadRequestException('The day has to be a real date (YYYY-MM-DD).');
  }
  const savedDay = (d: string) => db.stockDayBalance.findFirst({ where: { branchId, day: d }, select: { day: true, takenAt: true } });

  // While the last closing is being saved, that sheet is still the newest one: the next has not really started.
  const lastSaved = days.lastInCatchUp ? await savedDay(days.last) : null;
  let today = days.lastInCatchUp && !lastSaved ? days.last : days.running;
  let defaultDay = days.lastInCatchUp ? days.last : days.running;
  // The running day already saved means its last shift closed it before the fallback clock: the next day has begun.
  if (today === days.running && await savedDay(days.running)) {
    defaultDay = days.running;
    today = dayAfter(days.running);
  }
  const D = day ?? defaultDay;
  if (D > today) throw new BadRequestException('That day has not started yet.');

  const first = await db.stockDayBalance.findFirst({ where: { branchId }, orderBy: { day: 'asc' }, select: { day: true } });
  if (D < today && (!first || D < first.day)) {
    throw new BadRequestException(first
      ? `There is no sheet before ${first.day}: that is the first day Clerque saved this branch's closing stock.`
      : 'Clerque has not saved a closing balance for this branch yet, so only the current sheet can be shown.');
  }

  const save = await savedDay(D);
  let status: 'LIVE' | 'CLOSED';
  let to: Date;
  let end: SheetWindow['end'] = null;
  let missingSaveDay: string | null = null;
  let closesAt: Date | null = null;
  if (save) {
    status = 'CLOSED';
    to = save.takenAt;
    end = save;
  } else if (D === today) {
    status = 'LIVE';
    to = now;
    closesAt = today === days.running ? days.runningDueAt : today === days.last ? days.lastDueAt : days.dueAt(today);
  } else {
    // A past day with no save: it runs on to the next save, whose stock is its Ending.
    missingSaveDay = D;
    const next = await db.stockDayBalance.findFirst({ where: { branchId, day: { gt: D } }, orderBy: { day: 'asc' }, select: { day: true, takenAt: true } });
    status = next ? 'CLOSED' : 'LIVE';
    to = next?.takenAt ?? now;
    end = next ?? null;
  }

  const prev = await db.stockDayBalance.findFirst({ where: { branchId, day: { lt: D } }, orderBy: { day: 'desc' }, select: { day: true, takenAt: true } });
  let from: Date;
  let begin: SheetWindow['begin'] = null;
  let workedBack: SheetWindow['workedBack'] = null;
  if (!prev || prev.takenAt.getTime() < to.getTime() - WEEK_MS) {
    from = new Date(days.dueAt(D).getTime() - DAY_MS);
    workedBack = prev ? 'TOO_OLD' : 'NO_SAVE';
  } else {
    from = prev.takenAt;
    begin = prev;
    if (!missingSaveDay && prev.day < dayBefore(D)) missingSaveDay = dayBefore(D);
  }
  if (from.getTime() > to.getTime()) from = to;

  return {
    day: D,
    today,
    previousDay: first && dayBefore(D) >= first.day ? dayBefore(D) : null,
    nextDay: D < today ? dayAfter(D) : null,
    status, from, to, begin, end, workedBack, missingSaveDay, closesAt,
  };
}
