import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PH_TIMEZONE } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramAlertsService } from '../telegram/telegram-alerts.service';
import { StationRequestService } from '../procure/station-request.service';
import { lateSalesNote, money, usageQty } from '../telegram/messages';
import { BRANCH_CLOSES_AT_PATTERN } from '../tenant/dto/branch.dto';
import { IngredientReportsService } from './ingredient-reports.service';
import { ReportsService } from '../reports/reports.service';
import { DAY_MS, manilaDayOf, manilaDayStart, UsageDay } from './daily-usage';
import { closingSaves, dayBefore, saveClosingBalances } from './stock-day-balances';
import { weeklyCountNote } from '../procure/weekly-count';

/**
 * The daily "ingredients used" sheet, sent when a branch's day is closed.
 *
 * The day closes when the last shift of the day is closed (ShiftsService calls
 * closeDayAtLastShift). If nobody closes it, this job closes it 2 hours after
 * the branch's closing time -- or at 03:30 Manila for a branch with no closing
 * time. Whichever comes first wins; the other finds the day already closed.
 *
 * Cafe staff write this sheet by hand at the end of the day. Every five
 * minutes this looks for branches whose sheet is due and sends the owner and
 * that branch's managers what was used: a bell notification in Clerque and,
 * for those who linked it, a Telegram message.
 *
 * A sheet covers the hours since the day before closed, not a calendar day.
 * A cafe closing at 01:00 sells its last lattes after midnight, and a sheet
 * cut at midnight would put them on the next night's sheet. Back-to-back
 * windows also mean nothing recorded between two sheets -- a write-off after
 * the send, a prep batch at night -- is left off both.
 *
 * Once per branch per business day. A restart, a deploy or two runs at once
 * (a slow run overlapping the next one, or two API instances) must never send
 * it twice, so the send is claimed under a database lock keyed on the branch
 * and the day, and the bell notification written under that lock is the
 * record that the day went out. Telegram goes only from the run that wrote it.
 *
 * NotificationsService.create's own repeat check is not used for this: it
 * reads then inserts with no lock, so two overlapping runs could both insert,
 * and it matches the exact words -- a late sale changes the words, and the
 * day would go out again.
 *
 * Nothing goes to demo shops (anyone can log in to those) or suspended ones,
 * the same rule the Telegram links apply. Days with nothing used and nothing
 * sold are skipped: a blank sheet every night for a closed shop is noise.
 *
 * At the same moment, before any message is built, each branch's stock is
 * saved as that day's closing balance (stock-day-balances.ts): the Beginning of
 * the next day's inventory sheet on the kitchen and bar screens. That save is
 * data, not a message, so it runs for demo shops and for branches with no
 * closing time too.
 *
 * When the day closes, a branch whose kitchen and bar sent no buy list for the
 * next shopping gets one sent anyway (StationRequestService). Like the
 * message, that skips demo shops and branches with no closing time.
 */

/**
 * When nobody closes the last shift, how long after the closing time Clerque
 * closes the day itself. Long enough for staff still closing up -- the leftover
 * milk written off, the last tickets marked ready, tomorrow's syrup -- to finish
 * and close their shift, which closes the day at that moment instead.
 */
export const FALLBACK_AFTER_CLOSE_MS = 2 * 60 * 60 * 1000;

/**
 * How long after the fallback moment a day not closed yet is still closed and
 * sent. The job runs every five minutes, so a day due at 23:57 is only seen at
 * 00:00 -- on the next calendar day -- and a deploy or restart can straddle it.
 * Kept short so that setting a closing time in the morning does not send last
 * night's report out of the blue.
 */
export const CATCH_UP_MS = 3 * 60 * 60 * 1000;

/**
 * A last shift closed this long or less before the closing time ends the day.
 * Earlier than that it is a handover: the morning cashier closing before the
 * afternoon one opens, with the day's trade still to come.
 */
export const LAST_SHIFT_BEFORE_CLOSE_MS = 2 * 60 * 60 * 1000;

/**
 * With no closing time, a last shift closed from 17:00 up to 04:00 Manila ends
 * the day; any other hour is taken as a handover.
 */
