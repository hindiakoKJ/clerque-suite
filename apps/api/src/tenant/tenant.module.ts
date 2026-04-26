import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { TaxModule } from '../tax/tax.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports:     [TaxModule, AuditModule],
  controllers: [TenantController],
  providers:   [TenantService],
  exports:     [TenantService],
})
export class TenantModule {}
