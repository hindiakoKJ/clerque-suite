import { Module } from '@nestjs/common';
import { AccountingPeriodsController } from './accounting-periods.controller';
import { AccountingPeriodsService } from './accounting-periods.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports:     [AuditModule],
  controllers: [AccountingPeriodsController],
  providers:   [AccountingPeriodsService],
  exports:     [AccountingPeriodsService],
})
export class AccountingPeriodsModule {}
