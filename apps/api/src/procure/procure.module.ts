import { Module } from '@nestjs/common';
import { ProcureService } from './procure.service';
import { ProcureController } from './procure.controller';
import { ProcureReceiptsService } from './procure-receipts.service';
import { ProcureReceiptsController } from './procure-receipts.controller';
import { BuyListsExcelService } from './buy-lists-excel.service';
import { StationRequestService } from './station-request.service';
import { StationRequestController } from './station-request.controller';
import { StationCountService } from './station-count.service';
import { StationCountController, WeeklyCountReviewController } from './station-count.controller';
import { ReceiptReadLimitGuard, ReceiptReadLedger, ReleaseReceiptReadInterceptor } from './receipt-read-limit.guard';
import { InventoryModule } from '../inventory/inventory.module';
import { AiModule } from '../ai/ai.module';
import { DocumentsModule } from '../documents/documents.module';
import { SimpleEntriesModule } from '../simple-entries/simple-entries.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { DisplayPairingModule } from '../display-pairing/display-pairing.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';

@Module({
  imports: [
    InventoryModule,      // receiving reuses receiveRawMaterial wholesale
    AiModule,             // the receipt reader, with its budget cap and quota guard
    DocumentsModule,      // the photo is filed against the request it creates
    SimpleEntriesModule,  // a line that is not stock is an expense in the books
    WarehouseModule,      // "remaining: 7 boxes" on the list is a line on a cycle count
    NotificationsModule,  // a sent list reaches the owners instead of waiting to be opened
    MailModule,
    DisplayPairingModule, // a paired kitchen or bar tablet can ask for what is running low, and count the shelf
  ],
  controllers: [ProcureController, ProcureReceiptsController, StationRequestController, StationCountController, WeeklyCountReviewController],
  providers:   [ProcureService, ProcureReceiptsService, BuyListsExcelService, ReceiptReadLedger, ReceiptReadLimitGuard, ReleaseReceiptReadInterceptor,
                StationRequestService, StationCountService, JwtAuthGuard, JwtOrDeviceTokenAuthGuard],
  exports:     [ProcureService, StationRequestService],
})
export class ProcureModule {}
