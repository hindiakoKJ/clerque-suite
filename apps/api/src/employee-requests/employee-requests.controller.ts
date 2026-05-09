import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import type { EmployeeRequestKind, EmployeeRequestStatus } from '@prisma/client';
import {
  EmployeeRequestsService,
  CreateEmployeeRequestDto,
} from './employee-requests.service';

/**
 * Sync (Payroll) — Employee self-service requests (Sprint 18).
 *
 *   /employee-requests/me/...   — employee self-serve
 *   /employee-requests          — manager / owner inbox
 */
@ApiTags('Employee Requests')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employee-requests')
export class EmployeeRequestsController {
  constructor(private readonly svc: EmployeeRequestsService) {}

  // Owner / payroll / branch manager are the approvers in a small PH biz.
  private static readonly APPROVER_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'PAYROLL_MASTER',
  ] as const;

  // Anyone with an account can submit a request for themselves.
  private static readonly ALL_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'PAYROLL_MASTER',
    'CASHIER', 'GENERAL_EMPLOYEE', 'SALES_LEAD', 'WAREHOUSE_STAFF',
    'BOOKKEEPER', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT', 'FINANCE_LEAD',
    'MDM', 'ACCOUNTANT',
  ] as const;

  // ─── Self-service ────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Submit a request (COA / Schedule / OB / OT / UT)' })
  @Roles(...EmployeeRequestsController.ALL_ROLES)
  @Post('me')
  @HttpCode(HttpStatus.CREATED)
  submit(@CurrentUser() user: JwtPayload, @Body() dto: CreateEmployeeRequestDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  @ApiOperation({ summary: 'List my own requests' })
  @Roles(...EmployeeRequestsController.ALL_ROLES)
  @Get('me')
  listMine(
    @CurrentUser() user: JwtPayload,
    @Query('kind')   kind?:   EmployeeRequestKind,
    @Query('status') status?: EmployeeRequestStatus,
  ) {
    return this.svc.listMine(user.tenantId!, user.sub, { kind, status });
  }

  @ApiOperation({ summary: 'Cancel one of my own pending requests' })
  @Roles(...EmployeeRequestsController.ALL_ROLES)
  @Patch('me/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.cancel(user.tenantId!, id, user.sub);
  }

  // ─── Approver inbox ──────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List requests across the tenant (manager view)' })
  @Roles(...EmployeeRequestsController.APPROVER_ROLES)
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('kind')   kind?:   EmployeeRequestKind,
    @Query('status') status?: EmployeeRequestStatus,
    @Query('userId') userId?: string,
    @Query('take')   take?:   string,
    @Query('skip')   skip?:   string,
  ) {
    return this.svc.list(user.tenantId!, {
      kind, status, userId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @ApiOperation({ summary: 'Get a single request' })
  @Roles(...EmployeeRequestsController.ALL_ROLES)
  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const isManager = (EmployeeRequestsController.APPROVER_ROLES as readonly string[])
      .includes(user.role as string);
    return this.svc.getOne(user.tenantId!, id, user.sub, isManager);
  }

  @ApiOperation({ summary: 'Approve a pending request' })
  @Roles(...EmployeeRequestsController.APPROVER_ROLES)
  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.approve(user.tenantId!, id, user.sub);
  }

  @ApiOperation({ summary: 'Reject a pending request' })
  @Roles(...EmployeeRequestsController.APPROVER_ROLES)
  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id')   id:   string,
    @Body() body: { rejectionReason: string },
  ) {
    return this.svc.reject(user.tenantId!, id, user.sub, body.rejectionReason);
  }
}
