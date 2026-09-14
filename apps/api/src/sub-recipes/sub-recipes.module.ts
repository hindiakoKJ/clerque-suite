import { Module } from '@nestjs/common';
import { SubRecipesService } from './sub-recipes.service';
import { SubRecipesController } from './sub-recipes.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrepRotationScheduler } from './prep-rotation.scheduler';

@Module({
  // Periods: making a batch moves stock and revalues an ingredient, so it
  // sits inside the same period lock as every other stock movement.
  // Notifications: the sauce rotation alerts during service.
  imports:     [AccountingPeriodsModule, NotificationsModule],
  controllers: [SubRecipesController],
  providers:   [SubRecipesService, PrepRotationScheduler],
  exports:     [SubRecipesService],
})
export class SubRecipesModule {}
