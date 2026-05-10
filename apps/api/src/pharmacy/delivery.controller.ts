/**
 * Sprint 19 — Supplier delivery receiving endpoints.
 *
 * Mounted under /pharmacy/deliveries to keep the namespace tidy with the
 * other compliance endpoints (lots, Rx, DDB register). Pharmacy-flavored
 * for now but not pharmacy-only — any tenant that buys stock from
 * vendors can use these.
 */
import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { DeliveryService, type CreateDeliveryDto } from './delivery.service';

@ApiTags('Pharmacy Deliveries')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pharmacy/deliveries')
export class DeliveryController {
  constructor(private readonly svc: DeliveryService) {}

  private static readonly READ_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER',
    'WAREHOUSE_STAFF', 'MDM',
    'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD',
  ] as const;

  private static readonly WRITE_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER',
    'WAREHOUSE_STAFF', 'MDM',
  ] as const;

  @ApiOperation({ summary: 'List delivery receipts (paginated)' })
  @Roles(...DeliveryController.READ_ROLES)
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('take')     take?:     string,
    @Query('skip')     skip?:     string,
  ) {
    return this.svc.list(user.tenantId!, {
      branchId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @ApiOperation({ summary: 'Get one delivery receipt with lines' })
  @Roles(...DeliveryController.READ_ROLES)
  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getOne(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Post a new delivery receipt — atomically creates lots + inventory' })
  @Roles(...DeliveryController.WRITE_ROLES)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateDeliveryDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }
}
