import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';

@Module({
  imports:     [AccountingModule],
  providers:   [ExportService],
  controllers: [ExportController],
})
export class ExportModule {}
