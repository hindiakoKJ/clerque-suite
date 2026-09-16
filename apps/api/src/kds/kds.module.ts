import { Module } from '@nestjs/common';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';
import { StuckOrdersScheduler } from './stuck-orders.scheduler';
import { DisplayPairingModule } from '../display-pairing/display-pairing.module';
import { SubRecipesModule } from '../sub-recipes/sub-recipes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';

@Module({
  imports:     [DisplayPairingModule, SubRecipesModule, NotificationsModule],
  controllers: [KdsController],
  providers:   [KdsService, StuckOrdersScheduler, JwtAuthGuard, JwtOrDeviceTokenAuthGuard],
})
export class KdsModule {}
