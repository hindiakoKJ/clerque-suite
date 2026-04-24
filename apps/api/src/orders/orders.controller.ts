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
import { OrdersService } from './orders.service';
import { OfflineOrder } from '@repo/shared-types';

interface CreateOrderBody {
  order: OfflineOrder;
}

interface VoidOrderBody {
  reason: string;
}

interface BulkSyncBody {
  orders: OfflineOrder[];
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('shiftId') shiftId?: string,
  ) {
    return this.ordersService.findAll(user.tenantId!, branchId, shiftId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ordersService.findOne(user.tenantId!, id);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateOrderBody) {
    return this.ordersService.create(user.tenantId!, user.sub, body.order);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  bulkSync(@CurrentUser() user: JwtPayload, @Body() body: BulkSyncBody) {
    return this.ordersService.bulkSync(user.tenantId!, user.sub, body.orders);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: VoidOrderBody,
  ) {
    return this.ordersService.void(user.tenantId!, id, user.sub, body.reason);
  }
}
