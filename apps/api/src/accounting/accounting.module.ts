import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { EventsController } from './events.controller';

@Module({
  controllers: [AccountsController, JournalController, EventsController],
  providers: [AccountsService, JournalService],
  exports: [AccountsService, JournalService],
})
export class AccountingModule {}
