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
  // Procure posts a receipt's non-stock lines (a delivery fee, a repair)
  // through the same fixed 2-line entries rather than growing its own.
  exports: [SimpleEntriesService],
})
export class SimpleEntriesModule {}
