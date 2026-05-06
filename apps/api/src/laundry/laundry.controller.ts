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
import { LaundryService, CreateLaundryOrderDto } from './laundry.service';
import type { LaundryOrderStatus } from '@prisma/client';

@ApiTags('Laundry')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('laundry')
export class LaundryController {
  constructor(private readonly svc: LaundryService) {}

  // Roles allowed to USE the laundry workflow (intake / advance / claim).
  // BUSINESS_OWNER + BRANCH_MANAGER + SALES_LEAD + CASHIER + GENERAL_EMPLOYEE
  // is the realistic crew of a small laundromat.
  private static readonly LAUNDRY_OPS = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER',
    'SALES_LEAD', 'CASHIER', 'GENERAL_EMPLOYEE', 'MDM',
  ] as const;

  @ApiOperation({ summary: 'List active laundry orders (everything except CLAIMED)' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Get('orders')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.listActive(user.tenantId!, branchId);
  }

  @ApiOperation({ summary: 'Get a single laundry order' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Get('orders/:id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getOne(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Create a new laundry order (intake)' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateLaundryOrderDto,
  ) {
    return this.svc.createOrder(user.tenantId!, user.sub, dto);
  }

  @ApiOperation({ summary: 'Advance the workflow status (RECEIVED→WASHING→…→READY)' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Patch('orders/:id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: LaundryOrderStatus },
  ) {
    return this.svc.updateStatus(user.tenantId!, id, body.status);
  }

  @ApiOperation({ summary: 'Claim — link to POS Order and mark CLAIMED' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Post('orders/:id/claim')
  @HttpCode(HttpStatus.OK)
  claim(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { orderId: string },
  ) {
    return this.svc.claim(user.tenantId!, id, user.sub, body.orderId);
  }
}
