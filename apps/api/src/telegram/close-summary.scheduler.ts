import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PH_TIMEZONE } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { DAY_MS, manilaDayOf, manilaDayStart } from '../ingredient-reports/daily-usage';
import { tagNumberFromNote } from '../tags/tag-rules';
import { TelegramClient } from './telegram.client';
import { TelegramLinksService } from './telegram-links.service';
import { ByPerson, CloseSummaryForAlert, closeSummaryMessage } from './messages';

/**
 * The day's close on Telegram: at 21:30 Manila, each branch of a shop where
 * someone listens on the sales switch gets one message with the day so far
 * -- sales and how they were paid, tagged parts with their cost and margin,
 * discounts and who approved them, voids and refunds, the drawers closed, and
 * what the till flagged (sold below menu, a tag sold twice, a roll call's
 * missing parts). To the owner and that branch's managers, the people the
 * sale alerts already go to.
 *
 * Read the same way the Daily report and the Z-Read read the day, so the
 * phone and Reports never tell two stories: a sale is a PAID or COMPLETED
 * order counted by when it was paid; a void by when it was voided; a refund
 * by when the money left, leaving out the refunds of an order later voided.
 *
 * Once per branch per Manila day. The cron fires once a day, but during a
 * deploy at 21:30 the old and the new API both run it. The send is claimed
 * under a database lock keyed on the branch and the day, and the claim is an
 * audit row -- the record that the day's figures were sent out of Clerque to
 * Telegram -- so the run that finds it already there sends nothing.
 *
 * Nothing goes to demo shops or suspended ones, and nothing is read for a
 * shop nobody listens to.
 */

/** The audit row that marks a branch's day as sent. entityId is `${branchId}:${day}`. */
export const DAY_CLOSE_ENTITY = 'TELEGRAM_DAY_CLOSE';

export interface CloseDay {
  /** YYYY-MM-DD, Manila. */
  day:  string;
  /** Inclusive: midnight Manila. */
  from: Date;
  /** Exclusive: the next midnight Manila. */
  to:   Date;
}

/** The Manila business day `now` falls in, midnight to midnight (Manila keeps no daylight saving). */
export function closeSummaryDay(now: Date): CloseDay {
  const day = manilaDayOf(now);
  const from = manilaDayStart(day);
  return { day, from, to: new Date(from.getTime() + DAY_MS) };
}

type Db = Pick<PrismaService, 'order' | 'orderItemRefund' | 'shift' | 'auditLog' | 'user' | 'branch'>;

export type CloseSummaryData = Omit<CloseSummaryForAlert, 'shopName' | 'branchName' | 'day' | 'asOf'>;

const round2 = (n: number) => Math.round(n * 100) / 100;

