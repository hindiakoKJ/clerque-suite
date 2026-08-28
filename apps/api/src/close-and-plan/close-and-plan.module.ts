import { Module } from '@nestjs/common';
import { CloseAndPlanService } from './close-and-plan.service';
import { CloseAndPlanController } from './close-and-plan.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports:     [PrismaModule, InventoryModule],
  controllers: [CloseAndPlanController],
  providers:   [CloseAndPlanService],
  exports:     [CloseAndPlanService],
})
export class CloseAndPlanModule {}
