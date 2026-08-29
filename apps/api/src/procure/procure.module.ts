import { Module } from '@nestjs/common';
import { ProcureService } from './procure.service';
import { ProcureController } from './procure.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports:     [InventoryModule],   // receiving reuses receiveRawMaterial wholesale
  controllers: [ProcureController],
  providers:   [ProcureService],
  exports:     [ProcureService],
})
export class ProcureModule {}
