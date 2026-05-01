import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { JournalTemplatesController } from './journal-templates.controller';
import { JournalTemplatesService } from './journal-templates.service';
import { JournalTemplatesScheduler } from './journal-templates.scheduler';

@Module({
  imports:     [PrismaModule, AccountingModule, AccountingPeriodsModule],
  controllers: [JournalTemplatesController],
  providers:   [JournalTemplatesService, JournalTemplatesScheduler],
})
export class JournalTemplatesModule {}
