import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PH_TIMEZONE } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { lockOrder } from '../orders/order-lock';
import { WAITS_AT_A_SCREEN, stillToMake } from './station-routing';

const PAGE = 200;

/**
 * Releases orders left at "Preparing" (PAID) from before today with nothing
 * left to make at any screen.
 *
 * Before the station-routing fix an order waited on every routed line, even
 * one sent to a station with no screen or a line refunded away -- nothing
 * could ever bump those, so the order sat at PAID for good: no e-invoice,
 * wrong on the orders list. The fix stops new ones; this clears the old ones
 * and any a crash leaves behind. Its first run will release the backlog.
 *
 * Status only. Stock and the books were settled at the sale.
 */
@Injectable()
export class StuckOrdersScheduler {
  private readonly logger = new Logger(StuckOrdersScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 2 * * *', { timeZone: PH_TIMEZONE })
  async releaseStuckOrders(now = new Date()): Promise<{ released: number; stillWaiting: number }> {
    const dayStart = manilaDayStart(now);
    let released = 0;
    let stillWaiting = 0;
    let cursor: string | undefined;

    for (;;) {
      const page = await this.prisma.order.findMany({
        where:   { status: 'PAID', paidAt: { lt: dayStart } },
        select:  { id: true },
        orderBy: { id: 'asc' },
        take:    PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;

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
