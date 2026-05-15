import { Module } from '@nestjs/common';
import { InventoryReportsService } from './inventory-reports.service';
import { InventoryReportsController } from './inventory-reports.controller';

@Module({
  controllers: [InventoryReportsController],
  providers:   [InventoryReportsService],
  exports:     [InventoryReportsService],
})
export class InventoryReportsModule {}
