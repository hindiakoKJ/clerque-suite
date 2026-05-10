import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { KioskService } from './kiosk.service';
import { KioskAdminController, KioskPublicController } from './kiosk.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [KioskAdminController, KioskPublicController],
  providers:   [KioskService],
  exports:     [KioskService],
})
export class KioskModule {}
