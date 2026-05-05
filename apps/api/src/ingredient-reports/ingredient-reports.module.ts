import { Module } from '@nestjs/common';
import { IngredientReportsController } from './ingredient-reports.controller';
import { IngredientReportsService } from './ingredient-reports.service';

@Module({
  controllers: [IngredientReportsController],
  providers:   [IngredientReportsService],
})
export class IngredientReportsModule {}
