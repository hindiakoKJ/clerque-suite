import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { ApModule } from '../ap/ap.module';
import { ArModule } from '../ar/ar.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';

@Module({
  imports:     [AccountingModule, ApModule, ArModule, PayrollModule],
  providers:   [ExportService],
  controllers: [ExportController],
})
export class ExportModule {}
