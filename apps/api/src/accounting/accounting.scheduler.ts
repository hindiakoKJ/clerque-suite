import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from './journal.service';

@Injectable()
export class AccountingScheduler {
  private readonly logger = new Logger(AccountingScheduler.name);
  private running = false;

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
}
