import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PH_TIMEZONE } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { lockOrder } from '../orders/order-lock';
import { HOLDING_STATUSES, WAITING_LINE } from '../orders/held-usage';
import { confirmLineUsage } from '../orders/usage-confirm';
import { WAITS_AT_A_SCREEN, stillToMake } from './station-routing';

const PAGE = 200;

/**
 * The 02:30 Manila pass over kitchen and bar tickets from before today.
 *
 * 1. Confirms waiting lines nobody marked ready. Under the owner's rule a
 *    ticket takes its ingredients and cost when it is marked ready; a drink
 *    handed over without a tap would otherwise hold its milk and keep its cost
 *    out of the books for good. It runs before the 03:00 stock alerts, so they
 *    see the real shelf. Selected by the line's own flag, not by today's
 *    routing: a station switched off after the sale must not strand its lines.
 *    The cost is dated to the sale, as a tap would have dated it. The owner is
 *    told how many were counted this way.
 *
 * 2. Clears tickets whose stock was already taken at the sale -- sold before
 *    the ready-tap rule, replayed from the offline queue, or rung while
 *    deduction was paused -- that nobody tapped. They are marked ready and
 *    nothing else: no stock, no cost, those were handled at the till.
 *    Otherwise they sit on the station screens for good and hold their order
 *    at "Preparing".
 *
 * 3. Releases orders left at "Preparing" (PAID) with nothing left to make.
 *    Before the station-routing fix an order waited on every routed line, even
 *    one sent to a station with no screen or a line refunded away; this clears
 *    those and any a crash leaves behind.
 */
