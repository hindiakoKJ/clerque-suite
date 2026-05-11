import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupScheduler } from './backup.scheduler';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [BackupController],
  providers:   [BackupScheduler, BackupService],
  exports:     [BackupScheduler, BackupService],
})
export class BackupModule {}
