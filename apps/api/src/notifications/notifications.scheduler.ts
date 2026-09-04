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
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { PH_TIMEZONE } from '@repo/shared-types';

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Daily 3am Manila.
   *
   * The offset used to be applied TWICE. The schedule was written as 19:00 --
   * 3am Manila hand-converted to UTC -- and then `timeZone: PH_TIMEZONE` was
   * passed as well, so the runner read 19:00 as a Manila time and fired at
   * 7pm. Nobody noticed because the job still ran once a day and its output
   * still looked right.
   *
   * It matters for THIS job more than most: the whole point of "these
   * ingredients are running low" is that it lands before the shop opens and
   * before someone goes to the market. Arriving at 7pm put it in the middle of
   * evening service, a full trading day after it could have been acted on.
   *
   * `timeZone` does the conversion. The cron expression states the local time
   * the shop actually experiences, and nothing is converted by hand.
   */
  @Cron('0 3 * * *', { timeZone: PH_TIMEZONE })
  async runDailyProducers() {
    this.logger.log('Running daily notification producers…');
    const tenants = await this.prisma.tenant.findMany({
      where:  { status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    for (const t of tenants) {
      await Promise.allSettled([
        this.lowStockProducer(t.id),
        this.lowIngredientProducer(t.id),
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
        // Procure, not POS: this broadcasts to every user in the tenant, and
        // MDM / warehouse staff have no POS access at all -- the alert would
        // land on a page middleware bounces them off. The requests screen is
        // also where a shortage is actionable rather than merely visible.
        link:      '/procure/requests',
        dedupeKey: `low-stock-${flagged.length}`,
      });
    } catch (err) {
      this.logger.error(`lowStockProducer failed for ${tenantId}: ${(err as Error).message}`);
    }
  }

  /**
   * Ingredients running out → owner alert.
   *
   * The producer above reads InventoryItem, which is FINISHED GOODS. A cafe
   * selling recipe-based drinks has no rows there at all, so the only job in
   * the product that runs on its own was structurally incapable of warning
   * about the one thing that stops a cafe trading: an ingredient hitting zero.
   *
   * Every other ingredient warning in the system is PULL. The prep board, the
   * menu ceiling, Check stock, the days-of-cover report — all of them are true
   * and all of them only exist if a human decides to go and look. Nothing ever
   * made one look. So the milk ran out over a quiet weekend, the tile greyed
   * out on Monday morning, and the barista said no to a customer while the
   * system had been correct the whole time and had told nobody.
   *
   * Three numbers, deliberately, because two of them work without anyone
   * having configured anything:
   *
   *   AT ZERO      — nothing left. Needs no reorder level to be true, which
   *                  matters because most ingredients have none.
   *   BELOW LEVEL  — the classic warning, for the ones that are set up.
   *   UNWATCHED    — how many ingredients have no reorder level at all, so
   *                  "nothing is low" can be read correctly. A shop with 56 of
   *                  75 unmonitored is not a shop with nothing to buy.
   */
  private async lowIngredientProducer(tenantId: string): Promise<void> {
    try {
      const branches = await this.prisma.branch.findMany({
        where:  { tenantId, isActive: true },
        select: { id: true, name: true },
      });
      if (branches.length === 0) return;

      const atZero:  string[] = [];
      const belowRe: string[] = [];
      const toMake:  string[] = [];
      let unwatched = 0;

      for (const b of branches) {
        const rows = await this.prisma.rawMaterial.findMany({
          where:  { tenantId, isActive: true },
          select: {
            name: true, unit: true, lowStockAlert: true,
            inventory: { where: { branchId: b.id }, select: { quantity: true } },
            // Something the shop MAKES is not something to go and buy, and a
            // parked batch is empty by design for half its life -- alerting on
            // it nightly would train everyone to ignore the alert.
            subRecipeItems: { select: { id: true }, take: 1 },
          },
        });
        for (const r of rows) {
          const onHand = Number(r.inventory[0]?.quantity ?? 0);
          const level  = r.lowStockAlert != null ? Number(r.lowStockAlert) : null;
          const where  = branches.length > 1 ? ` (${b.name})` : '';
          const isPrep = r.subRecipeItems.length > 0;
          if (isPrep) {
            // Only worth mentioning once someone has said what "low" means for
            // it. An empty parked batch with no par level is just Tuesday.
            if (level != null && level > 0 && onHand <= level) {
              toMake.push(`${r.name} — ${onHand} ${r.unit} left${where}`);
            }
          } else if (onHand <= 0) {
            atZero.push(`${r.name}${where}`);
          } else if (level != null && level > 0 && onHand <= level) {
            belowRe.push(`${r.name} — ${onHand} ${r.unit} left${where}`);
          }
          // Counted once, on the first branch, so a two-branch shop does not
          // report the same unset ingredient twice.
          if (level == null && b.id === branches[0].id) unwatched += 1;
        }
      }

      // Nothing to say beats a nightly alert that always fires.
      if (atZero.length === 0 && belowRe.length === 0 && toMake.length === 0) return;

      const parts: string[] = [];
      if (atZero.length) {
        parts.push(`OUT: ${atZero.slice(0, 5).join(', ')}` +
          (atZero.length > 5 ? ` and ${atZero.length - 5} more` : ''));
      }
      if (belowRe.length) {
        parts.push(`Low: ${belowRe.slice(0, 5).join(', ')}` +
          (belowRe.length > 5 ? ` and ${belowRe.length - 5} more` : ''));
      }
      if (toMake.length) {
        parts.push(`To prep: ${toMake.slice(0, 5).join(', ')}` +
          (toMake.length > 5 ? ` and ${toMake.length - 5} more` : ''));
      }
      if (unwatched > 0) {
        parts.push(`${unwatched} ingredient${unwatched === 1 ? '' : 's'} ` +
          `${unwatched === 1 ? 'has' : 'have'} no reorder level, so ` +
          `${unwatched === 1 ? 'it is' : 'they are'} not being watched at all.`);
      }

      await this.notifications.create({
        tenantId,
        userId: null,
        // Out of something is a different conversation from getting low.
        kind:   atZero.length > 0 ? 'ERROR' : 'WARNING',
        title:  atZero.length > 0
          ? `${atZero.length} ingredient${atZero.length === 1 ? '' : 's'} out of stock`
          : belowRe.length > 0
            ? `${belowRe.length} ingredient${belowRe.length === 1 ? '' : 's'} running low`
            : `${toMake.length} item${toMake.length === 1 ? '' : 's'} to prep`,
        body:   parts.join(' · '),
        link:   '/procure/requests',
        // Keyed on the counts, so a shop whose position has not changed is not
        // told again every night -- but a new shortage still gets through.
        dedupeKey: `low-ingredient-${atZero.length}-${belowRe.length}-${toMake.length}`,
      });
    } catch (err) {
      this.logger.error(`lowIngredientProducer failed for ${tenantId}: ${(err as Error).message}`);
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
