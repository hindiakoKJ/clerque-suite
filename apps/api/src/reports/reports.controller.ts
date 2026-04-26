import { Controller, Get, Post, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /**
   * Daily sales summary — powers the POS Dashboard page.
   * date defaults to today in PH time (YYYY-MM-DD).
   *
   * Roles mirror the frontend DASHBOARD_ROLES constant exactly:
   *   BUSINESS_OWNER / SUPER_ADMIN / BRANCH_MANAGER — management
   *   SALES_LEAD — floor supervisor, needs live daily overview
   *   FINANCE_LEAD — cash-flow oversight
   * CASHIER is intentionally excluded (cashier accountability
   * is handled through the shift EOD report, not the full daily summary).
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD', 'FINANCE_LEAD')
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

  /**
   * Shift-scoped EOD report — shown after closing a shift.
   * SALES_LEAD added: they open and close shifts so must be able to view
   * the EOD summary of the shift they just closed.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('shift/:shiftId')
  getShift(
    @CurrentUser() user: JwtPayload,
    @Param('shiftId') shiftId: string,
  ) {
    return this.reportsService.getShiftReport(user.tenantId!, shiftId);
  }

  // ─── Z-Read endpoints (BIR CAS daily tamper-proof totals) ─────────────────

  /**
   * Generate (or retrieve) the Z-Read for a specific day.
   * POST is idempotent — calling multiple times for the same date returns the existing record.
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'FINANCE_LEAD', 'ACCOUNTANT')
  @Post('z-read')
  @HttpCode(HttpStatus.OK)
  generateZRead(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('date') date?: string,
  ) {
    return this.reportsService.generateZRead(
      user.tenantId!,
      branchId ?? user.branchId!,
      date ?? this.todayPH(),
      user.sub,
    );
  }

  /** List Z-Read records for the tenant (most recent first). */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'FINANCE_LEAD', 'ACCOUNTANT', 'BOOKKEEPER')
  @Get('z-read')
  listZReads(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.listZReadLogs(
      user.tenantId!,
      branchId,
      limit ? parseInt(limit) : 30,
    );
  }

  /**
   * Generate (or retrieve) the X-Read for a closed shift.
   * POST is idempotent — duplicate calls return the existing record.
   */
  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'ACCOUNTANT')
  @Post('x-read/:shiftId')
  @HttpCode(HttpStatus.OK)
  generateXRead(
    @CurrentUser() user: JwtPayload,
    @Param('shiftId') shiftId: string,
  ) {
    return this.reportsService.generateXRead(user.tenantId!, shiftId, user.sub);
  }

  private todayPH(): string {
    const now = new Date();
    // Offset to UTC+8
    const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return ph.toISOString().slice(0, 10);
  }
}
