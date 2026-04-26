import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard }   from '../auth/guards/roles.guard';
import { Roles }        from '../auth/decorators/roles.decorator';
import { CurrentUser }  from '../auth/decorators/current-user.decorator';
import { JwtPayload }   from '@repo/shared-types';
import { PayrollService } from './payroll.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class ClockInDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

class ClockOutDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  @Type(() => Number)
  breakMins?: number;
}

// ─── Controller ───────────────────────────────────────────────────────────────

@ApiTags('Payroll')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  // ─── Clock endpoints (all employees with CLOCK_ONLY+ access) ────────────

  /** Returns the current clock-in status for the requesting user */
  @ApiOperation({ summary: 'Get current clock status' })
  @Roles(
    'GENERAL_EMPLOYEE', 'CASHIER', 'WAREHOUSE_STAFF', 'SALES_LEAD',
    'BRANCH_MANAGER', 'BUSINESS_OWNER', 'PAYROLL_MASTER', 'MDM',
    'FINANCE_LEAD', 'BOOKKEEPER', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
  )
  @Get('clock/status')
  getClockStatus(@CurrentUser() user: JwtPayload) {
    return this.payrollService.getClockStatus(user.tenantId!, user.sub);
  }

  /** Clock in — creates a new OPEN TimeEntry */
  @ApiOperation({ summary: 'Clock in' })
  @Roles(
    'GENERAL_EMPLOYEE', 'CASHIER', 'WAREHOUSE_STAFF', 'SALES_LEAD',
    'BRANCH_MANAGER', 'BUSINESS_OWNER', 'PAYROLL_MASTER', 'MDM',
    'FINANCE_LEAD', 'BOOKKEEPER', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
  )
  @Post('clock/in')
  @HttpCode(HttpStatus.CREATED)
  clockIn(@CurrentUser() user: JwtPayload, @Body() body: ClockInDto) {
    return this.payrollService.clockIn(user.tenantId!, user.sub, body.notes);
  }

  /** Clock out — closes the OPEN TimeEntry and computes gross/OT hours */
  @ApiOperation({ summary: 'Clock out' })
  @Roles(
    'GENERAL_EMPLOYEE', 'CASHIER', 'WAREHOUSE_STAFF', 'SALES_LEAD',
    'BRANCH_MANAGER', 'BUSINESS_OWNER', 'PAYROLL_MASTER', 'MDM',
    'FINANCE_LEAD', 'BOOKKEEPER', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
  )
  @Post('clock/out')
  @HttpCode(HttpStatus.OK)
  clockOut(@CurrentUser() user: JwtPayload, @Body() body: ClockOutDto) {
    return this.payrollService.clockOut(user.tenantId!, user.sub, body.breakMins ?? 0);
  }

  // ─── Management endpoints (PAYROLL_MASTER / BUSINESS_OWNER) ─────────────

  /** List all employees for the tenant */
  @ApiOperation({ summary: 'List all employees (HR view)' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'BRANCH_MANAGER', 'MDM')
  @Get('employees')
  getEmployees(@CurrentUser() user: JwtPayload) {
    return this.payrollService.getEmployees(user.tenantId!);
  }

  /** Weekly timesheet aggregated per employee */
  @ApiOperation({ summary: 'Weekly timesheets aggregated per employee' })
  @ApiQuery({ name: 'weekStart', description: 'Monday of the desired week (YYYY-MM-DD)', required: false })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'BRANCH_MANAGER', 'MDM')
  @Get('timesheets')
  getTimesheets(
    @CurrentUser() user: JwtPayload,
    @Query('weekStart') weekStart?: string,
  ) {
    // Default to the current week's Monday
    const ws = weekStart ?? currentMonday();
    return this.payrollService.getTimesheets(user.tenantId!, ws);
  }

  /** Payroll dashboard summary (MTD gross, deductions, department breakdown) */
  @ApiOperation({ summary: 'Payroll dashboard summary' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER')
  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    return this.payrollService.getSummary(user.tenantId!);
  }
}

// ─── Util ─────────────────────────────────────────────────────────────────────

/** Returns the ISO date (YYYY-MM-DD) for the Monday of the current week (UTC). */
function currentMonday(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
  return mon.toISOString().slice(0, 10);
}
