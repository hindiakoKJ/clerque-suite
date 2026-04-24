import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /**
   * Daily sales summary.
   * date defaults to today in PH time (YYYY-MM-DD).
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('daily')
  getDaily(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('date') date?: string,
  ) {
    const effectiveBranch = branchId ?? user.branchId!;
    const effectiveDate = date ?? this.todayPH();
    return this.reportsService.getDaily(user.tenantId!, effectiveBranch, effectiveDate);
  }

  /** Shift-scoped EOD report. */
  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('shift/:shiftId')
  getShift(
    @CurrentUser() user: JwtPayload,
    @Param('shiftId') shiftId: string,
  ) {
    return this.reportsService.getShiftReport(user.tenantId!, shiftId);
  }

  private todayPH(): string {
    const now = new Date();
    // Offset to UTC+8
    const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return ph.toISOString().slice(0, 10);
  }
}
