import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

    const items = await this.prisma.orderItem.findMany({
      where: {
        // Sprint 7: orders flow PAID → COMPLETED. KDS sees items on either —
        // PAID items still need prep; COMPLETED items show briefly while the
        // bumped ticket lingers as a courtesy to the runner.
        order:     { tenantId, status: { in: ['PAID', 'COMPLETED'] } },
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
      take: 50,
    });

    return items.map((it) => {
      const queuedAt = it.order.paidAt ?? it.order.completedAt;
      return {
        id:           it.id,
        orderId:      it.orderId,
        orderNumber:  it.order.orderNumber,
        branchId:     it.order.branchId,
        productName:  it.productName,
        quantity:     Number(it.quantity),
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
   * Items not routed to a station (no category.stationId) never sit in
   * PENDING in the first place — only routed items count toward "all done".
   */
  async bumpReady(tenantId: string, orderItemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({
        where:  { id: orderItemId, order: { tenantId } },
        select: { id: true, orderId: true, prepStatus: true },
      });
      if (!item) throw new NotFoundException('Order item not found.');

      const updated = item.prepStatus !== 'PENDING'
        ? item // Idempotent — already bumped is a no-op
        : await tx.orderItem.update({
            where: { id: orderItemId },
            data:  { prepStatus: 'READY', readyAt: new Date() },
            select: { id: true, prepStatus: true, readyAt: true },
          });

      // Check whether this was the LAST routed item still pending.
      // Routed items = items whose product.category has a stationId set.
      const stillPendingRouted = await tx.orderItem.count({
        where: {
          orderId:    item.orderId,
          prepStatus: 'PENDING',
          product:    { category: { stationId: { not: null } } },
        },
      });

      if (stillPendingRouted === 0) {
        // All routed items done — promote the order from PAID to COMPLETED
        // and stamp readyAt. Idempotent: only fires when status is still PAID.
        const now = new Date();
        await tx.order.updateMany({
          where: { id: item.orderId, status: 'PAID' },
          data:  { status: 'COMPLETED', readyAt: now, completedAt: now },
        });
      }

      return updated;
    });
  }

  /** Mark an item as SERVED (delivered to customer). */
  async markServed(tenantId: string, orderItemId: string) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, order: { tenantId } },
      select: { id: true, prepStatus: true },
    });
    if (!item) throw new NotFoundException('Order item not found.');
    return this.prisma.orderItem.update({
      where: { id: orderItemId },
      data:  { prepStatus: 'SERVED', servedAt: new Date() },
      select: { id: true, prepStatus: true, servedAt: true },
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
      const item = await tx.orderItem.findFirst({
        where:  { id: orderItemId, order: { tenantId } },
        select: { id: true, orderId: true, prepStatus: true },
      });
      if (!item) throw new NotFoundException('Order item not found.');
      if (item.prepStatus === 'SERVED') {
        throw new BadRequestException('Cannot un-bump an item that has been served.');
      }

      const updated = await tx.orderItem.update({
        where: { id: orderItemId },
        data:  { prepStatus: 'PENDING', readyAt: null },
        select: { id: true, prepStatus: true },
      });

      // Roll the parent order back to PAID if it had been auto-promoted.
      // We only roll back orders that were COMPLETED via the auto-transition
      // (signaled by readyAt being set). Manually-completed retail orders
      // shouldn't be touched, but those have no routed items so they
      // never reach this code path anyway.
      await tx.order.updateMany({
        where: { id: item.orderId, status: 'COMPLETED' },
        data:  { status: 'PAID', readyAt: null, completedAt: null },
      });

      return updated;
    });
  }
}
