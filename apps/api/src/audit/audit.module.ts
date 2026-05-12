import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { BulkExportScheduler } from './bulk-export.scheduler';
import { AuditArchiveScheduler } from './audit-archive.scheduler';

@Module({
  controllers: [AuditController],
  // Audit D10-D — BulkExportScheduler runs every 15 min and writes
  // BULK_EXPORT_FLAGGED audit rows for users that exceed the export
  // threshold; ScheduleModule is registered globally in app.module.
  // Audit D8-05 — AuditArchiveScheduler streams a per-tenant daily
  // snapshot of AuditLog + LoginLog to R2 with Object Lock for tamper-
  // evidence (02:30 UTC, 30 min after the main backup).
  providers:   [AuditService, BulkExportScheduler, AuditArchiveScheduler],
  exports:     [AuditService],
})
export class AuditModule {}
