import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { OrdersModule } from '../orders/orders.module';
import { AccountingModule } from '../accounting/accounting.module';
import { TaxModule } from '../tax/tax.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

/**
 * Ecosystem event ingest (CourtSide today). Reuses OrdersService for the sale
 * path, JournalService/AccountsService for refunds, TaxCalculator for VAT, and
 * ApiKeysModule for the JwtOrApiKeyGuard machine-principal auth.
 */
@Module({
  imports:     [OrdersModule, AccountingModule, TaxModule, ApiKeysModule],
  controllers: [IngestController],
  providers:   [IngestService],
  exports:     [IngestService],
})
export class IngestModule {}
