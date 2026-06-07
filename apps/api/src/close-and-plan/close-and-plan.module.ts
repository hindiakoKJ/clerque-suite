import { Module } from '@nestjs/common';
import { CloseAndPlanService } from './close-and-plan.service';
import { CloseAndPlanController } from './close-and-plan.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [CloseAndPlanController],
  providers:   [CloseAndPlanService],
  exports:     [CloseAndPlanService],
})
export class CloseAndPlanModule {}
