import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PH_TIMEZONE } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramAlertsService } from '../telegram/telegram-alerts.service';
import { lateSalesNote, money, usageQty } from '../telegram/messages';
import { BRANCH_CLOSES_AT_PATTERN } from '../tenant/dto/branch.dto';
import { IngredientReportsService } from './ingredient-reports.service';
import { DAY_MS, manilaDayOf, manilaDayStart, UsageDay } from './daily-usage';

/**
 * The daily "ingredients used" sheet, sent a little after each branch's
 * closing time.
 *
 * Cafe staff write this sheet by hand at the end of the day. Every five
 * minutes this looks for branches whose sheet is due and sends the owner and
 * that branch's managers what was used: a bell notification in Clerque and,
 * for those who linked it, a Telegram message.
 *
 * A sheet covers the 24 hours up to the moment it is due, not a calendar day.
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
 */

/**
 * Staff keep recording after the doors close: the leftover milk written off,
 * the last tickets marked ready, tomorrow's syrup. Sending a little later lets
 * that closing-up work reach the sheet. Well inside CATCH_UP_MS.
 */
export const SEND_AFTER_CLOSE_MS = 30 * 60 * 1000;

/**
 * How long after closing a report not sent yet still goes out. The job runs
 * every five minutes, so a sheet due at 23:57 is only seen at 00:00 -- on the
 * next calendar day -- and a deploy or restart can straddle the send.
 * Kept short so that setting a closing time in the morning does not send
 * last night's report out of the blue.
 */
export const CATCH_UP_MS = 3 * 60 * 60 * 1000;

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
 * 24 hours fall in. A 01:00 or 04:30 closing names the evening before, whose
 * trade it mostly is; a 21:00 closing names today.
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
 * The sheet due at `now` for a branch closing at `closesAt`, or null when no
 * sheet has come due since a closing within the catch-up window.
 */
export function reportDue(closesAt: string, now: Date): DueSheet | null {
  if (!BRANCH_CLOSES_AT_PATTERN.test(closesAt)) return null;
  /*
    The latest moment a sheet came due. Manila keeps no daylight saving, so
    each is 24 hours after the one before. It can take two steps back: a
    23:50 closing falls due at 00:20, so at 00:10 today's and yesterday's are
    both still ahead -- and sending at 00:10 would read a window that ends in
    the future, leaving 00:10 to 00:20 on no sheet.
  */
  let to = new Date(new Date(`${manilaDayOf(now)}T${closesAt}:00+08:00`).getTime() + SEND_AFTER_CLOSE_MS);
  while (to.getTime() > now.getTime()) to = new Date(to.getTime() - DAY_MS);
  if (now.getTime() - (to.getTime() - SEND_AFTER_CLOSE_MS) > CATCH_UP_MS) return null;
  return { day: sheetDay(to), from: windowStart(to), to };
}

/** Where the bell opens. It also marks the day as sent, so it names the branch and the day. */
export function usageReportLink(branchId: string, day: string): string {
  return `/pos/inventory/reports?from=${day}&to=${day}&branchId=${branchId}`;
}

/**
 * The bell's words: the top few ingredients, the value, what is not counted
 * yet, and sales that reached Clerque too late for any sheet.
 */
export function usageBellBody(usage: UsageDay, lateSales = 0): string {
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
  return parts.join(' ');
}

type ClosingBranch = { id: string; tenantId: string; name: string; closesAt: string | null };

@Injectable()
export class EndOfDayScheduler {
  private readonly logger = new Logger(EndOfDayScheduler.name);
  /** Branches already warned about an unreadable closing time, so the log says it once, not every five minutes. */
  private readonly warnedBadTime = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: IngredientReportsService,
    // Optional like every other Telegram caller: the bell still goes when Telegram is not wired in.
    @Optional() private readonly telegram?: TelegramAlertsService,
  ) {}

  /** Every five minutes, Manila time. Returns how many branches were sent their day. Never throws. */
  @Cron('*/5 * * * *', { timeZone: PH_TIMEZONE })
  async run(now: Date = new Date()): Promise<number> {
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
    }
    if (sent > 0) this.logger.log(`Sent the end-of-day ingredient usage for ${sent} branch(es).`);
    return sent;
  }

  /** True when this call sent the branch its day. */
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

    const { tenantId } = branch;
    const link = usageReportLink(branch.id, due.day);
    // The sheet is due at least 12 hours into its day, so this catches every send of it.
    const sentAlready = { tenantId, link, createdAt: { gte: manilaDayStart(due.day) } };

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

    const usage = await this.reports.usageForWindow(tenantId, branch.id, due.day, due.from, due.to);
    const lateSales = await this.lateSales(tenantId, branch.id, due);
    if (
      usage.rows.length === 0 && usage.stillBeingMade === 0 && lateSales === 0
      && !(await this.soldIn(tenantId, branch.id, due.from, due.to))
    ) {
      return false;
    }

    const title = `Ingredients used today — ${branch.name}`;
    const body = usageBellBody(usage, lateSales);
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
    await this.telegram?.dailyUsage(tenantId, branch.id, usage, lateSales);
    return true;
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
      where:   { tenantId, link: usageReportLink(branchId, lastDay), createdAt: { gte: manilaDayStart(lastDay) } },
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
