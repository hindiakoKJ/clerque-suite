/**
 * Sprint 22 — Recurring AP Bill materializer. Mirror of recurring-invoices
 * scheduler for AP, with WHT amount + ATC code copied into each child.
 *
 * Children land as DRAFT — owner reviews amounts (utility bills vary) and
 * posts manually, which fires the standard AP JE path + the 2307 trail.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma } from '@prisma/client';
import { computeNextRunAt } from '../common/recurrence';

@Injectable()
export class RecurringBillsScheduler {
  private readonly logger = new Logger(RecurringBillsScheduler.name);
  private running = false;

  constructor(
    private readonly prisma:    PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  /** 01:05 UTC daily. Same slot as recurring-ar — independent runs. */
  @Cron('5 1 * * *')
  async runDailyMaterializer() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.materializeDue(new Date());
      this.logger.log(
        `[recurring-ap] daily run: materialized=${r.materialized} completed=${r.completed} failed=${r.failed}`,
      );
    } catch (err) {
      this.logger.error(
        `[recurring-ap] daily run failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  async materializeDue(now: Date): Promise<{ materialized: number; completed: number; failed: number }> {
    const due = await this.prisma.recurringBillTemplate.findMany({
      where:   { status: 'ACTIVE', nextRunAt: { lte: now } },
      include: { lines: true },
    });

    let materialized = 0, completed = 0, failed = 0;
    for (const tpl of due) {
      try {
        const r = await this.materializeOne(tpl, now);
        materialized++;
        if (r.completed) completed++;
      } catch (err) {
        failed++;
        this.logger.error(
          `[recurring-ap] template ${tpl.templateNumber} (tenant ${tpl.tenantId}) failed: ${(err as Error).message}`,
        );
      }
    }
    return { materialized, completed, failed };
  }

  private async materializeOne(
    tpl: Prisma.RecurringBillTemplateGetPayload<{ include: { lines: true } }>,
    now: Date,
  ): Promise<{ completed: boolean }> {
    const dueDate = new Date(tpl.nextRunAt.getTime());
    dueDate.setDate(dueDate.getDate() + (tpl.termsDays ?? 0));

    const nextAfter = computeNextRunAt(tpl.nextRunAt, tpl.frequency, tpl.dayOfPeriod);
    const shouldComplete = tpl.endDate ? nextAfter.getTime() > tpl.endDate.getTime() : false;

    const whtAmount = Number(tpl.whtAmount);
    const totalAmount = Number(tpl.totalAmount);

    await this.prisma.$transaction(async (tx) => {
      const billNumber = await this.numbering.next(tpl.tenantId, 'AP_BILL', null, tx);

      await tx.aPBill.create({
        data: {
          tenantId:            tpl.tenantId,
          branchId:            tpl.branchId,
          billNumber,
          vendorId:            tpl.vendorId,
          billDate:            tpl.nextRunAt,
          postingDate:         tpl.nextRunAt,
          dueDate,
          termsDays:           tpl.termsDays,
          subtotal:            tpl.subtotal,
          vatAmount:           tpl.vatAmount,
          whtAmount:           tpl.whtAmount,
          whtAtcCode:          tpl.whtAtcCode,
          totalAmount:         tpl.totalAmount,
          paidAmount:          new Prisma.Decimal(0),
          balanceAmount:       new Prisma.Decimal(totalAmount - whtAmount),
          status:              'DRAFT',
          description:         tpl.description ?? `Recurring: ${tpl.name}`,
          notes:               tpl.notes,
          createdById:         tpl.createdById,
          recurringTemplateId: tpl.id,
          lines: {
            create: tpl.lines.map((l) => ({
              accountId:   l.accountId,
              description: l.description,
              quantity:    l.quantity,
              unitPrice:   l.unitPrice,
              taxAmount:   l.taxAmount,
              lineTotal:   l.lineTotal,
            })),
          },
        },
      });

      await tx.recurringBillTemplate.update({
        where: { id: tpl.id },
        data: {
          lastRunAt: now,
          runCount:  { increment: 1 },
          nextRunAt: nextAfter,
          status:    shouldComplete ? 'COMPLETED' : 'ACTIVE',
        },
      });
    });

    return { completed: shouldComplete };
  }
}
