import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';

@Module({
  // Periods: posting a count writes to the books, so it must respect the
  // same period lock as every other stock movement.
  imports:     [PrismaModule, AccountingPeriodsModule],
  controllers: [WarehouseController],
  providers:   [WarehouseService],
  exports:     [WarehouseService],
})
export class WarehouseModule {}
