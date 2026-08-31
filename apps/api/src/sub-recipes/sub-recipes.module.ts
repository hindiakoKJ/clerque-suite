import { Module } from '@nestjs/common';
import { SubRecipesService } from './sub-recipes.service';
import { SubRecipesController } from './sub-recipes.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';

@Module({
  // Periods: making a batch moves stock and revalues an ingredient, so it
  // sits inside the same period lock as every other stock movement.
  imports:     [AccountingPeriodsModule],
  controllers: [SubRecipesController],
  providers:   [SubRecipesService],
  exports:     [SubRecipesService],
})
export class SubRecipesModule {}
