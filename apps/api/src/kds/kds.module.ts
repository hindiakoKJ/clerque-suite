import { Module } from '@nestjs/common';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';
import { DisplayPairingModule } from '../display-pairing/display-pairing.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';

@Module({
  imports:     [DisplayPairingModule],
  controllers: [KdsController],
  providers:   [KdsService, JwtAuthGuard, JwtOrDeviceTokenAuthGuard],
})
export class KdsModule {}
