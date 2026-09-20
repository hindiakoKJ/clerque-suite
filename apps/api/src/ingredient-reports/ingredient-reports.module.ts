import { Module } from '@nestjs/common';
import { IngredientReportsController } from './ingredient-reports.controller';
import { IngredientReportsService } from './ingredient-reports.service';
import { EndOfDayScheduler } from './end-of-day.scheduler';
import { DailySheetController, StationSheetController } from './station-sheet.controller';
import { StationWasteController } from './station-waste.controller';
import { DisplayPairingModule } from '../display-pairing/display-pairing.module';
import { ProcureModule } from '../procure/procure.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReportsModule } from '../reports/reports.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';

/*
  The end-of-day scheduler needs no extra imports: Prisma and Telegram are
  global modules, and it writes its bell notifications itself, inside the lock
  that stops a day going out twice (see end-of-day.scheduler.ts).

  The daily inventory sheet on a kitchen or bar screen accepts a paired
  tablet's device token as well as a login, so this module carries the same
  guard wiring as KdsModule: the pairing module, and both guards the hybrid
  guard is built from.

  ProcureModule gives the scheduler the closing-time buy list: a branch whose
  kitchen and bar never tapped "Request what's running low" still gets its list
  sent at the moment its day closes. No cycle -- nothing ProcureModule imports
  reaches back here.

  The scheduler is exported for ShiftsModule: closing the last shift of the day
  closes the day's sheet there and then (EndOfDayScheduler.closeDayAtLastShift).
  Still no cycle -- nothing this module imports reaches ShiftsModule.

  InventoryModule gives "Thrown out" on the station sheet the same write-off
  Procure > Stock uses (station-waste.controller.ts). No cycle -- it imports
  only the period lock and the audit log.

  ReportsModule gives the scheduler the day's Z-Read: a day closed on the
  fallback clock -- a shop that shut early, or one with no closing time set --
  is still written its BIR daily record, which until now only a last shift
  close near closing time wrote. ReportsModule imports nothing but Prisma, so
  there is no cycle.
*/
@Module({
  imports:     [DisplayPairingModule, ProcureModule, InventoryModule, ReportsModule],
  controllers: [IngredientReportsController, StationSheetController, DailySheetController, StationWasteController],
  providers:   [IngredientReportsService, EndOfDayScheduler, JwtAuthGuard, JwtOrDeviceTokenAuthGuard],
  // The end-of-day message reads a day's usage from here; the shift close closes the day through the scheduler.
  exports:     [IngredientReportsService, EndOfDayScheduler],
})
export class IngredientReportsModule {}
