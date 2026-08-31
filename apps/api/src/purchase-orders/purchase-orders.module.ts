import { Module } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  // Receiving stock is one behaviour in one place. This module used to
  // reimplement it and so posted nothing to the books.
  imports:     [InventoryModule],
  controllers: [PurchaseOrdersController],
  providers:   [PurchaseOrdersService],
  exports:     [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
