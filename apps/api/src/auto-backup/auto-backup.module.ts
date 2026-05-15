import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AutoBackupService } from './auto-backup.service';
import { AutoBackupController } from './auto-backup.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [AutoBackupController],
  providers:   [AutoBackupService],
  exports:     [AutoBackupService],
})
export class AutoBackupModule {}
