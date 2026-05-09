import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { SubscriptionBillingService } from './subscription-billing.service';
import { DemoBootstrapService } from './demo-bootstrap.service';

@Module({
  imports:     [PrismaModule, AccountingModule],
  controllers: [PlatformController],
  providers:   [PlatformService, SubscriptionBillingService, DemoBootstrapService],
  exports:     [PlatformService, SubscriptionBillingService],
})
export class PlatformModule {}
