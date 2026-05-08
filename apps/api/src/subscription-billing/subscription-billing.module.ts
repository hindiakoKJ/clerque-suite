import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionBillingController } from './subscription-billing.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [SubscriptionBillingController],
  providers:   [SubscriptionBillingService],
  exports:     [SubscriptionBillingService],
})
export class SubscriptionBillingModule {}
