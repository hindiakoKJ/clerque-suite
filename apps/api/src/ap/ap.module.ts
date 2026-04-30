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
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports:     [PrismaModule, AccountingModule, AccountingPeriodsModule, NumberingModule],
  controllers: [VendorsController, ExpensesController, APBillsController, APPaymentsController],
  providers:   [VendorsService, ExpensesService, APBillsService, APPaymentsService],
  exports:     [VendorsService, ExpensesService, APBillsService, APPaymentsService],
})
export class ApModule {}
