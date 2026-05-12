/**
 * Audit D10-D — Bulk-export alert.
 *
 * Every 15 minutes, scan AuditLog for DATA_EXPORTED rows in the last
 * hour, grouped by (tenantId, performedBy). If any user breached the
 * 5-exports-in-an-hour threshold, write one BULK_EXPORT_FLAGGED row
 * (idempotent on a derived hour-bucket entityId) and email the tenant's
 * BUSINESS_OWNER as a best-effort heads-up.
 *
 * Why a separate scheduler and not inline in ExportController:
 *   - Decouples the alert from the export hot path — slow audit / mail
 *     calls don't delay the download.
 *   - One row per (tenant, user, hour-bucket) keeps the table sane even
 *     under abusive automation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class BulkExportScheduler {
  private readonly logger = new Logger(BulkExportScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
    private readonly mail:   MailService,
  ) {}

  /**
   * Every 15 minutes — flag users exporting >5 reports in a rolling hour.
   * The cron string '*​/15 * * * *' fires at :00 :15 :30 :45.
   */
  @Cron('*/15 * * * *')
  async detectBulkExports(): Promise<void> {
    const since = new Date(Date.now() - 60 * 60 * 1000);

    // Group exports per tenant + user within the window.
    const groups = await this.prisma.auditLog.groupBy({
      by: ['tenantId', 'performedBy'],
      where: {
        action:    'DATA_EXPORTED',
        createdAt: { gte: since },
        performedBy: { not: null },
      },
      _count: { _all: true },
    });

    for (const g of groups) {
      const count = g._count._all;
      if (count <= 5) continue;
      if (!g.performedBy) continue;

      // Idempotency: derive the entityId from (userId, hour-bucket-floor).
      // A second run in the same hour for the same user no-ops because of
      // a per-row uniqueness check via findFirst below.
      const hourBucket = new Date();
      hourBucket.setMinutes(0, 0, 0);
      const bucketKey = `${g.performedBy}:${hourBucket.toISOString()}`;

      const already = await this.prisma.auditLog.findFirst({
        where: {
          tenantId:    g.tenantId,
          action:      'BULK_EXPORT_FLAGGED',
          entityId:    bucketKey,
        },
        select: { id: true },
      });
      if (already) continue;

      await this.audit.log({
        tenantId:    g.tenantId,
        action:      'BULK_EXPORT_FLAGGED',
        entityType:  'User',
        entityId:    bucketKey,
        performedBy: g.performedBy,
        description: `Potential bulk exfiltration: ${count} exports in last hour`,
        after:       {
          exportCount: count,
          windowStart: since.toISOString(),
          windowEnd:   new Date().toISOString(),
          userId:      g.performedBy,
        },
      });

      // Best-effort owner alert. We don't fail the scheduler on mail errors.
      try {
        const owner = await this.prisma.user.findFirst({
          where:  { tenantId: g.tenantId, role: 'BUSINESS_OWNER', isActive: true },
          select: { email: true, name: true },
        });
        const offender = await this.prisma.user.findFirst({
          where:  { id: g.performedBy, tenantId: g.tenantId },
          select: { name: true, email: true },
        });
        if (owner?.email) {
          await this.mail.sendBulkExportAlert({
            to:          owner.email,
            ownerName:   owner.name ?? null,
            actorName:   offender?.name ?? null,
            actorEmail:  offender?.email ?? null,
            exportCount: count,
          });
        }
      } catch (err) {
        this.logger.warn(
          `Bulk-export mail alert failed for tenant ${g.tenantId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
