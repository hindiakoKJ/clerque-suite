import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from './journal.service';

/**
 * How many times an event is re-offered before it is left alone.
 *
 * Most failures are transient — a closed period reopened, an account
 * reactivated, a deploy mid-write. A few are not, and re-running those every
 * ten minutes forever turns the log into noise that hides the real ones.
 */
const MAX_RETRIES = 5;

@Injectable()
export class AccountingScheduler {
  private readonly logger = new Logger(AccountingScheduler.name);
  private running = false;
  private retrying = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  // Runs every 60 seconds. Processes all PENDING accounting events across all
  // tenants so journal entries are posted without any manual intervention.
  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingEvents() {
    if (this.running) return; // skip if a previous run is still in progress
    this.running = true;

    try {
      // Find all tenants that have pending events — process each independently
      const tenants = await this.prisma.accountingEvent.findMany({
        where: { status: 'PENDING' },
        select: { tenantId: true },
        distinct: ['tenantId'],
      });

      for (const { tenantId } of tenants) {
        try {
          const result = await this.journal.processAllPending(tenantId);
          if (result.synced > 0 || result.failed > 0) {
            this.logger.log(
              `Tenant ${tenantId}: synced=${result.synced} failed=${result.failed} skipped=${result.skipped}`,
            );
          }
        } catch (err) {
          this.logger.error(`Failed to process events for tenant ${tenantId}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Give failed events another go, and shout about the ones that keep failing.
   *
   * A FAILED event was a dead end: `processAllPending` only ever selects
   * PENDING, so nothing re-offered it and nothing reported it. A sale whose
   * journal entry failed once — a period closed for the minute it took to
   * post, an account deactivated mid-shift — simply never reached the books,
   * and the only sign was that the trial balance was quietly short. That is
   * the worst shape a bug can have: silent, permanent, and invisible in a
   * report that still foots.
   *
   * Flipped back to PENDING rather than reprocessed here, so a retry goes
   * through exactly the same path as a first attempt and there is one place
   * where posting happens.
   *
   * Ten minutes, not one. A failure that is going to clear usually needs a
   * person to do something first — reopen the period, reactivate the account —
   * and hammering it every minute buries the log in the meantime.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryFailedEvents() {
    if (this.retrying) return;
    this.retrying = true;

    try {
      const retryable = await this.prisma.accountingEvent.updateMany({
        where: { status: 'FAILED', retryCount: { lt: MAX_RETRIES } },
        data:  { status: 'PENDING' },
      });
      if (retryable.count > 0) {
        this.logger.log(`Re-queued ${retryable.count} failed accounting event(s) for another attempt.`);
      }

      /*
        Events that have used up their retries.

        Reported every pass, deliberately. There is no alerting channel here,
        so the log IS the alert — and an accounting event that cannot post is
        money missing from the books. Silence would put it back where it
        started.
      */
      const stuck = await this.prisma.accountingEvent.groupBy({
        by:    ['tenantId'],
        where: { status: 'FAILED', retryCount: { gte: MAX_RETRIES } },
        _count: { _all: true },
      });
      for (const row of stuck) {
        const sample = await this.prisma.accountingEvent.findFirst({
          where:   { tenantId: row.tenantId, status: 'FAILED', retryCount: { gte: MAX_RETRIES } },
          orderBy: { updatedAt: 'desc' },
          select:  { id: true, type: true, lastError: true },
        });
        this.logger.error(
          `[accounting] Tenant ${row.tenantId} has ${row._count._all} accounting event(s) ` +
          `stuck after ${MAX_RETRIES} attempts — these are NOT on the books. ` +
          `Latest: ${sample?.type ?? '?'} ${sample?.id ?? ''} — ${sample?.lastError ?? 'no error recorded'}`,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to retry accounting events: ${(err as Error).message}`);
    } finally {
      this.retrying = false;
    }
  }
}
