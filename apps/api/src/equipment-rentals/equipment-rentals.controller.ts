import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
  HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { EquipmentRentalsService } from './equipment-rentals.service';

/**
 * Counter equipment rentals for the courts vertical — paddles / shoes / balls.
 * A POS surface: staff who can operate the till manage the catalog and the
 * rent-out / return flow. Ledger postings happen server-side.
 */
@ApiTags('Equipment Rentals')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard)
@RequireApp('POS', 'OPERATOR')
@Controller('equipment-rentals')
export class EquipmentRentalsController {
  constructor(private readonly svc: EquipmentRentalsService) {}

  // ── Catalog ──────────────────────────────────────────────────────────────
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM')
  @Post('items')
  createItem(@CurrentUser() user: JwtPayload, @Body() dto: {
    name: string; category?: string; assetTag?: string;
    rentFeeCentavos?: number; depositCentavos?: number; branchId?: string;
  }) {
    return this.svc.createItem(user.tenantId!, dto);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM', 'CASHIER', 'SALES_LEAD')
  @Get('items')
  listItems(@CurrentUser() user: JwtPayload, @Query('status') status?: string, @Query('includeInactive') incl?: string) {
    return this.svc.listItems(user.tenantId!, { status, includeInactive: incl === 'true' });
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM')
  @Patch('items/:id')
  updateItem(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: {
    name?: string; category?: string; assetTag?: string;
    rentFeeCentavos?: number; depositCentavos?: number; isActive?: boolean;
  }) {
    return this.svc.updateItem(user.tenantId!, id, dto);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM', 'CASHIER', 'SALES_LEAD')
  @Get('items/:id/holders')
  whoHas(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.whoHasItem(user.tenantId!, id);
  }

  // ── Rent out / return ──────────────────────────────────────────────────────
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  rentOut(@CurrentUser() user: JwtPayload, @Body() dto: {
    customerName: string; customerMobile?: string; customerId?: string;
    itemIds: string[]; tenderMethod?: 'CASH' | 'GCASH_BUSINESS' | 'MAYA_BUSINESS' | 'QR_PH';
    dueAt?: string; notes?: string;
  }) {
    return this.svc.rentOut(user.tenantId!, user.sub || null, dto);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD')
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.svc.listRentals(user.tenantId!, { status });
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD')
  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  returnRental(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: {
    lineIds?: string[]; condition: 'good' | 'loss'; tenderMethod?: 'CASH' | 'GCASH_BUSINESS' | 'MAYA_BUSINESS' | 'QR_PH';
  }) {
    if (dto.condition !== 'good' && dto.condition !== 'loss') {
      throw new BadRequestException('condition must be "good" or "loss".');
    }
    return this.svc.returnRental(user.tenantId!, id, dto);
  }
}
