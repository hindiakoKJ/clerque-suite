import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { AuditModule } from '../audit/audit.module';
import { RecipeCatchupService } from './recipe-catchup.service';

@Module({
  // Period-lock service is needed when receiving stock with a backdated
  // receivedAt — we reject any date that falls in a closed period.
  imports: [AccountingPeriodsModule, AuditModule],
  controllers: [InventoryController],
  providers: [InventoryService, RecipeCatchupService],
  exports: [InventoryService, RecipeCatchupService],
})
export class InventoryModule {}
