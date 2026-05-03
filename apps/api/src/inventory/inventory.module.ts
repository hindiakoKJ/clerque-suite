import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';

@Module({
  // Period-lock service is needed when receiving stock with a backdated
  // receivedAt — we reject any date that falls in a closed period.
  imports: [AccountingPeriodsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