function json(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Counts and pesos per person id, in the order each person first appears. */
function tally(rows: Array<{ id: string | null; amount: number }>): Array<{ id: string | null; count: number; amount: number }> {
  const by = new Map<string | null, { id: string | null; count: number; amount: number }>();
  for (const r of rows) {
    const t = by.get(r.id) ?? { id: r.id, count: 0, amount: 0 };
    t.count += 1;
    t.amount += r.amount;
    by.set(r.id, t);
  }
  return [...by.values()].map((t) => ({ ...t, amount: round2(t.amount) }));
}

/**
 * One branch's day, read for the close summary. Every query carries the shop
 * and the branch. Audit rows have no branch of their own: the till's flags
 * name an order and are kept when the order is this branch's. A roll call is
 * kept when its `after.branchId` is this branch; with no `after.branchId`, it
 * is kept unless its entityId ("<branchId>:<when>") is another branch's.
 */
export async function loadCloseSummary(db: Db, tenantId: string, branchId: string, bounds: CloseDay): Promise<CloseSummaryData> {
  const { from, to } = bounds;

  const [sales, voids, refunds, drawers, audits] = await Promise.all([
    db.order.findMany({
      where:  { tenantId, branchId, paidAt: { gte: from, lt: to }, status: { in: ['PAID', 'COMPLETED'] } },
      select: {
        totalAmount: true, invoiceType: true,
        payments:  { select: { method: true, amount: true } },
        discounts: { select: { discountType: true, discountAmount: true, authorizedById: true } },
        items: {
          where:   { notes: { startsWith: 'Tag ' } },
          orderBy: { id: 'asc' },
          select:  { productName: true, notes: true, quantity: true, lineTotal: true, costPrice: true, refundedQty: true },
        },
      },
      orderBy: { paidAt: 'asc' },
    }),
    db.order.findMany({
      where:  { tenantId, branchId, status: 'VOIDED', voidedAt: { gte: from, lt: to } },
      select: { totalAmount: true, voidedById: true, voidInitiatedById: true },
      orderBy: { voidedAt: 'asc' },
    }),
    db.orderItemRefund.findMany({
      where:  { createdAt: { gte: from, lt: to }, orderItem: { order: { tenantId, branchId, status: { not: 'VOIDED' } } } },
      select: { refundAmount: true, refundedById: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.shift.findMany({
      where:  { tenantId, branchId, closedAt: { gte: from, lt: to } },
      select: { cashierId: true, closingCashExpected: true, closingCashDeclared: true, variance: true },
      orderBy: { closedAt: 'asc' },
    }),
    db.auditLog.findMany({
      where: {
        tenantId,
        createdAt: { gte: from, lt: to },
        OR: [
          { action: 'PRICE_ADJUSTED', entityType: 'Order' },
          { entityType: 'TAG_SOLD_TWICE' },
          { entityType: 'TAG_ROLL_CALL' },
        ],
      },
      select:  { action: true, entityType: true, entityId: true, after: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // The till's flags name an order: kept only when the order is this branch's.
  const flagged = audits.filter((a) => a.entityType !== 'TAG_ROLL_CALL');
  const orderIds = [...new Set(flagged.map((a) => a.entityId))];
  const here = orderIds.length === 0 ? [] : await db.order.findMany({
    where:  { tenantId, branchId, id: { in: orderIds } },
    select: { id: true, orderNumber: true },
  });
  const orderNumber = new Map(here.map((o) => [o.id, o.orderNumber]));

  const belowMenu = flagged.filter((a) => a.entityType === 'Order' && orderNumber.has(a.entityId)).length;
  const soldTwice = flagged
    .filter((a) => a.entityType === 'TAG_SOLD_TWICE' && orderNumber.has(a.entityId))
    .map((a) => {
      const after = json(a.after);
      const tags = Array.isArray(after.tags) ? after.tags.filter((t): t is string => typeof t === 'string') : [];
      return { tags, orderNumber: orderNumber.get(a.entityId) ?? (typeof after.orderNumber === 'string' ? after.orderNumber : null) };
    });
  const calls = audits.filter((a) => a.entityType === 'TAG_ROLL_CALL');
  // Read only when a roll call names no branch in `after`: its entityId may then be a branch's id.
  const unnamed = calls.some((a) => typeof json(a.after).branchId !== 'string');
  const otherBranches = !unnamed ? new Set<string>() : new Set(
    (await db.branch.findMany({ where: { tenantId, id: { not: branchId } }, select: { id: true } })).map((b) => b.id),
  );
  const rollCalls = calls
    .filter((a) => {
      const named = json(a.after).branchId;
      if (typeof named === 'string') return named === branchId;
      // No branch in `after`: the entityId may name it ("<branchId>:<when>", as tags/tag-checks writes it).
      // Naming no branch at all, it is kept: the owner hears about missing parts twice rather than not at all.
      return !otherBranches.has(a.entityId.split(':')[0]);
    })
    .map((a) => {
      const missing = json(a.after).missing;
      return { at: a.createdAt, missing: Array.isArray(missing) ? missing.length : 0 };
    });

  // Names for everyone the day mentions, read once, inside this shop only.
  const ids = new Set<string>();
  for (const o of sales) for (const d of o.discounts) if (d.authorizedById) ids.add(d.authorizedById);
  for (const v of voids) for (const id of [v.voidedById, v.voidInitiatedById]) if (id) ids.add(id);
  for (const r of refunds) ids.add(r.refundedById);
  for (const d of drawers) ids.add(d.cashierId);
  const people = ids.size === 0 ? [] : await db.user.findMany({ where: { tenantId, id: { in: [...ids] } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const named = (rows: Array<{ id: string | null; count: number; amount: number }>, label: (id: string | null) => string | null): ByPerson[] =>
    rows.map((r) => ({ name: label(r.id), count: r.count, amount: r.amount }));

  // Ways of paying: each payment by its method, and a sale on account as Charge.
  const byMethod = new Map<string, number>();
  for (const o of sales) {
    if (o.invoiceType === 'CHARGE') byMethod.set('CHARGE', (byMethod.get('CHARGE') ?? 0) + Number(o.totalAmount));
    for (const p of o.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount));
  }

  const discountRows = sales.flatMap((o) => o.discounts);
  const tagged = sales.flatMap((o) => o.items).map((i) => {
    const qty = Number(i.quantity);
    return {
      number:   tagNumberFromNote(i.notes),
      name:     i.productName,
      sold:     round2(Number(i.lineTotal)),
      cost:     i.costPrice == null ? null : round2(Number(i.costPrice) * qty),
      refunded: Number(i.refundedQty) > 0,
    };
  });

  // A void is named for who did it: the cashier who asked and the supervisor who approved, when they differ.
  const voidKey = (v: { voidedById: string | null; voidInitiatedById: string | null }) =>
    v.voidInitiatedById && v.voidedById && v.voidInitiatedById !== v.voidedById
      ? `${v.voidInitiatedById}|${v.voidedById}`
      : (v.voidedById ?? v.voidInitiatedById);
  const voidName = (key: string | null) => {
    if (!key) return null;
    const [asked, approved] = key.split('|');
    const who = (id: string) => nameOf.get(id) ?? 'someone no longer on staff';
    return approved ? `${who(asked)}, approved by ${who(approved)}` : who(asked);
  };

  return {
    sales: {
      count:    sales.length,
      total:    round2(sales.reduce((t, o) => t + Number(o.totalAmount), 0)),
      byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount: round2(amount) })),
    },
    tagged,
    discounts: {
      total:      round2(discountRows.reduce((t, d) => t + Number(d.discountAmount), 0)),
      byApprover: named(
        tally(discountRows.map((d) => ({ id: d.authorizedById, amount: Number(d.discountAmount) }))),
        (id) => (id ? nameOf.get(id) ?? 'Someone no longer on staff' : null),
      ),
      seniorPwd:  discountRows.filter((d) => d.discountType === 'PWD' || d.discountType === 'SENIOR_CITIZEN').length,
    },
    voids: {
      count:    voids.length,
      total:    round2(voids.reduce((t, v) => t + Number(v.totalAmount), 0)),
      byPerson: named(tally(voids.map((v) => ({ id: voidKey(v), amount: Number(v.totalAmount) }))), voidName),
    },
    refunds: {
      count:    refunds.length,
      total:    round2(refunds.reduce((t, r) => t + Number(r.refundAmount), 0)),
      byPerson: named(
        tally(refunds.map((r) => ({ id: r.refundedById, amount: Number(r.refundAmount) }))),
        (id) => (id ? nameOf.get(id) ?? 'Someone no longer on staff' : null),
      ),
    },
    drawers: drawers.map((d) => ({
      cashier:  nameOf.get(d.cashierId) ?? null,
      expected: d.closingCashExpected == null ? null : Number(d.closingCashExpected),
      counted:  d.closingCashDeclared == null ? null : Number(d.closingCashDeclared),
      variance: d.variance == null ? null : Number(d.variance),
    })),
    belowMenu,
    soldTwice,
    rollCalls,
  };
}

type ListeningBranch = { id: string; tenantId: string; name: string; tenant: { name: string } };

@Injectable()
export class CloseSummaryScheduler {
  private readonly logger = new Logger('TelegramDayClose');

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramClient,
    private readonly links: TelegramLinksService,
  ) {}

  /** 21:30 Manila, every day. Returns how many branches were sent their day. Never throws. */
  @Cron('30 21 * * *', { timeZone: PH_TIMEZONE })
  async run(now: Date = new Date()): Promise<number> {
    if (!this.client.enabled) return 0;
    const bounds = closeSummaryDay(now);

    let branches: ListeningBranch[];
    try {
      // Only shops with someone linked on the sales switch: the rest cost this one query.
      const listening = await this.prisma.telegramLink.findMany({
        where:    { chatId: { not: null }, alertSales: true, tenant: { isDemoTenant: false, status: { not: 'SUSPENDED' } } },
        select:   { tenantId: true },
        distinct: ['tenantId'],
      });
      if (listening.length === 0) return 0;
      branches = await this.prisma.branch.findMany({
        where:   { tenantId: { in: listening.map((l) => l.tenantId) }, isActive: true },
        select:  { id: true, tenantId: true, name: true, tenant: { select: { name: true } } },
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error(`Could not read the shops to send the day close to: ${err instanceof Error ? err.message : err}`);
      return 0;
    }

    let sent = 0;
    for (const branch of branches) {
      try {
        if (await this.sendBranch(branch, bounds, now)) sent++;
      } catch (err) {
        // One branch's failure must not cost every other branch its summary.
        this.logger.error(`Day close failed for branch ${branch.id} (shop ${branch.tenantId}), day ${bounds.day}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (sent > 0) this.logger.log(`Sent the day close for ${sent} branch(es), day ${bounds.day}.`);
    return sent;
  }

  /** True when this call sent the branch its day. */
  async sendBranch(branch: ListeningBranch, bounds: CloseDay, now: Date): Promise<boolean> {
    const { tenantId } = branch;
    const chats = await this.links.recipients(tenantId, branch.id, 'sales');
    if (chats.length === 0) return false;
    // The owners' copy carries each tagged part's cost and margin; the managers' does not.
    const owners = new Set(await this.links.recipients(tenantId, branch.id, 'sales', true));

    const data = await loadCloseSummary(this.prisma, tenantId, branch.id, bounds);
    const summary = { ...data, shopName: branch.tenant.name, branchName: branch.name, day: bounds.day, asOf: now };
    const forOwner = closeSummaryMessage(summary);
    const forManager = closeSummaryMessage(summary, { showCosts: false });
    if (!(await this.claim(branch, bounds.day, chats.length))) return false;
    // After the claim commits, so a failed claim never sends.
    for (const chat of chats) this.client.sendMessage(chat, owners.has(chat) ? forOwner : forManager);
    return true;
  }

  /**
   * Marks the branch's day as sent, once. Two runs for the same branch and
   * day queue on the lock; the second finds the first one's row and stops.
   * Taken as $executeRaw like the end-of-day lock: the lock function returns
   * void, which $queryRaw cannot read back.
   */
  private claim(branch: ListeningBranch, day: string, chats: number): Promise<boolean> {
    const entityId = `${branch.id}:${day}`;
    const key = `telegram-day-close-${entityId}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const done = await tx.auditLog.findFirst({
        where:  { tenantId: branch.tenantId, entityType: DAY_CLOSE_ENTITY, entityId },
        select: { id: true },
      });
      if (done) return false;
      await tx.auditLog.create({
        data: {
          tenantId:    branch.tenantId,
          // The day's figures left Clerque for a Telegram chat. No person did it, so the bulk-export watch never counts it.
          action:      'DATA_EXPORTED',
          entityType:  DAY_CLOSE_ENTITY,
          entityId,
          after:       { day, branchId: branch.id, chats },
          description: `Day close for ${branch.name}, ${day}, sent to ${chats} Telegram chat${chats === 1 ? '' : 's'}`,
        },
      });
      return true;
    });
  }
}

