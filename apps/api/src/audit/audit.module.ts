import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { BulkExportScheduler } from './bulk-export.scheduler';

@Module({
  controllers: [AuditController],
  // Audit D10-D — BulkExportScheduler runs every 15 min and writes
  // BULK_EXPORT_FLAGGED audit rows for users that exceed the export
  // threshold; ScheduleModule is registered globally in app.module.
  providers:   [AuditService, BulkExportScheduler],
  exports:     [AuditService],
})
export class AuditModule {}
