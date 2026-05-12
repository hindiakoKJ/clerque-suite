/**
 * Sprint 21 — Audit-log immutable archive (closes D8-05).
 *
 * Streams a per-tenant audit-log + login-log snapshot to the same R2/S3
 * bucket that holds the nightly tenant backups, under a separate prefix
 * (`audit-archive/<YYYY-MM-DD>/<tenant-slug>.json`). Runs daily at 02:30
 * UTC — 30 minutes after the main backup so the two don't compete for
 * connection-pool slots.
 *
 * Why this matters: audit rows in Postgres are mutable (a sufficiently
 * privileged attacker who pwns the DB can DELETE / UPDATE them). The R2
 * copy, when the bucket has Object Lock enabled (owner action D1-06),
 * becomes write-once-read-many — the attacker cannot tamper with what's
 * already been streamed. This is the "log integrity" half of the audit's
 * D8-05 recommendation; the Object-Lock toggle on the bucket is the
 * "ransomware-proof storage" half.
 *
 * When the bucket has NO Object Lock yet, the archive still ships — but
 * it inherits the bucket's mutability. The owner getting Object Lock on
 * later (when they discharge D1-06) upgrades the historical archive
 * automatically: every NEW write becomes locked.
 *
 * Configuration: shares S3_BUCKET / S3_ACCESS_KEY_ID etc. with the main
 * backup scheduler. No new env vars.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class AuditArchiveScheduler {
  private readonly logger = new Logger(AuditArchiveScheduler.name);
  private running = false;

  constructor(
    private readonly prisma:  PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * 02:30 UTC daily. Deliberately offset from the 02:00 main backup so
   * Postgres connection-pool contention doesn't spike.
   */
  @Cron('30 2 * * *')
  async runDailyArchive() {
    if (this.running) return;
    this.running = true;
    try {
      await this.archiveAllTenants();
    } catch (err) {
      this.logger.error(
        `[audit-archive] daily run failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Iterates every active tenant and uploads a single JSON file
   * containing the previous day's AuditLog + LoginLog rows. Limits the
   * day-window to "previous 24h" so each day's file is bounded in size.
   */
  async archiveAllTenants(): Promise<{ uploaded: number; skipped: number; failed: number }> {
    if (this.storage.getDriver() !== 'S3') {
      this.logger.warn(
        '[audit-archive] storage driver is not S3 — skipping. Set S3_BUCKET to enable.',
      );
      return { uploaded: 0, skipped: 0, failed: 0 };
    }

    const tenants = await this.prisma.tenant.findMany({
      where:  { status: { in: ['ACTIVE', 'GRACE'] } },
      select: { id: true, slug: true },
    });

    // PH-local YYYY-MM-DD folder so listings group by day.
    const phDay = (() => {
      const ph = new Date(Date.now() + 8 * 60 * 60_000);
      return ph.toISOString().slice(0, 10);
    })();

    // Window: previous 24h. Pinned to a stable boundary so re-runs are
    // idempotent (same window → same payload).
    const windowEnd   = new Date();
    const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60_000);

    let uploaded = 0, skipped = 0, failed = 0;
    for (const t of tenants) {
      try {
        const [auditRows, loginRows] = await Promise.all([
          this.prisma.auditLog.findMany({
            where: {
              tenantId:  t.id,
              createdAt: { gte: windowStart, lt: windowEnd },
            },
            orderBy: { createdAt: 'asc' },
          }),
          this.prisma.loginLog.findMany({
            where: {
              user: { tenantId: t.id },
              createdAt: { gte: windowStart, lt: windowEnd },
            },
            orderBy: { createdAt: 'asc' },
          }),
        ]);

        if (auditRows.length === 0 && loginRows.length === 0) {
          skipped++;
          continue;
        }

        const payload = {
          version:     'clerque-audit-archive-v1',
          tenantId:    t.id,
          tenantSlug:  t.slug,
          windowStart: windowStart.toISOString(),
          windowEnd:   windowEnd.toISOString(),
          generatedAt: new Date().toISOString(),
          auditLog:    auditRows,
          loginLog:    loginRows,
        };
        const key = `audit-archive/${phDay}/${t.slug}.json`;
        await this.storage.putBuffer(
          Buffer.from(JSON.stringify(payload)),
          key,
          { contentType: 'application/json' },
        );
        uploaded++;
      } catch (err) {
        failed++;
        this.logger.error(
          `[audit-archive] tenant ${t.slug} failed: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `[audit-archive] daily run: uploaded=${uploaded} skipped=${skipped} failed=${failed} of ${tenants.length} tenants`,
    );
    return { uploaded, skipped, failed };
  }
}