export const EVENING_FROM_HOUR = 17;
export const NIGHT_UNTIL_HOUR = 4;

/** How many ingredients the bell names; the rest are on the report page. */
const BELL_ITEMS = 5;

/**
 * Where a sheet's hours start, given when it is sent. Kept on its own so the
 * window can later start at the previous saved stock count instead.
 */
export function windowStart(sendAt: Date): Date {
  return new Date(sendAt.getTime() - DAY_MS);
}

/**
 * The date a sheet sent at `sendAt` is named for: the Manila day most of its
 * 24 hours fall in. A day closed at 03:00 or 06:30 names the evening before,
 * whose trade it mostly is; one closed at 23:00 names today.
 */
export function sheetDay(sendAt: Date): string {
  return manilaDayOf(new Date(sendAt.getTime() - DAY_MS / 2));
}

export interface DueSheet {
  /** YYYY-MM-DD, Manila: the sheet's name, and the key that stops it going out twice. */
  day: string;
  /** Inclusive. */
  from: Date;
  /** Exclusive: the moment the sheet is due, so the next sheet starts exactly here. */
  to: Date;
}

/**
 * The latest moment a sheet came due at or before `now`, for a branch closing
 * at `closesAt` (HH:mm, already checked).
 */
export function lastDueAt(closesAt: string, now: Date, afterCloseMs = FALLBACK_AFTER_CLOSE_MS): Date {
  /*
    Manila keeps no daylight saving, so each is 24 hours after the one before.
    It can take two steps back: a 23:50 closing falls due at 01:50, so at 00:10
    today's and yesterday's are both still ahead -- and sending at 00:10 would
    read a window that ends in the future, leaving 00:10 to 01:50 on no sheet.
  */
  let to = new Date(new Date(`${manilaDayOf(now)}T${closesAt}:00+08:00`).getTime() + afterCloseMs);
  while (to.getTime() > now.getTime()) to = new Date(to.getTime() - DAY_MS);
  return to;
}

/**
 * The day the job closes at `now` for a branch closing at `closesAt` (when
 * nobody closed the last shift), or null when no fallback moment has come
 * within the catch-up window.
 * `afterCloseMs` is how long after closing it falls due: 2 hours for a
 * closing time, none for a branch with no closing time (03:30 Manila).
 */
export function reportDue(closesAt: string, now: Date, afterCloseMs = FALLBACK_AFTER_CLOSE_MS): DueSheet | null {
  if (!BRANCH_CLOSES_AT_PATTERN.test(closesAt)) return null;
  const to = lastDueAt(closesAt, now, afterCloseMs);
  // From the fallback moment itself: it is already 2 hours after closing, so counting from the closing would leave one hour.
  if (now.getTime() - to.getTime() > CATCH_UP_MS) return null;
  return { day: sheetDay(to), from: windowStart(to), to };
}

/**
 * When the job closes the day of a branch with no closing time: late enough
 * that any evening's trade is over. It names the day before (sheetDay), whose
 * trade it is.
 */
export const DEFAULT_SAVE_AT = '03:30';

/** When a branch's day closes if no shift closes it: 2 hours after its closing time, or 03:30 with no (readable) closing time. */
export function closingClock(closesAt: string | null | undefined): { at: string; afterCloseMs: number } {
  return closesAt && BRANCH_CLOSES_AT_PATTERN.test(closesAt)
    ? { at: closesAt, afterCloseMs: FALLBACK_AFTER_CLOSE_MS }
    : { at: DEFAULT_SAVE_AT, afterCloseMs: 0 };
}

/** The Manila hour (0-23) at `at`. Manila keeps no daylight saving, so it is UTC+8 all year. */
function manilaHour(at: Date): number {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
}

/**
 * The day a last shift closed at `closedAt` ends, or null when that close is
 * not the end of the day.
 *
 * It ends the day whose fallback moment is next (or just passed, within the
 * catch-up), and is named the way the job would name that day -- so whichever
 * of the two closes it, the day has one name, and a close at 00:30 names the
 * evening before.
 *
 * Too early is a handover, not the end of the day: before 2 hours ahead of the
 * closing time, or with no closing time, from 04:00 to 16:59 Manila.
 * `to` is the close; `from` is 24 hours before, used only when the day before
 * has no saved balance.
 */
