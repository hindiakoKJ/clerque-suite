import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { ArController } from './ar.controller';
import { CustomersService } from './customers.service';
import { ArService } from './ar.service';
import { ARInvoicesController } from './ar-invoices.controller';
import { ARInvoicesService } from './ar-invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { ARPaymentsController } from './ar-payments.controller';
import { ARPaymentsService } from './ar-payments.service';
import { CustomerAdvancesController } from './customer-advances.controller';
import { CustomerAdvancesService } from './customer-advances.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { CreditMemosController } from './credit-memos.controller';
import { CreditMemosService } from './credit-memos.service';
import { RecurringInvoicesController } from './recurring-invoices.controller';
import { RecurringInvoicesService } from './recurring-invoices.service';
import { RecurringInvoicesScheduler } from './recurring-invoices.scheduler';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports:     [PrismaModule, AccountingModule, AccountingPeriodsModule, NumberingModule, AuditModule],
  controllers: [
    CustomersController, ArController, ARInvoicesController, ARPaymentsController,
    CustomerAdvancesController, QuotesController, CreditMemosController,
    RecurringInvoicesController,
  ],
  providers:   [
    CustomersService, ArService, ARInvoicesService, ARPaymentsService,
    CustomerAdvancesService, QuotesService, CreditMemosService,
    RecurringInvoicesService,
    InvoicePdfService,
    // Sprint 22 — @Cron materializer for recurring AR invoices. Provider only;
    // ScheduleModule is registered globally in app.module.
    RecurringInvoicesScheduler,
  ],
  exports:     [
    CustomersService, ArService, ARInvoicesService, ARPaymentsService,
    CustomerAdvancesService, QuotesService, CreditMemosService,
    RecurringInvoicesService,
    InvoicePdfService,
  ],
})
export class ArModule {}
