import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupScheduler } from './backup.scheduler';

@Module({
  imports:   [PrismaModule],
  providers: [BackupScheduler],
  exports:   [BackupScheduler],
})
export class BackupModule {}
