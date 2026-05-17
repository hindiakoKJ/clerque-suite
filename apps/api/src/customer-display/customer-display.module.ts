import { Module } from '@nestjs/common';
import { CustomerDisplayController } from './customer-display.controller';
import { CustomerDisplayService } from './customer-display.service';
import { DisplayPairingModule } from '../display-pairing/display-pairing.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';

@Module({
  imports:     [DisplayPairingModule],
  controllers: [CustomerDisplayController],
  providers:   [CustomerDisplayService, JwtAuthGuard, JwtOrDeviceTokenAuthGuard],
})
export class CustomerDisplayModule {}
