import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import type { JobOrderStatus } from '@prisma/client';
import {
  JobOrdersService,
  CreateJobOrderDto,
  AddJobOrderLineDto,
} from './job-orders.service';

/**
 * Service-Engine — Job Order endpoints.
 *
 * Role layout for a small service shop:
 *  - BUSINESS_OWNER / BRANCH_MANAGER  — own all job orders, full mutate
 *  - SALES_LEAD / CASHIER             — intake (DRAFT) + claim handoff
 *  - GENERAL_EMPLOYEE                 — technician (read + line edits on
 *                                        their assigned jobs)
 */
@ApiTags('Job Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('job-orders')
export class JobOrdersController {
  constructor(private readonly svc: JobOrdersService) {}

  private static readonly READ_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD',
    'CASHIER', 'GENERAL_EMPLOYEE', 'AR_ACCOUNTANT', 'BOOKKEEPER',
  ] as const;
  private static readonly WRITE_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD', 'CASHIER',
  ] as const;
  private static readonly LINE_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD',
    'CASHIER', 'GENERAL_EMPLOYEE',
  ] as const;

  @ApiOperation({ summary: 'Create a job order (intake)' })
  @Roles(...JobOrdersController.WRITE_ROLES)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateJobOrderDto) {
    return this.svc.createJobOrder(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'List job orders (filter by status / branch / technician / customer / search)' })
  @Roles(...JobOrdersController.READ_ROLES)
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status')       status?:       JobOrderStatus,
    @Query('branchId')     branchId?:     string,
    @Query('assignedToId') assignedToId?: string,
    @Query('customerId')   customerId?:   string,
    @Query('search')       search?:       string,
    @Query('take')         take?:         string,
    @Query('skip')         skip?:         string,
  ) {
    return this.svc.listJobOrders(user.tenantId!, {
      status, branchId, assignedToId, customerId, search,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @ApiOperation({ summary: 'Get one job order with lines' })
  @Roles(...JobOrdersController.READ_ROLES)
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getJobOrder(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Advance job order status' })
  @Roles(...JobOrdersController.WRITE_ROLES)
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id')   id:   string,
    @Body() body: { status: JobOrderStatus },
  ) {
    return this.svc.setStatus(user.tenantId!, id, body.status);
  }

  @ApiOperation({ summary: 'Link an Order (invoice) to this job order' })
  @Roles(...JobOrdersController.WRITE_ROLES)
  @Patch(':id/link-order')
  link(
    @CurrentUser() user: JwtPayload,
    @Param('id')   id:   string,
    @Body() body: { orderId: string },
  ) {
    return this.svc.linkOrder(user.tenantId!, id, body.orderId);
  }

  @ApiOperation({ summary: 'Add a labor / part / consumable / sublet line' })
  @Roles(...JobOrdersController.LINE_ROLES)
  @Post(':id/lines')
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @CurrentUser() user: JwtPayload,
    @Param('id')   id:   string,
    @Body() dto: AddJobOrderLineDto,
  ) {
    return this.svc.addLine(user.tenantId!, id, dto);
  }

  @ApiOperation({ summary: 'Delete a line' })
  @Roles(...JobOrdersController.WRITE_ROLES)
  @Delete(':id/lines/:lineId')
  @HttpCode(HttpStatus.OK)
  deleteLine(
    @CurrentUser() user: JwtPayload,
    @Param('id')     id:     string,
    @Param('lineId') lineId: string,
  ) {
    return this.svc.deleteLine(user.tenantId!, id, lineId);
  }
}
