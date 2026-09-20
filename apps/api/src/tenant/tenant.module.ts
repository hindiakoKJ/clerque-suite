import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantBrandingController } from './tenant-branding.controller';
import { TenantService } from './tenant.service';
import { TenantLogoService } from './tenant-logo.service';
import { TaxModule } from '../tax/tax.module';
import { AuditModule } from '../audit/audit.module';
import { DisplayPairingModule } from '../display-pairing/display-pairing.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';

@Module({
  // DisplayPairingModule + the two guards let paired screens read GET /tenant/branding.
  imports:     [TaxModule, AuditModule, DisplayPairingModule],
  controllers: [TenantController, TenantBrandingController],
  providers:   [TenantService, TenantLogoService, JwtAuthGuard, JwtOrDeviceTokenAuthGuard],
  exports:     [TenantService],
})
export class TenantModule {}
