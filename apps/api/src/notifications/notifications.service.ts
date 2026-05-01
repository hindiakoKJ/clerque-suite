/**
 * NotificationsService — in-app alerts (no email yet).
 *
 * Producers (cron jobs, hooks) call create() to enqueue notifications.
 * The frontend bell icon polls list() + countUnread() every minute.
 */

import { Injectable } from '@nestjs/common';
import { Prisma, NotificationKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a notification for one user OR broadcast to a tenant (userId=null).
   * Idempotency tag (optional): if you set `dedupeKey`, repeat-create within
   * the same hour for the same user/tenant will be skipped — useful for
   * "low stock on Product X" type alerts.
   */
  async create(args: {
    tenantId:   string;
    userId?:    string | null;
    kind?:      NotificationKind;
    title:      string;
    body?:      string;
    link?:      string;
    /** If set, suppress duplicate notifications within the last hour. */
    dedupeKey?: string;
  }) {
    if (args.dedupeKey) {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const dup = await this.prisma.notification.findFirst({
        where: {
          tenantId: args.tenantId,
          userId:   args.userId ?? null,
          title:    args.title,
          body:     { contains: args.dedupeKey },
          createdAt:{ gte: hourAgo },
        },
        select: { id: true },
      });
      if (dup) return dup;
    }
    return this.prisma.notification.create({
      data: {
        tenantId: args.tenantId,
        userId:   args.userId ?? null,
        kind:     args.kind ?? 'INFO',
        title:    args.title,
        body:     args.body  ?? null,
        link:     args.link  ?? null,
      },
    });
  }

  /**
   * List notifications for a user. Includes both their own (userId match) and
   * tenant-wide broadcasts (userId NULL). Newest first, limit 50 by default.
   */
  async list(tenantId: string, userId: string, opts: { limit?: number; unreadOnly?: boolean } = {}) {
    const where: Prisma.NotificationWhereInput = {
      tenantId,
      OR: [{ userId }, { userId: null }],
    };
    if (opts.unreadOnly) where.readAt = null;
    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    opts.limit ?? 50,
    });
  }

  async countUnread(tenantId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        tenantId,
        readAt: null,
        OR: [{ userId }, { userId: null }],
      },
    });
  }

  async markRead(tenantId: string, userId: string, notificationId: string) {
    // Tenant-scoped + recipient-scoped check inside the update
    const n = await this.prisma.notification.findFirst({
      where: { id: notificationId, tenantId, OR: [{ userId }, { userId: null }] },
      select: { id: true, readAt: true },
    });
    if (!n) return null;
    if (n.readAt) return n; // already read — idempotent
    return this.prisma.notification.update({
      where: { id: notificationId },
      data:  { readAt: new Date() },
    });
  }

  async markAllRead(tenantId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        tenantId,
        readAt: null,
        OR: [{ userId }, { userId: null }],
      },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
