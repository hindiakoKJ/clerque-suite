import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerMetricsController } from './ledger-metrics.controller';
import { LedgerMetricsService } from './ledger-metrics.service';

@Module({
  imports:     [PrismaModule],
  controllers: [LedgerMetricsController],
  providers:   [LedgerMetricsService],
  exports:     [LedgerMetricsService],
})
export class LedgerMetricsModule {}
