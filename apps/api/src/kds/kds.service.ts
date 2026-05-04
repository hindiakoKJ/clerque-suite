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
        order:     { tenantId, status: 'COMPLETED' },
        product:   { category: { stationId } },
        OR: [
          { prepStatus: 'PENDING' },
          { prepStatus: 'READY', readyAt: { gte: recentReadyCutoff } },
        ],
      },
      include: {
        order:     { select: { orderNumber: true, completedAt: true, branchId: true } },
        modifiers: { select: { optionName: true, groupName: true } },
      },
      orderBy: { order: { completedAt: 'asc' } },  // FIFO (CS_5 shared queue)
      take: 50,
    });

    return items.map((it) => ({
      id:           it.id,
      orderId:      it.orderId,
      orderNumber:  it.order.orderNumber,
      branchId:     it.order.branchId,
      productName:  it.productName,
      quantity:     Number(it.quantity),
      modifiers:    it.modifiers.map((m) => `${m.groupName}: ${m.optionName}`),
      notes:        it.notes,
      prepStatus:   it.prepStatus,
      orderedAt:    it.order.completedAt?.toISOString() ?? null,
      readyAt:      it.readyAt?.toISOString() ?? null,
      // Wait time in seconds — used by the UI to color-code (green < 5min,
      // yellow < 10min, red > 10min).
      waitSeconds:  it.order.completedAt
        ? Math.floor((Date.now() - it.order.completedAt.getTime()) / 1000)
        : 0,
    }));
  }

  /** Bump an item to READY (chef done preparing it). */
  async bumpReady(tenantId: string, orderItemId: string) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, order: { tenantId } },
      select: { id: true, prepStatus: true },
    });
    if (!item) throw new NotFoundException('Order item not found.');
    if (item.prepStatus !== 'PENDING') {
      // Idempotent — already bumped is a no-op.
      return { id: item.id, prepStatus: item.prepStatus };
    }
    return this.prisma.orderItem.update({
      where: { id: orderItemId },
      data:  { prepStatus: 'READY', readyAt: new Date() },
      select: { id: true, prepStatus: true, readyAt: true },
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

  /** Undo a bump (chef's mistake — set back to PENDING). */
  async unbump(tenantId: string, orderItemId: string) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, order: { tenantId } },
      select: { id: true, prepStatus: true },
    });
    if (!item) throw new NotFoundException('Order item not found.');
    if (item.prepStatus === 'SERVED') {
      throw new BadRequestException('Cannot un-bump an item that has been served.');
    }
    return this.prisma.orderItem.update({
      where: { id: orderItemId },
      data:  { prepStatus: 'PENDING', readyAt: null },
      select: { id: true, prepStatus: true },
    });
  }
}
