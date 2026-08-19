import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderQuoteService } from './order-quote.service';
import { OrdersController } from './orders.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { TaxModule } from '../tax/tax.module';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { VoidApprovalsModule } from '../void-approvals/void-approvals.module';
// Dual auth (JWT or API key) for the commerce routes ecosystem apps call.
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports:     [AccountingPeriodsModule, TaxModule, AuditModule, NumberingModule, LoyaltyModule, VoidApprovalsModule, ApiKeysModule],
  providers:   [OrdersService, OrderQuoteService],
  controllers: [OrdersController],
  exports:     [OrdersService, OrderQuoteService],
})
export class OrdersModule {}
