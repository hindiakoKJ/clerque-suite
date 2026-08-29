import { Module } from '@nestjs/common';
import { SubRecipesService } from './sub-recipes.service';
import { SubRecipesController } from './sub-recipes.controller';

@Module({
  controllers: [SubRecipesController],
  providers:   [SubRecipesService],
  exports:     [SubRecipesService],
})
export class SubRecipesModule {}
