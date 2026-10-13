import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { TelegramClient } from './telegram.client';
import { TelegramLinksService } from './telegram-links.service';
import { TelegramAlertsService } from './telegram-alerts.service';
import { TelegramController } from './telegram.controller';
import { CloseSummaryScheduler } from './close-summary.scheduler';

/**
 * Telegram alerts for a shop's owners and managers. Global so a sale or a
 * purchase can raise an alert without every module importing this one; the
 * services that use it take it as optional, so their specs are unchanged.
 * Off unless TELEGRAM_BOT_TOKEN is set.
 */
@Global()
@Module({
  imports:     [NotificationsModule, AuditModule],
  controllers: [TelegramController],
  // CloseSummaryScheduler: the day's close, sent at 21:30 Manila.
  providers:   [TelegramClient, TelegramLinksService, TelegramAlertsService, CloseSummaryScheduler],
  exports:     [TelegramAlertsService],
})
export class TelegramModule {}
