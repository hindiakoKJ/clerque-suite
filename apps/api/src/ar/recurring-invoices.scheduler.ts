/**
 * Sprint 22 — Recurring AR Invoice materializer.
 *
 * Runs daily at 01:05 UTC. For every ACTIVE template where nextRunAt <= now:
 *   1. Create a DRAFT ARInvoice with the template's customer + lines copied
 *      verbatim. The child is linked back via ARInvoice.recurringTemplateId.
 *   2. Advance nextRunAt using computeNextRunAt(prevNextRunAt, freq, dayOfPeriod).
 *   3. If the template has an endDate and the new nextRunAt > endDate, set
 *      status='COMPLETED' instead of leaving it ACTIVE.
 *   4. Bump runCount, set lastRunAt = now.
 *
 * Children are intentionally left DRAFT — utility-style recurring bills
 * often need owner review (amounts vary). The owner clicks "Post" once
 * they've verified the figures, which fires the standard AR JE path.
 *
 * Failure handling: every template is wrapped in its own try/catch so one
 * tenant's broken COA / missing customer / bad data does not abort the
 * loop for everyone else. Failures are logged and counted.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma } from '@prisma/client';
import { computeNextRunAt } from '../common/recurrence';

@Injectable()
export class RecurringInvoicesScheduler {
  private readonly logger = new Logger(RecurringInvoicesScheduler.name);
  private running = false;

  constructor(
    private readonly prisma:    PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  /** 01:05 UTC daily. */
  @Cron('5 1 * * *')
  async runDailyMaterializer() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.materializeDue(new Date());
      this.logger.log(
        `[recurring-ar] daily run: materialized=${r.materialized} completed=${r.completed} failed=${r.failed}`,
      );
    } catch (err) {
      this.logger.error(
        `[recurring-ar] daily run failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Materialize one DRAFT child invoice for every ACTIVE template whose
   * nextRunAt <= `now`. Exposed (non-private) so the spec can call it.
   */
  async materializeDue(now: Date): Promise<{ materialized: number; completed: number; failed: number }> {
    const due = await this.prisma.recurringInvoiceTemplate.findMany({
      where:   { status: 'ACTIVE', nextRunAt: { lte: now } },
      include: { lines: true },
    });

    let materialized = 0, completed = 0, failed = 0;
    for (const tpl of due) {
      try {
        const result = await this.materializeOne(tpl, now);
        materialized++;
        if (result.completed) completed++;
      } catch (err) {
        failed++;
        this.logger.error(
          `[recurring-ar] template ${tpl.templateNumber} (tenant ${tpl.tenantId}) failed: ${(err as Error).message}`,
        );
      }
    }
    return { materialized, completed, failed };
  }

  /**
   * Materialize one child invoice + advance the template. Wrapped in a
   * single transaction so the invoice creation and nextRunAt update commit
   * together — no chance of a duplicate run on retry.
   */
  private async materializeOne(
    tpl: Prisma.RecurringInvoiceTemplateGetPayload<{ include: { lines: true } }>,
    now: Date,
  ): Promise<{ completed: boolean }> {
    const dueDate = new Date(tpl.nextRunAt.getTime());
    dueDate.setDate(dueDate.getDate() + (tpl.termsDays ?? 0));

    // Compute the next-after-this run; used both to write back to the
    // template AND to decide if we've crossed endDate.
    const nextAfter = computeNextRunAt(tpl.nextRunAt, tpl.frequency, tpl.dayOfPeriod);
    const shouldComplete = tpl.endDate ? nextAfter.getTime() > tpl.endDate.getTime() : false;

    await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.numbering.next(tpl.tenantId, 'AR_INVOICE', null, tx);

      await tx.aRInvoice.create({
        data: {
          tenantId:           tpl.tenantId,
          branchId:           tpl.branchId,
          invoiceNumber,
          customerId:         tpl.customerId,
          invoiceDate:        tpl.nextRunAt,
          postingDate:        tpl.nextRunAt,
          dueDate,
          termsDays:          tpl.termsDays,
          subtotal:           tpl.subtotal,
          vatAmount:          tpl.vatAmount,
          totalAmount:        tpl.totalAmount,
          paidAmount:         new Prisma.Decimal(0),
          balanceAmount:      tpl.totalAmount,
          status:             'DRAFT',
          description:        tpl.description ?? `Recurring: ${tpl.name}`,
          notes:              tpl.notes,
          createdById:        tpl.createdById,
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

      await tx.recurringInvoiceTemplate.update({
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
