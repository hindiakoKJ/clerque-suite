import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SimpleEntriesController } from './simple-entries.controller';
import { SimpleEntriesService } from './simple-entries.service';

@Module({
  // AccountingModule exports AccountsService + JournalService (the balanced
  // poster we reuse). PrismaService is global.
  imports: [AccountingModule],
  controllers: [SimpleEntriesController],
  providers: [SimpleEntriesService],
})
export class SimpleEntriesModule {}
