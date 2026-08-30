import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { AuditModule } from '../audit/audit.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  // Audit: handover drawer counts are written to the immutable audit log,
  // where the Who column and the no-update/no-delete triggers already live.
  /*
    Reports: closing the LAST open shift at a branch is the end of the
    business day, and that is when the Z-Read is written. ReportsModule
    depends only on Prisma, so there is no cycle back to shifts.
  */
  imports: [AuditModule, ReportsModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