@Injectable()
export class StuckOrdersScheduler {
  private readonly logger = new Logger(StuckOrdersScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  @Cron('30 2 * * *', { timeZone: PH_TIMEZONE })
  async nightly(now = new Date()) {
    const confirmed = await this.confirmUntapped(now);
    const cleared = await this.clearAtSaleTickets(now);
    const released = await this.releaseStuckOrders(now);
    return { ...released, confirmed, cleared };
  }

  /** Step 1: waiting lines from before today, confirmed as made. Returns how many lines were confirmed. */
  async confirmUntapped(now = new Date()): Promise<number> {
    const dayStart = manilaDayStart(now);
    const perTenant = new Map<string, number>();
    let after: string | undefined;

    for (;;) {
      /*
        Paged by "id after the last one seen", not a Prisma cursor: a confirmed
        line stops matching the filter, and a cursor on a row that no longer
        matches, with skip 1, silently stepped over the next waiting line.
      */
      const page = await this.prisma.orderItem.findMany({
        where: {
          ...WAITING_LINE,
          ...(after ? { id: { gt: after } } : {}),
          order: { status: { in: [...HOLDING_STATUSES] }, deletedAt: null, paidAt: { lt: dayStart } },
        },
        select:  { id: true, orderId: true, quantity: true, refundedQty: true, order: { select: { tenantId: true } } },
        orderBy: { id: 'asc' },
        take:    PAGE,
      });
      if (page.length === 0) break;
      after = page[page.length - 1].id;

      const byOrder = new Map<string, { tenantId: string; ids: string[]; madeIds: Set<string> }>();
      for (const l of page) {
        const o = byOrder.get(l.orderId) ?? { tenantId: l.order.tenantId, ids: [], madeIds: new Set<string>() };
        o.ids.push(l.id);
        // Refunded in full while it waited: stamped done below, but not "counted as made" to the owner.
        if (Number(l.quantity) - Number(l.refundedQty) > 0) o.madeIds.add(l.id);
        byOrder.set(l.orderId, o);
      }
      for (const [orderId, { tenantId, ids, madeIds }] of byOrder) {
        try {
          const n = await this.prisma.$transaction(async (tx) => {
            await lockOrder(tx, orderId);
            let done = 0;
            for (const id of ids) {
              if (await confirmLineUsage(tx, tenantId, id, { actorId: null, trigger: 'NIGHTLY', now }) && madeIds.has(id)) done++;
            }
            // Counted as made: off the screen, and the order can be released below.
            await tx.orderItem.updateMany({
              where: { id: { in: ids }, prepStatus: 'PENDING' },
              data:  { prepStatus: 'READY', readyAt: now },
            });
            return done;
          }, { maxWait: 10_000, timeout: 60_000 });
          if (n > 0) perTenant.set(tenantId, (perTenant.get(tenantId) ?? 0) + n);
        } catch (err) {
          this.logger.error(`Could not confirm the waiting lines of order ${orderId}: ${(err as Error).message}`);
        }
      }
      if (page.length < PAGE) break;
    }

    let total = 0;
    for (const [tenantId, n] of perTenant) {
      total += n;
      try {
        await this.notifications?.create({
          tenantId, userId: null, kind: 'INFO',
          title: `${n} kitchen/bar item${n === 1 ? '' : 's'} counted as made overnight`,
          body:  'Nobody marked them ready on the station screen yesterday, so Clerque took their ingredients and booked their cost at 2:30 AM, dated to the sale. If some were never made, void or refund them.',
          link:  '/pos/orders',
          dedupeKey: `nightly-confirm-${manilaDayStart(now).toISOString().slice(0, 10)}`,
        });
      } catch (err) {
        this.logger.warn(`Could not tell shop ${tenantId} about the overnight confirm: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Confirmed ${total} waiting kitchen/bar line(s) from before today.`);
    return total;
  }

  /** Step 2: at-sale tickets from before today nobody tapped, marked ready. Returns how many lines were cleared. */
  async clearAtSaleTickets(now = new Date()): Promise<number> {
    const where = {
      usageOnReady: false,
      prepStatus:   'PENDING',
      // A line a station screen lists; a till-only line never shows, so it is left as it is.
      product:      { category: { station: { hasKds: true } } },
      order:        { status: { in: [...HOLDING_STATUSES] }, deletedAt: null, paidAt: { lt: manilaDayStart(now) } },
    } satisfies Prisma.OrderItemWhereInput;
    let cleared = 0;
    let after: string | undefined;

    for (;;) {
      // By id after the last one seen: a cleared line leaves the filter, and a cursor on it skipped the next.
      const page = await this.prisma.orderItem.findMany({
        where:   { ...where, ...(after ? { id: { gt: after } } : {}) },
        select:  { id: true, orderId: true },
        orderBy: { id: 'asc' },
        take:    PAGE,
      });
      if (page.length === 0) break;
      after = page[page.length - 1].id;

      const byOrder = new Map<string, string[]>();
      for (const l of page) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l.id]);
      for (const [orderId, ids] of byOrder) {
        try {
          cleared += await this.prisma.$transaction(async (tx) => {
            await lockOrder(tx, orderId);
            /*
              The filter again under the lock, so a line bumped, or an order
              voided, since the read is left alone. Status only: no stock, no
              cost, no readyAt -- a ready time on a line that took its stock at
              the sale is read by the lead-time report as a person's tap, and
              would time the order at 02:30.
            */
            const res = await tx.orderItem.updateMany({
              where: { ...where, id: { in: ids } },
              data:  { prepStatus: 'READY' },
            });
            return res.count;
          });
        } catch (err) {
          this.logger.error(`Could not clear the kitchen/bar tickets of order ${orderId}: ${(err as Error).message}`);
        }
      }
      if (page.length < PAGE) break;
    }

    this.logger.log(`Cleared ${cleared} kitchen/bar ticket(s) from before today whose stock was taken at the sale.`);
    return cleared;
  }

  /** Step 3: orders at "Preparing" from before today with nothing left to make. */
  async releaseStuckOrders(now = new Date()): Promise<{ released: number; stillWaiting: number }> {
    const dayStart = manilaDayStart(now);
    let released = 0;
    let stillWaiting = 0;
    let after: string | undefined;

    for (;;) {
      // By id after the last one seen: a released order leaves the filter, and a cursor on it skipped the next.
      const page = await this.prisma.order.findMany({
        where:   { status: 'PAID', paidAt: { lt: dayStart }, ...(after ? { id: { gt: after } } : {}) },
        select:  { id: true },
        orderBy: { id: 'asc' },
        take:    PAGE,
      });
      if (page.length === 0) break;
      after = page[page.length - 1].id;

      for (const { id } of page) {
        try {
          const done = await this.prisma.$transaction(async (tx) => {
            await lockOrder(tx, id);
            const order = await tx.order.findFirst({ where: { id, status: 'PAID' }, select: { paidAt: true } });
            if (!order) return false;
            const waiting = stillToMake(await tx.orderItem.findMany({
              where:  { orderId: id, prepStatus: 'PENDING', product: WAITS_AT_A_SCREEN },
              select: { quantity: true, refundedQty: true },
            }));
            if (waiting > 0) return null;
            const lastReady = await tx.orderItem.aggregate({ where: { orderId: id }, _max: { readyAt: true } });
            const at = order.paidAt ?? now;
            const res = await tx.order.updateMany({
              where: { id, status: 'PAID' },
              data:  { status: 'COMPLETED', completedAt: at, readyAt: lastReady._max.readyAt ?? at },
            });
            return res.count > 0;
          });
          if (done === true) released++;
          else if (done === null) stillWaiting++;
        } catch (err) {
          this.logger.error(`Could not release order ${id}: ${(err as Error).message}`);
        }
      }
      if (page.length < PAGE) break;
    }

    this.logger.log(`Released ${released} order(s) left at Preparing with nothing to make; ${stillWaiting} still have an item waiting at a screen.`);
    return { released, stillWaiting };
  }
}

/** 00:00 of `now`'s day in Manila (UTC+8, no daylight saving). */
function manilaDayStart(now: Date): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${day}T00:00:00+08:00`);
}
