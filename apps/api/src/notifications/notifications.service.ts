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
    /*
      The idempotency this promised never once fired.

      It looked for an earlier notification whose BODY contained the dedupeKey
      -- but the key is never written into the body, and never was. Callers pass
      keys like `low-ingredient-3-2-1` while the body reads "OUT: Beans · Low:
      Fresh Milk". No row could ever match, so `dup` was always null and every
      caller that asked to be deduplicated was silently not.

      Nothing crashed, which is why it survived: the alerts simply repeated.

      Matching the MESSAGE ITSELF is what the callers actually want, and it
      needs no new column. Every producer builds its body from the shop's
      current state -- which ingredients are out, which are low -- so an
      identical body within the hour IS the duplicate, and a body that has
      changed is genuinely new news. That is strictly sharper than the intended
      key match: `low-ingredient-3-2-1` collapses two different sets of three
      out-of-stock ingredients into one, and the body does not.

      `dedupeKey` stays in the signature as the opt-IN flag -- passing it is how
      a caller says "suppress a repeat of this" -- and its value still
      participates, so two producers sharing a title and a body do not collapse
      into each other.
    */
    if (args.dedupeKey) {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const dup = await this.prisma.notification.findFirst({
        where: {
          tenantId: args.tenantId,
          userId:   args.userId ?? null,
          title:    args.title,
          body:     args.body ?? null,
          link:     args.link ?? null,
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
    // Atomic tenant + recipient scope — single query closes the TOCTOU window
    // between findFirst and update. We match `readAt: null` so a re-read no-ops
    // without a second update; idempotent.
    await this.prisma.notification.updateMany({
      where: {
        id:        notificationId,
        tenantId,
        OR:        [{ userId }, { userId: null }],
        readAt:    null,
      },
      data:  { readAt: new Date() },
    });
    // A zero-row update either means already read OR not found / cross-tenant.
    // Re-fetch to distinguish (and return the row for the caller).
    return this.prisma.notification.findFirst({
      where: { id: notificationId, tenantId, OR: [{ userId }, { userId: null }] },
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
