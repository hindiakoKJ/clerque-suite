import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { AuditModule } from '../audit/audit.module';
import { ReportsModule } from '../reports/reports.module';
import { IngredientReportsModule } from '../ingredient-reports/ingredient-reports.module';

@Module({
  // Audit: handover drawer counts are written to the immutable audit log,
  // where the Who column and the no-update/no-delete triggers already live.
  /*
    Reports: closing the LAST open shift at a branch is the end of the
    business day, and that is when the Z-Read is written. ReportsModule
    depends only on Prisma, so there is no cycle back to shifts.
  */
  /*
    Ingredient reports: the same last shift close also closes the day's
    inventory sheet (the closing stock, the usage message and the closing buy
    list). Nothing IngredientReportsModule imports reaches back to shifts, so
    there is no cycle and no forwardRef.
  */
  imports: [AuditModule, ReportsModule, IngredientReportsModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
