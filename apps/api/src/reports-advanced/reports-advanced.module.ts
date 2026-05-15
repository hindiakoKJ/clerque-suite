import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsAdvancedService } from './reports-advanced.service';
import { ReportsAdvancedController } from './reports-advanced.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [ReportsAdvancedController],
  providers:   [ReportsAdvancedService],
  exports:     [ReportsAdvancedService],
})
export class ReportsAdvancedModule {}
