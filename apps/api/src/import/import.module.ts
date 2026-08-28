import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';

@Module({
  imports: [
    PrismaModule,
    AccountingPeriodsModule,
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
