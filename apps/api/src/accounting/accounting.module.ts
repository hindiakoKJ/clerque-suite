import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { AccountingScheduler } from './accounting.scheduler';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';

@Module({
  imports: [AccountingPeriodsModule],
  controllers: [AccountsController, JournalController, EventsController],
  providers: [AccountsService, JournalService, EventsService, AccountingScheduler],
  exports: [AccountsService, JournalService],
})
export class AccountingModule {}
