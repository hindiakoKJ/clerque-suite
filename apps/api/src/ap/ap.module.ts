import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorsController } from './vendors.controller';
import { ExpensesController } from './expenses.controller';
import { VendorsService } from './vendors.service';
import { ExpensesService } from './expenses.service';
import { APBillsController } from './ap-bills.controller';
import { APBillsService } from './ap-bills.service';
import { APPaymentsController } from './ap-payments.controller';
import { APPaymentsService } from './ap-payments.service';
import { VendorCreditNotesController } from './vendor-credit-notes.controller';
import { VendorCreditNotesService } from './vendor-credit-notes.service';
import { VendorAdvancesController } from './vendor-advances.controller';
import { VendorAdvancesService } from './vendor-advances.service';
import { RecurringBillsController } from './recurring-bills.controller';
import { RecurringBillsService } from './recurring-bills.service';
import { RecurringBillsScheduler } from './recurring-bills.scheduler';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports:     [PrismaModule, AccountingModule, AccountingPeriodsModule, NumberingModule, AuditModule],
  controllers: [
    VendorsController, ExpensesController, APBillsController, APPaymentsController,
    VendorCreditNotesController, VendorAdvancesController,
    RecurringBillsController,
  ],
  providers:   [
    VendorsService, ExpensesService, APBillsService, APPaymentsService,
    VendorCreditNotesService, VendorAdvancesService,
    RecurringBillsService,
    // Sprint 22 — @Cron materializer for recurring AP bills.
    RecurringBillsScheduler,
  ],
  exports:     [
    VendorsService, ExpensesService, APBillsService, APPaymentsService,
    VendorCreditNotesService, VendorAdvancesService,
    RecurringBillsService,
  ],
})
export class ApModule {}
