import {
  Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard }   from '../auth/guards/roles.guard';
import { Roles }        from '../auth/decorators/roles.decorator';
import { CurrentUser }  from '../auth/decorators/current-user.decorator';
import { JwtPayload }   from '@repo/shared-types';
import { RentalStatus, SerializedUnitStatus } from '@prisma/client';
import {
  RentalsService,
  CreateSerializedUnitDto,
  OpenRentalDto,
  ReturnRentalDto,
} from './rentals.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class RentalsController {
  constructor(private readonly rentals: RentalsService) {}

  // ── Serialized units ──────────────────────────────────────────────────────

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('serialized-units')
  listUnits(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('status')   status?:   SerializedUnitStatus,
  ) {
    return this.rentals.listUnits(user.tenantId!, { branchId, status });
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('serialized-units')
  createUnit(@CurrentUser() user: JwtPayload, @Body() body: CreateSerializedUnitDto) {
    return this.rentals.createUnit(user.tenantId!, body);
  }

  // ── Rental agreements ─────────────────────────────────────────────────────

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('rentals')
  listRentals(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('status')   statusCsv?: string,
  ) {
    const status = statusCsv
      ? (statusCsv.split(',').map((s) => s.trim()).filter(Boolean) as RentalStatus[])
      : undefined;
    return this.rentals.listRentals(user.tenantId!, { branchId, status });
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('rentals')
  openRental(@CurrentUser() user: JwtPayload, @Body() body: OpenRentalDto) {
    return this.rentals.openRental(user.tenantId!, user.sub, body);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('rentals/:id/return')
  @HttpCode(HttpStatus.OK)
  returnRental(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ReturnRentalDto,
  ) {
    return this.rentals.returnRental(user.tenantId!, id, body);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('rentals/:id/mark-lost')
  @HttpCode(HttpStatus.OK)
  markLost(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.rentals.markLost(user.tenantId!, id);
  }
}
