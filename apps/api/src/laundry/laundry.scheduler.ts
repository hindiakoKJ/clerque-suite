/**
 * Sprint 19 — Laundry wash-cycle auto-completion worker.
 *
 * Every minute, scans for RUNNING laundry-order lines whose cycleEndsAt
 * has passed and which the operator marked as auto-complete at start
 * time. Promotes each line to DONE and frees the assigned machine.
 *
 * The work is delegated to LaundryService.tickAutoCompleteCycles which
 * handles the per-row transaction + status-conditional updates so two
 * overlapping ticks cannot double-flip a line.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LaundryService } from './laundry.service';

@Injectable()
export class LaundryScheduler {
  private readonly logger = new Logger(LaundryScheduler.name);
  private running = false;

  constructor(private readonly svc: LaundryService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (this.running) return; // overlap-skip: prior tick still in flight
    this.running = true;
    try {
      const { promoted } = await this.svc.tickAutoCompleteCycles();
      if (promoted > 0) {
        this.logger.log(`[wash-cycle] auto-completed ${promoted} line(s)`);
      }
    } catch (err) {
      this.logger.error(
        `[wash-cycle] tick failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }
}
