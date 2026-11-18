import { Module } from '@nestjs/common';
import { PrismaModule }      from '../prisma/prisma.module';
import { AccountingModule }  from '../accounting/accounting.module';
import { AuditModule }       from '../audit/audit.module';
import { PayrollService }    from './payroll.service';
import { PayrollController } from './payroll.controller';
import { CashAdvanceService } from './cash-advance.service';
import { CashAdvanceController } from './cash-advance.controller';

@Module({
  imports:     [PrismaModule, AccountingModule, AuditModule],
  controllers: [PayrollController, CashAdvanceController],
  providers:   [PayrollService, CashAdvanceService],
  exports:     [PayrollService],
})
export class PayrollModule {}
