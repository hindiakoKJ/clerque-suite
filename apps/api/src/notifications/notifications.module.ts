import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsScheduler } from './notifications.scheduler';

@Module({
  imports:     [PrismaModule],
  controllers: [NotificationsController],
  providers:   [NotificationsService, NotificationsScheduler],
  exports:     [NotificationsService],
})
export class NotificationsModule {}
