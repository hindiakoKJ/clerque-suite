import { Module } from '@nestjs/common';
import { SubRecipesService } from './sub-recipes.service';
import { SubRecipesController } from './sub-recipes.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrepRotationScheduler } from './prep-rotation.scheduler';
import { StationPrepMadeController } from './station-prep-made.controller';
import { DisplayPairingModule } from '../display-pairing/display-pairing.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';

@Module({
  // Periods: making a batch moves stock and revalues an ingredient, so it
  // sits inside the same period lock as every other stock movement.
  // Notifications: the sauce rotation alerts during service.
  // Display pairing + both guards: the station screen's "Made" button is
  // reached by a paired tablet as well as a login (the guard needs both).
  imports:     [AccountingPeriodsModule, NotificationsModule, DisplayPairingModule],
  controllers: [SubRecipesController, StationPrepMadeController],
  providers:   [SubRecipesService, PrepRotationScheduler, JwtAuthGuard, JwtOrDeviceTokenAuthGuard],
  exports:     [SubRecipesService],
})
export class SubRecipesModule {}
