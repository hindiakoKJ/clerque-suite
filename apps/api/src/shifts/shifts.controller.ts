import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CreateCashOutDto } from './dto/cash-out.dto';
import { Delete } from '@nestjs/common';

@ApiTags('Shifts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  /**
   * Open a new shift (or return the existing active one — idempotent).
   * BUSINESS_OWNER included so Tier 1 (Solo) and Tier 2 (Duo) owners can
   * operate the till themselves — owner-as-cashier is the default workflow
   * for those tiers. BRANCH_MANAGER stays out: they supervise, not operate.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BUSINESS_OWNER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  open(@CurrentUser() user: JwtPayload, @Body() body: OpenShiftDto) {
    return this.shiftsService.open(
      user.tenantId!,
      user.sub,
      body.branchId,
      body.openingCash,
      body.notes,
    );
  }

  /**
   * Get the active (open) shift for a branch.
   * Supervisors can see which shift is running without being the cashier.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('active')
  getActive(@CurrentUser() user: JwtPayload, @Query('branchId') branchId: string) {
    return this.shiftsService.getActive(user.tenantId!, user.sub, branchId);
  }

  /** List recent shifts — management / reporting view */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN', 'FINANCE_LEAD')
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.shiftsService.list(user.tenantId!, branchId, limit ? parseInt(limit) : 20);
  }

  /** Get a specific shift by ID with full summary */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN', 'FINANCE_LEAD')
  @Get(':id')
  getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.shiftsService.getById(user.tenantId!, id);
  }

  /**
   * Record a cash-out (PAID_OUT or CASH_DROP) on an open shift.
   * Paid-outs >₱500 require an approvedById of a manager+ role.
   * Cash drops always require a manager confirmation.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Post(':id/cash-out')
  @HttpCode(HttpStatus.CREATED)
  recordCashOut(
    @CurrentUser() user: JwtPayload,
    @Param('id') shiftId: string,
    @Body() body: CreateCashOutDto,
  ) {
    return this.shiftsService.recordCashOut(user.tenantId!, shiftId, user.sub, body);
  }

  /** List cash-outs on a shift (used by EOD report + live cart-side count). */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN', 'FINANCE_LEAD', 'ACCOUNTANT')
  @Get(':id/cash-outs')
  listCashOuts(@CurrentUser() user: JwtPayload, @Param('id') shiftId: string) {
    return this.shiftsService.listCashOuts(user.tenantId!, shiftId);
  }

  /** Remove a cash-out before close. Recording cashier OR manager+ only. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Delete(':id/cash-outs/:cashOutId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCashOut(
    @CurrentUser() user: JwtPayload,
    @Param('id') shiftId: string,
    @Param('cashOutId') cashOutId: string,
  ) {
    await this.shiftsService.deleteCashOut(user.tenantId!, shiftId, cashOutId, user.sub, user.role);
  }

  /**
   * Close the active shift. BUSINESS_OWNER can close their own shift
   * (owner-as-cashier on Tier 1/2). The service still enforces that the
   * caller is the user who opened the shift.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BUSINESS_OWNER')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: CloseShiftDto,
  ) {
    return this.shiftsService.close(
      user.tenantId!,
      id,
      user.sub,
      body.closingCashDeclared,
      body.notes,
    );
  }
}
