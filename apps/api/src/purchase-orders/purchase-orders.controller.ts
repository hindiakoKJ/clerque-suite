import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import {
  PurchaseOrdersService,
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  ReceiveLine,
} from './purchase-orders.service';

@ApiTags('Purchase Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly svc: PurchaseOrdersService) {}

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'WAREHOUSE_STAFF')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePurchaseOrderDto) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.create(user.tenantId, user.sub, dto);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'WAREHOUSE_STAFF', 'ACCOUNTANT')
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    const parsed = status && (Object.values(PurchaseOrderStatus) as string[]).includes(status)
      ? (status as PurchaseOrderStatus)
      : undefined;
    return this.svc.list(user.tenantId, parsed);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'WAREHOUSE_STAFF', 'ACCOUNTANT')
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.get(user.tenantId, id);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.update(user.tenantId, id, dto);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Post(':id/submit')
  submit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.submit(user.tenantId, id);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'WAREHOUSE_STAFF')
  @Post(':id/receive')
  receive(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { lines: ReceiveLine[] },
  ) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.receive(user.tenantId, id, body?.lines ?? []);
  }
}
