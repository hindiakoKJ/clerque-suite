import {
  Controller,
  Get,
  Post,
  Patch,
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
import { PreOrderStatus } from '@prisma/client';
import {
  PreOrdersService,
  CreatePreOrderDto,
  UpdatePreOrderDto,
} from './pre-orders.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pre-orders')
export class PreOrdersController {
  constructor(private preOrders: PreOrdersService) {}

  /** GET /pre-orders?branchId=…&from=…&to=…&status=DEPOSIT_PAID,READY */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('from')     fromIso?: string,
    @Query('to')       toIso?: string,
    @Query('status')   statusCsv?: string,
  ) {
    const status = statusCsv
      ? (statusCsv.split(',').map(s => s.trim()).filter(Boolean) as PreOrderStatus[])
      : undefined;
    return this.preOrders.list(user.tenantId!, {
      branchId,
      from:   fromIso ? new Date(fromIso) : undefined,
      to:     toIso   ? new Date(toIso)   : undefined,
      status,
    });
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.preOrders.getOne(user.tenantId!, id);
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreatePreOrderDto) {
    return this.preOrders.create(user.tenantId!, user.sub, body);
  }

  @Roles('SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdatePreOrderDto,
  ) {
    return this.preOrders.update(user.tenantId!, id, body);
  }

  @Roles('SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post(':id/mark-ready')
  @HttpCode(HttpStatus.OK)
  markReady(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.preOrders.markReady(user.tenantId!, id);
  }

  @Roles('SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.preOrders.cancel(user.tenantId!, id, body.reason ?? null);
  }
}
