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
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { effectiveBranchId } from '../common/branch-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { OfflineOrder } from '@repo/shared-types';

interface CreateOrderBody {
  order: OfflineOrder;
}

interface VoidOrderBody {
  reason: string;
  /**
   * Required when the caller role is CASHIER.
   * Must be the UUID of a SALES_LEAD or BUSINESS_OWNER in the same tenant.
   * Implements the dual-authorization SOD rule: cashiers cannot self-authorize voids.
   */
  supervisorId?: string;
}

interface BulkSyncBody {
  orders: OfflineOrder[];
}

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  /**
   * List orders for this tenant's branch.
   * Read access: all operational + management roles; External Auditor gets read-only view.
   * Excluded: GENERAL_EMPLOYEE, WAREHOUSE_STAFF, BOOKKEEPER (no business need for order history).
   */
  @Roles(
    'CASHIER', 'SALES_LEAD',
    'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN',
    'MDM', 'FINANCE_LEAD', 'ACCOUNTANT', 'PAYROLL_MASTER',
    'EXTERNAL_AUDITOR',
  )
  @Get()
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('shiftId') shiftId?: string,
  ) {
    try {
      // Branch-scoped roles (CASHIER, SALES_LEAD, BRANCH_MANAGER, etc.) are
      // forced to their own branchId — owners/accountants see whatever they ask for.
      const scoped = effectiveBranchId(user, branchId);
      return await this.ordersService.findAll(user.tenantId!, scoped, shiftId);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if (err instanceof ForbiddenException) throw err;
      throw new InternalServerErrorException('Failed to retrieve orders');
    }
  }

  /**
   * Get a single order by ID.
   * Same read-access set as the list endpoint.
   */
  @Roles(
    'CASHIER', 'SALES_LEAD',
    'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN',
    'MDM', 'FINANCE_LEAD', 'ACCOUNTANT', 'PAYROLL_MASTER',
    'EXTERNAL_AUDITOR',
  )
  @Get(':id')
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    try {
      return await this.ordersService.findOne(user.tenantId!, id);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new InternalServerErrorException('Failed to retrieve order');
    }
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateOrderBody) {
    return this.ordersService.create(user.tenantId!, user.sub, body.order);
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  bulkSync(@CurrentUser() user: JwtPayload, @Body() body: BulkSyncBody) {
    return this.ordersService.bulkSync(user.tenantId!, user.sub, body.orders);
  }

  /**
   * Void an order.
   *
   * SOD Rule — Dual Authorization:
   *   SALES_LEAD / BRANCH_MANAGER / BUSINESS_OWNER → void directly (no co-auth needed).
   *   CASHIER → must provide `supervisorId` (UUID of a SALES_LEAD or OWNER in same tenant).
   *             Backend validates the supervisor's role before proceeding.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: VoidOrderBody,
  ) {
    return this.ordersService.void(
      user.tenantId!, id, user.sub, user.role, body.reason, body.supervisorId,
    );
  }
}
