import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, Max, IsEnum, IsDateString } from 'class-validator';
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

class CreatePayRunDto {
  @IsString() label: string;
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  @IsEnum(['WEEKLY', 'SEMI_MONTHLY', 'MONTHLY']) frequency: 'WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';
  @IsOptional() @IsString() notes?: string;
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

  /** My attendance history — any authenticated employee */
  @ApiOperation({ summary: 'Get my attendance records' })
  @Get('attendance/mine')
  getMyAttendance(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.payrollService.getMyAttendance(user.tenantId!, user.sub, from, to);
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

  // ─── Pay Runs ────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List all pay runs' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Get('runs')
  getPayRuns(@CurrentUser() user: JwtPayload) {
    return this.payrollService.getPayRuns(user.tenantId!);
  }

  @ApiOperation({ summary: 'Create a new pay run (DRAFT)' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Post('runs')
  @HttpCode(HttpStatus.CREATED)
  createPayRun(@CurrentUser() user: JwtPayload, @Body() dto: CreatePayRunDto) {
    return this.payrollService.createPayRun(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'Process a DRAFT pay run (generate payslips)' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Post('runs/:id/process')
  @HttpCode(HttpStatus.OK)
  processPayRun(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.payrollService.processPayRun(id, user.tenantId!, user.sub);
  }

  @ApiOperation({ summary: 'Cancel a pay run' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelPayRun(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.payrollService.cancelPayRun(id, user.tenantId!);
  }

  // ─── Payslips ─────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List payslips (optionally filter by pay run)' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Get('payslips')
  getPayslips(
    @CurrentUser() user: JwtPayload,
    @Query('payRunId') payRunId?: string,
  ) {
    return this.payrollService.getPayslips(user.tenantId!, payRunId);
  }

  @ApiOperation({ summary: 'My own payslips (any employee)' })
  @Roles(
    'GENERAL_EMPLOYEE', 'CASHIER', 'WAREHOUSE_STAFF', 'SALES_LEAD',
    'BRANCH_MANAGER', 'BUSINESS_OWNER', 'PAYROLL_MASTER', 'MDM',
    'FINANCE_LEAD', 'BOOKKEEPER', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
  )
  @Get('payslips/mine')
  getMyPayslips(@CurrentUser() user: JwtPayload) {
    return this.payrollService.getMyPayslips(user.tenantId!, user.sub);
  }

  // ─── Contributions ────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Monthly contribution summary (SSS/PhilHealth/Pag-IBIG/WHT)' })
  @ApiQuery({ name: 'month', description: 'YYYY-MM (defaults to current month)', required: false })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Get('contributions')
  getContributions(
    @CurrentUser() user: JwtPayload,
    @Query('month') month?: string,
  ) {
    return this.payrollService.getContributions(user.tenantId!, month);
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
