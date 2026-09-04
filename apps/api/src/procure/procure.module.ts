import { Module } from '@nestjs/common';
import { ProcureService } from './procure.service';
import { ProcureController } from './procure.controller';
import { ProcureReceiptsService } from './procure-receipts.service';
import { ProcureReceiptsController } from './procure-receipts.controller';
import { ReceiptReadLimitGuard, ReceiptReadLedger, ReleaseReceiptReadInterceptor } from './receipt-read-limit.guard';
import { InventoryModule } from '../inventory/inventory.module';
import { AiModule } from '../ai/ai.module';
import { DocumentsModule } from '../documents/documents.module';
import { SimpleEntriesModule } from '../simple-entries/simple-entries.module';

@Module({
  imports: [
    InventoryModule,      // receiving reuses receiveRawMaterial wholesale
    AiModule,             // the receipt reader, with its budget cap and quota guard
    DocumentsModule,      // the photo is filed against the request it creates
    SimpleEntriesModule,  // a line that is not stock is an expense in the books
  ],
  controllers: [ProcureController, ProcureReceiptsController],
  providers:   [ProcureService, ProcureReceiptsService, ReceiptReadLedger, ReceiptReadLimitGuard, ReleaseReceiptReadInterceptor],
  exports:     [ProcureService],
})
export class ProcureModule {}
