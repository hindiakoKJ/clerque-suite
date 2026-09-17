import { Module } from '@nestjs/common';
import { IngredientReportsController } from './ingredient-reports.controller';
import { IngredientReportsService } from './ingredient-reports.service';
import { EndOfDayScheduler } from './end-of-day.scheduler';

/*
  The end-of-day scheduler needs no extra imports: Prisma and Telegram are
  global modules, and it writes its bell notifications itself, inside the lock
  that stops a day going out twice (see end-of-day.scheduler.ts).
*/
@Module({
  controllers: [IngredientReportsController],
  providers:   [IngredientReportsService, EndOfDayScheduler],
  // The end-of-day message reads a day's usage from here.
  exports:     [IngredientReportsService],
})
export class IngredientReportsModule {}