export function lastShiftCloseDue(closesAt: string | null | undefined, closedAt: Date): DueSheet | null {
  const clock = closingClock(closesAt);
  const last = lastDueAt(clock.at, closedAt, clock.afterCloseMs);
  const fallback = closedAt.getTime() - last.getTime() <= CATCH_UP_MS ? last : new Date(last.getTime() + DAY_MS);
  if (closesAt && BRANCH_CLOSES_AT_PATTERN.test(closesAt)) {
    const closing = fallback.getTime() - clock.afterCloseMs;
    if (closedAt.getTime() < closing - LAST_SHIFT_BEFORE_CLOSE_MS) return null;
  } else {
    const hour = manilaHour(closedAt);
    if (hour >= NIGHT_UNTIL_HOUR && hour < EVENING_FROM_HOUR) return null;
  }
  return { day: sheetDay(fallback), from: windowStart(closedAt), to: closedAt };
}

/**
 * The closing balance the job saves at `now`, or null. The same moment and the
 * same day name as the usage message, so the saved balance, the message and
 * the daily sheet all agree on which business day an hour belongs to.
 */
export function saveDue(closesAt: string | null | undefined, now: Date): DueSheet | null {
  const clock = closingClock(closesAt);
  return reportDue(clock.at, now, clock.afterCloseMs);
}

/**
 * Which daily sheets exist at `now` for a branch, by the fallback clock: the
 * one running, and the one whose fallback moment came last. A day closed
 * earlier by its last shift is found by its save (stock-day-balances.ts).
 */
export interface SheetDays {
  /** The sheet running now; if no shift closes it, its closing balance is saved at `runningDueAt`. */
  running: string;
  runningDueAt: Date;
  /** The sheet whose fallback moment came last, at `lastDueAt`. */
  last: string;
  lastDueAt: Date;
  /** Still within the catch-up window: its save may not have been written yet. */
  lastInCatchUp: boolean;
  /** When any business day's fallback moment falls; the day before's is 24 hours earlier. */
  dueAt: (day: string) => Date;
}

/**
 * When business day `day` closes if no shift closes it. A fallback after
 * midnight falls on the calendar day after the day it names, so the day is
 * found the same way the message names it (sheetDay), not assumed.
 */
export function closingDueAt(closesAt: string | null | undefined, day: string): Date {
  const clock = closingClock(closesAt);
  let at = new Date(new Date(`${day}T${clock.at}:00+08:00`).getTime() + clock.afterCloseMs);
  while (sheetDay(at) < day) at = new Date(at.getTime() + DAY_MS);
  while (sheetDay(at) > day) at = new Date(at.getTime() - DAY_MS);
  return at;
}

export function sheetDays(closesAt: string | null | undefined, now: Date): SheetDays {
  const clock = closingClock(closesAt);
  const last = lastDueAt(clock.at, now, clock.afterCloseMs);
  const running = new Date(last.getTime() + DAY_MS);
  return {
    running:       sheetDay(running),
    runningDueAt:  running,
    last:          sheetDay(last),
    lastDueAt:     last,
    // Counted from the fallback moment, the same as reportDue.
    lastInCatchUp: now.getTime() - last.getTime() <= CATCH_UP_MS,
    dueAt:         (day) => closingDueAt(closesAt, day),
  };
}

/**
 * Where the bell opens. It also marks the day as sent, so it names the branch
 * and the day. Stock lives in Procure, so the bell stays there (the same page
 * as /pos/inventory/reports, in the Procure shell).
 */
export function usageReportLink(branchId: string, day: string): string {
  return `/procure/stock/reports?from=${day}&to=${day}&branchId=${branchId}`;
}

/**
 * Every link a day may have been sent under: the current one and the one the
 * bell used before it moved into Procure. Matched on both, so a day already
 * sent under the old link on the day this ships is not sent a second time.
 */
export function usageReportLinks(branchId: string, day: string): string[] {
  return [usageReportLink(branchId, day), `/pos/inventory/reports?from=${day}&to=${day}&branchId=${branchId}`];
}

