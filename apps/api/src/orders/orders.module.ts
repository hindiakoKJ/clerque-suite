import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { TaxModule } from '../tax/tax.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports:     [AccountingPeriodsModule, TaxModule, AuditModule],
  providers:   [OrdersService],
  controllers: [OrdersController],
  exports:     [OrdersService],
})
export class OrdersModule {}
