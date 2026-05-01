import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ApModule } from '../ap/ap.module';
import { ArModule } from '../ar/ar.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { TenantExportService } from './tenant-export.service';

@Module({
  imports:     [PrismaModule, AccountingModule, ApModule, ArModule, PayrollModule],
  providers:   [ExportService, TenantExportService],
  controllers: [ExportController],
})
export class ExportModule {}