/**
 * The bell's words: the top few ingredients, the value, what is not counted
 * yet, sales that reached Clerque too late for any sheet, and the weekly
 * count's sentence when it has one.
 */
export function usageBellBody(usage: UsageDay, lateSales = 0, countNote: string | null = null): string {
  const parts: string[] = [];
  if (usage.rows.length === 0) {
    parts.push(usage.stillBeingMade > 0
      ? 'No ingredients were counted yet.'
      // Nothing counted and nothing waiting goes out only when something sold -- or only for the late sales below.
      : lateSales > 0
        ? 'No ingredients were counted.'
        : 'Items were sold but no ingredients were counted. They may have no recipe yet.');
  } else {
    const top = usage.rows.slice(0, BELL_ITEMS).map((r) => `${r.name} ${usageQty(r.total, r.unit)}`);
    const more = usage.rows.length - BELL_ITEMS;
    parts.push(`${top.join(' · ')}${more > 0 ? ` · +${more} more` : ''}.`);
    if (usage.totals.value > 0) parts.push(`Value at cost ₱${money(usage.totals.value)}.`);
    const lost = usage.totals.wastedValue + usage.totals.writtenOffValue;
    if (lost > 0) parts.push(`Wasted or written off: ₱${money(lost)}.`);
  }
  if (usage.stillBeingMade > 0) {
    const n = usage.stillBeingMade;
    parts.push(`${n} item${n === 1 ? '' : 's'} still at the kitchen or bar screen ${n === 1 ? 'is' : 'are'} not counted yet.`);
  }
  if (lateSales > 0) parts.push(lateSalesNote(lateSales));
  if (countNote) parts.push(countNote);
  return parts.join(' ');
}

type ClosingBranch = { id: string; tenantId: string; name: string; closesAt: string | null };

/**
 * What closing the last shift did to the day:
 *   CLOSED          it was the end of the day, and the day was closed (or already was: each step keeps its own once-only guard)
 *   NOT_END_OF_DAY  too early -- a handover, so nothing was done
 *   SKIPPED         an inactive branch, a suspended shop, or the branch could not be read
 */
export type LastShiftDayClose = 'CLOSED' | 'NOT_END_OF_DAY' | 'SKIPPED';

