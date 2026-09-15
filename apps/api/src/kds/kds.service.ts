import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WAITS_AT_A_SCREEN, stillToMake, waitsAtAScreen } from './station-routing';
import { lockOrder } from '../orders/order-lock';
/** Orders a station may still act on. A voided order is not made, and its lines are not bumped. */
const LIVE_ORDER = ['PAID', 'COMPLETED'] as const;
const QUEUE_SIZE = 50;

/**
 * KDS (Kitchen Display System) service — Sprint 5 MVP.
 *
 * Each station (Bar / Kitchen / Hot Bar / Cold Bar / Pastry Pass) has its own
 * KDS screen at /pos/station/[id]. The screen lists items routed to that
 * station that are in PENDING status, sorted oldest-first. When the chef
 * bumps an item, prepStatus → READY and readyAt is recorded.
 *
 * Routing: an OrderItem belongs to a station via product.category.stationId.
 * Items whose category isn't routed to any station never appear in any KDS
 * (they go to the receipt printer only — beverages-on-counter, pre-packaged).
 *
 * The service is read-mostly (KDS polls every ~3s) and write-rare (bump events).
 */
@Injectable()
export class KdsService {
  constructor(private prisma: PrismaService) {}

  /**
   * List items routed to this station that are currently pending or recently
   * marked ready (so the bumped ticket lingers for ~30s as a courtesy to the
   * runner/cashier before disappearing).
   */
  async listStationQueue(tenantId: string, stationId: string) {
    // Verify the station belongs to this tenant.
    const station = await this.prisma.station.findFirst({
      where:  { id: stationId, tenantId },
      select: { id: true, name: true, hasKds: true },
    });
    if (!station) throw new NotFoundException('Station not found.');
    if (!station.hasKds) {
      throw new BadRequestException('This station does not have a KDS screen enabled.');
    }

    // Cutoff: include READY items bumped within the last 30 seconds.
    const recentReadyCutoff = new Date(Date.now() - 30_000);

    const fetched = await this.prisma.orderItem.findMany({
      where: {
        // Sprint 7: orders flow PAID → COMPLETED. KDS sees items on either —
        // PAID items still need prep; COMPLETED items show briefly while the
        // bumped ticket lingers as a courtesy to the runner.
        order:     { tenantId, status: { in: [...LIVE_ORDER] } },
        product:   { category: { stationId } },
        OR: [
          { prepStatus: 'PENDING' },
          { prepStatus: 'READY', readyAt: { gte: recentReadyCutoff } },
        ],
      },
      include: {
        order:     { select: { orderNumber: true, paidAt: true, completedAt: true, branchId: true } },
        modifiers: { select: { optionName: true, groupName: true } },
      },
      // FIFO by paidAt — items entered the production queue when payment landed.
      // Falls back to completedAt for legacy rows where paidAt was backfilled.
      orderBy: [{ order: { paidAt: 'asc' } }, { order: { completedAt: 'asc' } }],
      // Read past the screen's size: fully refunded lines are dropped below, and must not push a live ticket off.
      take: QUEUE_SIZE * 2,
    });
    // What is left to make: a refunded part is not made, and a fully refunded line is not on the screen at all.
    const items = fetched
      .map((it) => ({ it, left: Number(it.quantity) - Number(it.refundedQty) }))
      .filter(({ left }) => left > 1e-9)
      .slice(0, QUEUE_SIZE);

    return items.map(({ it, left }) => {
      const queuedAt = it.order.paidAt ?? it.order.completedAt;
      return {
        id:           it.id,
        orderId:      it.orderId,
        orderNumber:  it.order.orderNumber,
        branchId:     it.order.branchId,
        productName:  it.productName,
        quantity:     left,
        modifiers:    it.modifiers.map((m) => `${m.groupName}: ${m.optionName}`),
        notes:        it.notes,
        prepStatus:   it.prepStatus,
        orderedAt:    queuedAt?.toISOString() ?? null,
        readyAt:      it.readyAt?.toISOString() ?? null,
        // Wait time in seconds — used by the UI to color-code (green < 5min,
        // yellow < 10min, red > 10min).
        waitSeconds:  queuedAt
          ? Math.floor((Date.now() - queuedAt.getTime()) / 1000)
          : 0,
      };
    });
  }

  /**
   * Bump an item to READY (chef done preparing it).
   *
   * Sprint 7: when this is the LAST routed item still PENDING on the parent
   * order, the order auto-transitions PAID → COMPLETED. The order's readyAt
   * timestamp is stamped at the same moment, which feeds the lead-time KPI
   * (readyAt - paidAt = production lead time).
   *
   * Only lines that wait at a station with a screen count toward "all done":
   * every line starts PENDING, and a line nobody can bump -- not routed, or
   * routed to a station without a screen -- would otherwise hold the order
   * forever. A fully refunded line is not made, so it does not count either.
   *
   * The flip from PENDING is one conditional write, so two tablets bumping
   * the same line at the same moment cannot both count as the bump.
   */
  async bumpReady(tenantId: string, orderItemId: string) {
    return this.prisma.$transaction((tx) => this.bumpInTx(tx, tenantId, orderItemId));
  }

