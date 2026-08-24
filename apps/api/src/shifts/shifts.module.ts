import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  // Audit: handover drawer counts are written to the immutable audit log,
  // where the Who column and the no-update/no-delete triggers already live.
  imports: [AuditModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