@Injectable()
export class EndOfDayScheduler {
  private readonly logger = new Logger(EndOfDayScheduler.name);
  /** Branches already warned about an unreadable closing time, so the log says it once, not every five minutes. */
  private readonly warnedBadTime = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: IngredientReportsService,
    /*
      The day's Z-Read. Not optional: a day with no Z-Read is a missing BIR
      record and nothing else writes it, so a wiring mistake must stop the API
      at boot rather than go unnoticed until an audit. ReportsModule depends
      on nothing but Prisma, so there is no cycle.
    */
    private readonly zReads: ReportsService,
    // Optional like every other Telegram caller: the bell still goes when Telegram is not wired in.
    @Optional() private readonly telegram?: TelegramAlertsService,
    // The closing-time buy list. Optional so the usage message still goes where Procure is not wired in.
    @Optional() private readonly closingList?: StationRequestService,
  ) {}

  /**
   * Every five minutes, Manila time. Returns how many branches were sent their day. Never throws.
   * `clock` stamps a closing save with the moment the stock is read, never the run's start.
   */
  @Cron('*/5 * * * *', { timeZone: PH_TIMEZONE })
  async run(now: Date = new Date(), clock: () => Date = () => new Date()): Promise<number> {
    // First, so the saved balance is as close to closing as possible and the message below can cover the same hours.
    await this.saveDueBalances(now, clock);

    let branches: ClosingBranch[];
    try {
      branches = await this.prisma.branch.findMany({
        where: {
          isActive: true,
          closesAt: { not: null },
          tenant:   { isDemoTenant: false, status: { not: 'SUSPENDED' } },
        },
        select:  { id: true, tenantId: true, name: true, closesAt: true },
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error(`Could not read the branches with a closing time: ${err instanceof Error ? err.message : err}`);
      return 0;
    }

    let sent = 0;
    for (const branch of branches) {
      try {
        if (await this.sendIfDue(branch, now)) sent++;
      } catch (err) {
        // One branch's failure must not cost every other branch its report.
        this.logger.error(`End-of-day usage failed for branch ${branch.id} (shop ${branch.tenantId}): ${err instanceof Error ? err.message : err}`);
      }
      await this.sendClosingList(branch, now);
    }
    if (sent > 0) this.logger.log(`Sent the end-of-day ingredient usage for ${sent} branch(es).`);
    return sent;
  }

  /**
   * The last shift of the day was closed at a branch: close the day now, the
   * same three steps the job takes at the fallback moment -- save the closing
   * balance, send the day's usage message, and send the buy list if the
   * kitchen and bar sent none -- named for the same business day, with the
   * message ending at the saved balance's read time.
   *
   * Called by ShiftsService after the shift close has committed, and not
   * waited on. A close too early to be the end of the day (a handover) does
   * nothing. A day already closed -- by the job, or by an earlier last shift
   * that night -- is not saved or sent again: the save, the message and the
   * list each keep their own once-only guard.
   *
   * Never throws: a cashier's drawer must close whatever happens here.
   */
  async closeDayAtLastShift(
    tenantId: string,
    branchId: string,
    closedAt: Date,
    clock: () => Date = () => new Date(),
  ): Promise<LastShiftDayClose> {
    let branch: ClosingBranch & { isActive: boolean; tenant: { isDemoTenant: boolean; status: string } } | null;
    try {
      branch = await this.prisma.branch.findFirst({
        where:  { id: branchId, tenantId },
        select: { id: true, tenantId: true, name: true, closesAt: true, isActive: true, tenant: { select: { isDemoTenant: true, status: true } } },
      });
    } catch (err) {
      this.logger.error(`Could not read branch ${branchId} (shop ${tenantId}) to close its day after the last shift: ${err instanceof Error ? err.message : err}`);
      return 'SKIPPED';
    }
    // The job's own rule for saves: every active branch of a shop that is not suspended.
    if (!branch || !branch.isActive || branch.tenant.status === 'SUSPENDED') return 'SKIPPED';

    const due = lastShiftCloseDue(branch.closesAt, closedAt);
    if (!due) return 'NOT_END_OF_DAY';
    const place: ClosingBranch = { id: branch.id, tenantId: branch.tenantId, name: branch.name, closesAt: branch.closesAt };

    try {
      // Null when the day was already saved: the job's fallback or an earlier last shift got there first.
      const saved = await saveClosingBalances(this.prisma, place, due.day, clock);
      if (saved != null) this.logger.log(`Saved the closing stock for branch ${branchId} (shop ${tenantId}), day ${due.day}, at its last shift close.`);
    } catch (err) {
      // The message and the list still go: they do not need the save, and the job retries the save within its catch-up.
      this.logger.error(`Saving the closing stock failed for branch ${branchId} (shop ${tenantId}), day ${due.day}, at its last shift close: ${err instanceof Error ? err.message : err}`);
    }

    // Like the job: no message and no list for demo shops, or for branches with no (readable) closing time.
    if (branch.tenant.isDemoTenant || !branch.closesAt || !BRANCH_CLOSES_AT_PATTERN.test(branch.closesAt)) return 'CLOSED';
    try {
      if (await this.sendDay(place, due)) this.logger.log(`Sent the end-of-day ingredient usage for branch ${branchId} (shop ${tenantId}), day ${due.day}, at its last shift close.`);
    } catch (err) {
      // Nothing was claimed, so the job sends it at the fallback moment.
      this.logger.error(`End-of-day usage failed for branch ${branchId} (shop ${tenantId}), day ${due.day}, at its last shift close: ${err instanceof Error ? err.message : err}`);
    }
    // The close itself is the closing: a list tapped before it already asked for the next shopping.
    await this.askClosingList(place, { ...due, closedAt: due.to }, closedAt);
    return 'CLOSED';
  }

  /**
   * Saves the closing balance of every branch whose fallback moment has just
   * come. Returns how many branches this call saved. Never throws.
   *
   * Every active branch of a shop that is not suspended -- demo shops too, and
   * branches with no closing time (at 03:30): this is the stock record the
   * daily sheet reads, not a message to anyone. A day already closed by its
   * last shift is found saved and left alone.
   */
  async saveDueBalances(now: Date, clock: () => Date = () => new Date()): Promise<number> {
    let branches: Array<{ id: string; tenantId: string; closesAt: string | null }>;
    try {
      branches = await this.prisma.branch.findMany({
        where:   { isActive: true, tenant: { status: { not: 'SUSPENDED' } } },
        select:  { id: true, tenantId: true, closesAt: true },
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error(`Could not read the branches to save closing stock for: ${err instanceof Error ? err.message : err}`);
      return 0;
    }

    let saved = 0;
    for (const branch of branches) {
      const due = saveDue(branch.closesAt, now);
      if (!due) continue;
      try {
        if ((await saveClosingBalances(this.prisma, branch, due.day, clock)) != null) saved++;
      } catch (err) {
        // One branch's failure must not cost every other branch its saved balance, or its message.
        this.logger.error(`Saving the closing stock failed for branch ${branch.id} (shop ${branch.tenantId}), day ${due.day}: ${err instanceof Error ? err.message : err}`);
      }
      await this.writeZRead(branch, due.day);
    }
    if (saved > 0) this.logger.log(`Saved the closing stock for ${saved} branch(es).`);
    return saved;
  }

  /**
   * The day's Z-Read, written here when the day closes on the fallback clock.
   *
   * The Z-Read is the day's sealed sales total -- the daily record a BIR CAS
   * is expected to keep -- and closing the last shift of the day writes it
   * (ShiftsService). But a shift close only counts as the end of the day when
   * it is near the branch's closing time, or in the evening for a branch with
   * no closing time set; a quiet Tuesday shut two hours early, or a shop that
   * never filled in its closing time and shuts at half four, closed the
   * drawer and wrote nothing. No screen posts /reports/z-read, so that day's
   * record simply did not exist.
   *
   * So the other end of the day writes it too: the same fallback moment that
   * saves the closing stock, for the same branch and the same business day
   * name. Whichever of the two closes the day writes the one row -- and
   * because both name the day with sheetDay, they converge on it rather than
   * making two.
   *
   * Only when the day has none: a Z-Read already written by the shift close
   * keeps its totals and the name of the cashier who closed. Never throws --
   * a Z-Read that could not be built must not cost the other branches their
   * closing stock, and the owner can regenerate it from Reports.
   */
  private async writeZRead(branch: { id: string; tenantId: string }, day: string): Promise<boolean> {
    try {
      /*
        A cheap look first: this runs every five minutes for the hours of the
        catch-up window. ZReadLog.date is a date-only column keyed on UTC
        midnight of the day as named (reports.service.ts, generateZRead).
      */
      const already = await this.prisma.zReadLog.findFirst({
        where:  { branchId: branch.id, date: new Date(`${day}T00:00:00Z`) },
        select: { id: true },
      });
      if (already) return false;
      await this.zReads.generateZRead(branch.tenantId, branch.id, day);
      this.logger.log(`Wrote the Z-Read for branch ${branch.id} (shop ${branch.tenantId}), day ${day}, as its day closed.`);
      return true;
    } catch (err) {
      this.logger.error(`Writing the Z-Read failed for branch ${branch.id} (shop ${branch.tenantId}), day ${day}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /**
   * The buy list for the next shopping, for a branch whose kitchen and bar
   * never tapped "Request what's running low": sent when the day closes, at
   * the fallback moment here (closing + 2 hours), named for the same business
   * day, whether or not the message itself had anything to say. Procure
   * decides whether a list already went out -- at an earlier last shift close,
   * or on a run before this one -- so the runs after it send nothing more.
   * Never throws.
   */
  private async sendClosingList(branch: ClosingBranch, now: Date): Promise<void> {
    if (!branch.closesAt) return;
    const due = reportDue(branch.closesAt, now);
    if (!due) return;
    // The closing itself, not the fallback moment: a list tapped between the two already asked for the next shopping.
    const closedAt = new Date(due.to.getTime() - FALLBACK_AFTER_CLOSE_MS);
    await this.askClosingList(branch, { ...due, closedAt }, now);
  }

  /** Asks Procure for the closing buy list of one branch's day. Never throws. */
  private async askClosingList(branch: ClosingBranch, due: DueSheet & { closedAt: Date }, now: Date): Promise<void> {
    if (!this.closingList) return;
    try {
      const result = await this.closingList.sendAtClosingIfNothingSent(branch, due, now);
      if (result === 'SENT') this.logger.log(`Sent the closing buy list for branch ${branch.id} (shop ${branch.tenantId}), day ${due.day}.`);
    } catch (err) {
      // It is not meant to throw; this only keeps a future change from costing the other branches their list.
      this.logger.error(`Closing buy list failed for branch ${branch.id} (shop ${branch.tenantId}), day ${due.day}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** True when this call sent the branch its day (the job's fallback moment). */
  async sendIfDue(branch: ClosingBranch, now: Date): Promise<boolean> {
    if (!branch.closesAt || !BRANCH_CLOSES_AT_PATTERN.test(branch.closesAt)) {
      if (!this.warnedBadTime.has(branch.id)) {
        this.warnedBadTime.add(branch.id);
        this.logger.warn(`Branch ${branch.id} has a closing time Clerque cannot read ("${branch.closesAt}"); no end-of-day usage until it is fixed.`);
      }
      return false;
    }
    const due = reportDue(branch.closesAt, now);
    if (!due) return false;
    return this.sendDay(branch, due);
  }

  /**
   * Sends one branch its day, once: from the job at the fallback moment, or
   * at the last shift close. True when this call sent it.
   */
  private async sendDay(branch: ClosingBranch, due: DueSheet): Promise<boolean> {
    const { tenantId } = branch;
    const link = usageReportLink(branch.id, due.day);
    // The day closes at least 8 hours into the day it is named for (sheetDay), so this catches every send of it.
    const sentAlready = { tenantId, link: { in: usageReportLinks(branch.id, due.day) }, createdAt: { gte: manilaDayStart(due.day) } };

    // A cheap look first: after the day went out, each run until the window closes costs this one query.
    if (await this.prisma.notification.findFirst({ where: sentAlready, select: { id: true } })) return false;

    // The same people the Telegram message goes to: the owner, and managers of this branch or of every branch.
    const people = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { role: 'BUSINESS_OWNER' },
          { role: 'BRANCH_MANAGER', OR: [{ branchId: null }, { branchId: branch.id }] },
        ],
      },
      select:  { id: true },
      orderBy: { id: 'asc' },
    });
    if (people.length === 0) return false;

    const hours = await this.usageHours(branch.id, due);
    const usage = await this.reports.usageForWindow(tenantId, branch.id, due.day, hours.from, hours.to);
    const lateSales = await this.lateSales(tenantId, branch.id, hours);
    if (
      usage.rows.length === 0 && usage.stillBeingMade === 0 && lateSales === 0
      && !(await this.soldIn(tenantId, branch.id, hours.from, hours.to))
    ) {
      return false;
    }

    const countNote = await this.countNote(tenantId, branch.id, hours, due.day);
    const title = `Ingredients used today — ${branch.name}`;
    const body = usageBellBody(usage, lateSales, countNote);
    const dedupeKey = `usage-day-${branch.id}-${due.day}`;
    const claimed = await this.prisma.$transaction(async (tx) => {
      /*
        Two runs for the same branch and day queue here. The one that goes
        second sees the first one's notifications once it commits, and stops.
        Taken as $executeRaw like the recipe catch-up's lock: the lock
        function returns void, which $queryRaw cannot read back.
      */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey}))`;
      if (await tx.notification.findFirst({ where: sentAlready, select: { id: true } })) return false;
      // One per person, not one for the shop: a shop-wide notification has one "read" flag for everyone.
      await tx.notification.createMany({
        data: people.map((p) => ({ tenantId, userId: p.id, kind: 'INFO' as const, title, body, link })),
      });
      return true;
    });
    if (!claimed) return false;

    /*
      After the claim commits, so a failed claim never sends; the method logs
      its own failures and never rejects. It is handed the reading the bell was
      built from, so the phone and the bell always show the same numbers.
    */
    // The weekly count's sentence only when there is one: a day without it goes out exactly as before.
    await this.telegram?.dailyUsage(tenantId, branch.id, usage, lateSales, ...(countNote ? [countNote] : []));
    return true;
  }

  /**
   * The weekly count's sentence for the day's message: recorded today, or
   * none sent for a week. Only a sentence -- a failure to read it leaves it
   * off and the day still goes out.
   */
  private async countNote(tenantId: string, branchId: string, hours: DueSheet, day: string): Promise<string | null> {
    try {
      return await weeklyCountNote(this.prisma, tenantId, branchId, { from: hours.from, to: hours.to, day });
    } catch (err) {
      this.logger.warn(`Could not read the weekly count for branch ${branchId} (shop ${tenantId}), day ${day}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * The hours the message covers: from the closing balance saved for the day
   * before to the one saved for this day, so the message and the daily
   * inventory sheet on the kitchen and bar screens cover exactly the same
   * hours. A save is stamped when the stock was read, a moment after the day
   * closed; a message ending at the close would leave that moment on none.
   *
   * The save ends the message even when it is earlier than `due.to`: a day
   * closed by its last shift at 20:40 and sent by the job at 23:00 (its first
   * send failed) still ends at 20:40, where the next day's sheet begins.
   *
   * The 24 hours up to the close when a save is missing -- a branch with no
   * stock rows has none, and a save can fail. Only the day before's save
   * counts as the start: one from further back would put a day that already
   * went out on this message again.
   */
  private async usageHours(branchId: string, due: DueSheet): Promise<DueSheet> {
    const before = dayBefore(due.day);
    const saved = await closingSaves(this.prisma, branchId, [before, due.day]);
    const to = saved.get(due.day) ?? due.to;
    const start = saved.get(before);
    const from = start && start.getTime() < to.getTime() ? start : due.from;
    return { day: due.day, from, to };
  }

  /** Whether the branch took a sale in the window: sales with nothing counted still get a (short) report. */
  private async soldIn(tenantId: string, branchId: string, from: Date, to: Date): Promise<boolean> {
    const n = await this.prisma.order.count({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        status:    { in: ['PAID', 'COMPLETED', 'RETURNED'] },
        // Dated like the usage report: when it was paid, or when it was made for an order with no payment time.
        OR: [
          { paidAt: { gte: from, lt: to } },
          { paidAt: null, createdAt: { gte: from, lt: to } },
        ],
      },
    });
    return n > 0;
  }

  /**
   * Sales that are on no sheet: rung up offline before this window, but
   * reaching Clerque only after the last sheet was read. The till keeps the
   * time it rang the sale, and the sheets count sales by that time, so the
   * last sheet was read before they arrived and this one starts after them.
   * Nothing else would ever tell the staff their milk is missing.
   *
   * Counted once each: the next sheet only looks at what arrived after this
   * one went out. A till offline for days is still caught -- there is no
   * lower limit on when the sale was rung up.
   */
  private async lateSales(tenantId: string, branchId: string, due: DueSheet): Promise<number> {
    // The last sheet is the one due when this window starts; it went out when its bell was written.
    const lastDay = sheetDay(due.from);
    const last = await this.prisma.notification.findFirst({
      where:   { tenantId, link: { in: usageReportLinks(branchId, lastDay) }, createdAt: { gte: manilaDayStart(lastDay) } },
      orderBy: { createdAt: 'asc' },
      select:  { createdAt: true },
    });
    return this.prisma.order.count({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        // Voided too: what was made for a voided sale still left the shelf, and the report counts it as wasted.
        status:    { in: ['PAID', 'COMPLETED', 'RETURNED', 'VOIDED'] },
        paidAt:    { lt: due.from },
        // No last sheet (a quiet day skipped, or no closing time yet): it would have been read when it was due.
        createdAt: { gt: last?.createdAt ?? due.from },
      },
    });
  }
}
