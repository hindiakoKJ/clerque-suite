import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { ProcureModule } from '../procure/procure.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { DocumentsModule } from '../documents/documents.module';
import { ServiceApiController } from './service-api.controller';
import { ReceivingDraftsController } from './receiving-drafts.controller';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { LedgerBalancesService } from './ledger-balances.service';
import { ServiceDraftsService } from './service-drafts.service';
import { ReceivingDraftsService } from './receiving-drafts.service';
import { ServiceReceiptsService } from './service-receipts.service';

/**
 * The service API (/service) a scoped API key uses, and the person's side of
 * the receiving drafts it makes (/receiving-drafts). Paid receipts by
 * Telegram (service-receipts.service.ts) reuse Procure's own receipt reader
 * and posting, exported by ProcureModule. Nothing imports this
 * module, so it adds no cycle.
 */
@Module({
  imports:     [PrismaModule, ApiKeysModule, WarehouseModule, ProcureModule, AccountingModule, AuditModule, InventoryModule, DocumentsModule],
  controllers: [ServiceApiController, ReceivingDraftsController],
  providers:   [InventorySnapshotService, LedgerBalancesService, ServiceDraftsService, ReceivingDraftsService, ServiceReceiptsService],
})
export class ServiceApiModule {}
