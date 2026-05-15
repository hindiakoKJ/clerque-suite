import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { SubscriptionPaymentsService } from './subscription-payments.service';
import { SubscriptionPaymentsController } from './subscription-payments.controller';

/**
 * Sprint 24 — Manual subscription payment collection (pre-PayMongo).
 *
 * Customer-facing endpoints (public, gated by reference code), owner-facing
 * verification endpoints, and a daily @Cron to expire stale pending payments.
 */
@Module({
  imports:     [PrismaModule, MailModule],
  providers:   [SubscriptionPaymentsService],
  controllers: [SubscriptionPaymentsController],
  exports:     [SubscriptionPaymentsService],
})
export class SubscriptionPaymentsModule {}
