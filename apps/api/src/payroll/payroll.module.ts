import { Module } from '@nestjs/common';
import { PrismaModule }      from '../prisma/prisma.module';
import { AccountingModule }  from '../accounting/accounting.module';
import { AuditModule }       from '../audit/audit.module';
import { PayrollService }    from './payroll.service';
import { PayrollController } from './payroll.controller';

@Module({
  imports:     [PrismaModule, AccountingModule, AuditModule],
  controllers: [PayrollController],
  providers:   [PayrollService],
  exports:     [PayrollService],
})
export class PayrollModule {}
