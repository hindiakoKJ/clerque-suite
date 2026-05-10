import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { TaxModule } from '../tax/tax.module';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';

@Module({
  imports:     [AccountingPeriodsModule, TaxModule, AuditModule, NumberingModule, LoyaltyModule],
  providers:   [OrdersService],
  controllers: [OrdersController],
  exports:     [OrdersService],
})
export class OrdersModule {}
