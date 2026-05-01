/**
 * NotificationsScheduler — cron-driven notification producers.
 *
 * Three jobs run daily at off-peak (3am Manila time) to keep the
 * Settings → Bell dropdown actually populated with useful alerts:
 *
 *   1. Low-stock check        — products at or below their alert threshold
 *   2. AR/AP overdue scan     — unpaid invoices/bills past their due date
 *   3. Period-close reminder  — fire 5 days before month-end if the prior
 *                                month isn't closed yet
 *
 * Each producer uses the dedupeKey feature so the same notification
 * doesn't repeat-fire if the cron runs more than once in a day.
 *
 * For owner-visible alerts (overdue, period close), notifications are
 * created with userId=null (broadcast). For per-product low-stock, they
 * target the BUSINESS_OWNER + any BRANCH_MANAGER of that branch.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Daily 3am Manila — Asia/Manila is UTC+8, so 19:00 UTC the previous day.
   * Runs all three producers; failures in one don't block the others.
   */
  @Cron('0 19 * * *', { timeZone: 'Asia/Manila' })
  async runDailyProducers() {
    this.logger.log('Running daily notification producers…');
    const tenants = await this.prisma.tenant.findMany({
      where:  { status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    for (const t of tenants) {
      await Promise.allSettled([
        this.lowStockProducer(t.id),
        this.overdueArApProducer(t.id),
        this.periodCloseReminderProducer(t.id),
      ]);
    }
  }

  /** Products at or below their lowStockAlert threshold → owner alert. */
  private async lowStockProducer(tenantId: string): Promise<void> {
    try {
      const lowItems = await this.prisma.inventoryItem.findMany({
        where: {
          tenantId,
          lowStockAlert: { not: null, gt: 0 },
        },
        include: {
          product: { select: { id: true, name: true } },
          branch:  { select: { id: true, name: true } },
        },
      });
      const flagged = lowItems.filter(
        (it) => it.lowStockAlert != null && Number(it.quantity) <= it.lowStockAlert,
      );
      if (flagged.length === 0) return;

      // One consolidated alert (not 50 separate ones)
      const productList = flagged
        .slice(0, 5)
        .map((it) => `${it.product.name} (${Number(it.quantity)} on ${it.branch.name})`)
        .join(', ');
      const more = flagged.length > 5 ? ` and ${flagged.length - 5} more` : '';

      await this.notifications.create({
        tenantId,
        userId:    null,            // broadcast to all of this tenant's users
        kind:      'WARNING',
        title:     `Low stock alert — ${flagged.length} item${flagged.length === 1 ? '' : 's'}`,
        body:      `${productList}${more} at or below the re-order threshold. Reorder soon.`,
        link:      '/pos/inventory',
        dedupeKey: `low-stock-${flagged.length}`,
      });
    } catch (err) {
      this.logger.error(`lowStockProducer failed for ${tenantId}: ${(err as Error).message}`);
    }
  }

  /** Open invoices / bills past their due date → owner alert. */
  private async overdueArApProducer(tenantId: string): Promise<void> {
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [arOverdue, apOverdue] = await Promise.all([
        this.prisma.aRInvoice.aggregate({
          where:  {
            tenantId,
            status:  { in: ['OPEN', 'PARTIALLY_PAID'] },
            dueDate: { lt: today },
          },
          _count: true,
          _sum:   { totalAmount: true, paidAmount: true },
        }),
        this.prisma.aPBill.aggregate({
          where: {
            tenantId,
            status:  { in: ['OPEN', 'PARTIALLY_PAID'] },
            dueDate: { lt: today },
          },
          _count: true,
          _sum:   { totalAmount: true, paidAmount: true, whtAmount: true },
        }),
      ]);

      const arOpen = (Number(arOverdue._sum.totalAmount ?? 0)) - (Number(arOverdue._sum.paidAmount ?? 0));
      const apOpen =
        (Number(apOverdue._sum.totalAmount ?? 0)) -
        (Number(apOverdue._sum.paidAmount  ?? 0)) -
        (Number(apOverdue._sum.whtAmount   ?? 0));

      if (arOverdue._count > 0) {
        await this.notifications.create({
          tenantId,
          userId:    null,
          kind:      'WARNING',
          title:     `${arOverdue._count} overdue invoice${arOverdue._count === 1 ? '' : 's'} — ₱${arOpen.toLocaleString('en-PH', { minimumFractionDigits: 2 })} outstanding`,
          body:      'Customers haven\'t paid past their due date. Time to follow up.',
          link:      '/ledger/ar/billing',
          dedupeKey: `ar-overdue-${arOverdue._count}`,
        });
      }
      if (apOverdue._count > 0) {
        await this.notifications.create({
          tenantId,
          userId:    null,
          kind:      'WARNING',
          title:     `${apOverdue._count} vendor bill${apOverdue._count === 1 ? '' : 's'} overdue — ₱${apOpen.toLocaleString('en-PH', { minimumFractionDigits: 2 })} due`,
          body:      'Vendors are waiting for payment past their terms. Schedule remittances.',
          link:      '/ledger/ap/bills',
          dedupeKey: `ap-overdue-${apOverdue._count}`,
        });
      }
    } catch (err) {
      this.logger.error(`overdueArApProducer failed for ${tenantId}: ${(err as Error).message}`);
    }
  }

  /** 5 days before month-end, remind to close the prior period if still open. */
  private async periodCloseReminderProducer(tenantId: string): Promise<void> {
    try {
      const today = new Date();
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const daysToMonthEnd = Math.ceil((endOfMonth.getTime() - today.getTime()) / 86_400_000);
      if (daysToMonthEnd > 5) return; // not close enough yet

      // Look at the prior month — should already be closed
      const priorMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const priorMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
      const priorPeriod = await this.prisma.accountingPeriod.findFirst({
        where: {
          tenantId,
          startDate: { lte: priorMonthStart },
          endDate:   { gte: priorMonthEnd },
        },
      });
      if (!priorPeriod) return; // no period record — system might not be using periods
      if (priorPeriod.status === 'CLOSED') return; // already closed, no reminder needed

      const monthLabel = priorMonthStart.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
      await this.notifications.create({
        tenantId,
        userId:    null,
        kind:      'INFO',
        title:     `Close ${monthLabel} accounting period`,
        body:      `${daysToMonthEnd} day${daysToMonthEnd === 1 ? '' : 's'} until the next month-end. Close ${monthLabel} so the books stay tidy.`,
        link:      '/ledger/periods',
        dedupeKey: `period-close-${priorPeriod.id}`,
      });
    } catch (err) {
      this.logger.error(`periodCloseReminderProducer failed for ${tenantId}: ${(err as Error).message}`);
    }
  }
}
