import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { ArController } from './ar.controller';
import { CustomersService } from './customers.service';
import { ArService } from './ar.service';
import { ARInvoicesController } from './ar-invoices.controller';
import { ARInvoicesService } from './ar-invoices.service';
import { ARPaymentsController } from './ar-payments.controller';
import { ARPaymentsService } from './ar-payments.service';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports:     [PrismaModule, AccountingModule, AccountingPeriodsModule, NumberingModule],
  controllers: [CustomersController, ArController, ARInvoicesController, ARPaymentsController],
  providers:   [CustomersService, ArService, ARInvoicesService, ARPaymentsService],
  exports:     [CustomersService, ArService, ARInvoicesService, ARPaymentsService],
})
export class ArModule {}
