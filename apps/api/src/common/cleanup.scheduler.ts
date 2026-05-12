/**
 * Sprint 21 — D5-06: Nightly cleanup of expired idempotency-key replay rows.
 *
 * IdempotencyKey rows carry a 24h TTL via `expiresAt`. We purge them at
 * 03:15 UTC daily so the table stays bounded — without this, every payment
 * / order / refund POST leaves a permanent row behind.
 *
 * Co-located with other generic common-plane crons (separate from the
 * audit-archive scheduler so they can be reasoned about independently).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CleanupScheduler {
  private readonly logger = new Logger(CleanupScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 03:15 UTC daily — well clear of the 02:00 backup + 02:30 audit-archive. */
  @Cron('15 3 * * *')
  async purgeExpiredIdempotencyKeys() {
    try {
      const result = await this.prisma.idempotencyKey.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      this.logger.log(`[cleanup] purged ${result.count} expired idempotency keys`);
    } catch (err) {
      this.logger.error(
        `[cleanup] idempotency-key purge failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