  private async bumpInTx(tx: Prisma.TransactionClient, tenantId: string, orderItemId: string) {
    // The order's lock before anything is read that decides the order (see lockOrder).
    const ref = await tx.orderItem.findFirst({ where: { id: orderItemId, order: { tenantId } }, select: { orderId: true } });
    if (!ref) throw new NotFoundException('Order item not found.');
    await lockOrder(tx, ref.orderId);
    const item = await tx.orderItem.findFirst({
      where:  { id: orderItemId, order: { tenantId } },
      select: { id: true, orderId: true, prepStatus: true, readyAt: true, quantity: true, refundedQty: true, order: { select: { status: true } } },
    });
    if (!item) throw new NotFoundException('Order item not found.');
    if (!(LIVE_ORDER as readonly string[]).includes(item.order.status)) {
      throw new BadRequestException('This order was voided. There is nothing to make.');
    }
    if (item.prepStatus === 'PENDING' && Number(item.refundedQty) >= Number(item.quantity)) {
      throw new BadRequestException('This item was refunded. There is nothing to make.');
    }

    const now = new Date();
    const flipped = item.prepStatus === 'PENDING'
      ? await tx.orderItem.updateMany({
          where: { id: orderItemId, prepStatus: 'PENDING' },
          data:  { prepStatus: 'READY', readyAt: now },
        })
      : { count: 0 };
    // Idempotent: already bumped (here, or by the other tablet a moment ago) is a no-op.
    const updated = flipped.count === 1
      ? { id: item.id, prepStatus: 'READY' as const, readyAt: now }
      : await tx.orderItem.findFirst({ where: { id: orderItemId }, select: { id: true, prepStatus: true, readyAt: true } });

    // Check whether this was the LAST line still waiting at a screen.
    const stillWaiting = stillToMake(await tx.orderItem.findMany({
      where:  { orderId: item.orderId, prepStatus: 'PENDING', product: WAITS_AT_A_SCREEN },
      select: { quantity: true, refundedQty: true },
    }));

    if (stillWaiting === 0) {
      // All routed items done — promote the order from PAID to COMPLETED
      // and stamp readyAt. Idempotent: only fires when status is still PAID.
      await tx.order.updateMany({
        where: { id: item.orderId, status: 'PAID' },
        data:  { status: 'COMPLETED', readyAt: now, completedAt: now },
      });
    }

    return updated;
  }

  /**
   * Mark an item as SERVED (delivered to customer).
   *
   * Served without being bumped first is still made: it goes through the bump,
   * so the order is promoted and it is recorded as ready, not skipped past.
   */
  async markServed(tenantId: string, orderItemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({
        where: { id: orderItemId, order: { tenantId } },
        select: { id: true, prepStatus: true },
      });
      if (!item) throw new NotFoundException('Order item not found.');
      if (item.prepStatus === 'PENDING') await this.bumpInTx(tx, tenantId, orderItemId);
      await tx.orderItem.update({
        where: { id: orderItemId },
        data:  { prepStatus: 'SERVED', servedAt: new Date() },
      });
      return tx.orderItem.findFirst({ where: { id: orderItemId }, select: { id: true, prepStatus: true, servedAt: true } });
    });
  }

  /**
   * Undo a bump (chef's mistake — set back to PENDING).
   *
   * Sprint 7: if the parent Order had auto-transitioned to COMPLETED on the
   * last bump, that transition is rolled back — status returns to PAID and
   * readyAt is cleared. The order is "back in production" until the item
   * is re-bumped.
   */
  async unbump(tenantId: string, orderItemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.orderItem.findFirst({ where: { id: orderItemId, order: { tenantId } }, select: { orderId: true } });
      if (!ref) throw new NotFoundException('Order item not found.');
      await lockOrder(tx, ref.orderId);
      const item = await tx.orderItem.findFirst({
        where:  {
          id: orderItemId, order: { tenantId },
        },
        select: {
          id: true, orderId: true, prepStatus: true, quantity: true, refundedQty: true,
          order: { select: { status: true } },
          product: { select: { category: { select: { stationId: true, station: { select: { hasKds: true, isActive: true } } } } } },
        },
      });
      if (!item) throw new NotFoundException('Order item not found.');
      if (item.prepStatus === 'SERVED') {
        throw new BadRequestException('Cannot un-bump an item that has been served.');
      }
      if (!(LIVE_ORDER as readonly string[]).includes(item.order.status)) {
        throw new BadRequestException('This order was voided. There is nothing to un-bump.');
      }
      // Nothing left to make: back to PENDING it could never be bumped again, and would hold the order open for good.
      if (Number(item.quantity) - Number(item.refundedQty) <= 1e-9) {
        throw new BadRequestException('This item was refunded. There is nothing to un-bump.');
      }
      const wasReady = item.prepStatus === 'READY';

      const updated = await tx.orderItem.update({
        where: { id: orderItemId },
        data:  { prepStatus: 'PENDING', readyAt: null },
        select: { id: true, prepStatus: true },
      });

      /*
        Back to PAID only when this line is one the order actually waited on:
        a line at a station with a screen. A line nobody could bump never held
        the order, so un-bumping it must not reopen an order that was complete
        at the till.
      */
      if (wasReady && waitsAtAScreen(item.product?.category)) {
        await tx.order.updateMany({
          where: { id: item.orderId, status: 'COMPLETED' },
          data:  { status: 'PAID', readyAt: null, completedAt: null },
        });
      }

      return updated;
    });
  }
}
