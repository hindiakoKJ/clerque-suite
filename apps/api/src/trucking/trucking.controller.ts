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
import type { TripStatus } from '@prisma/client';
import {
  TruckingService,
  CreateFleetAssetDto,
  CreatePmScheduleDto,
  CreateTripDto,
  AddLiquidationItemDto,
} from './trucking.service';

/**
 * Logistics-Engine endpoints. Roles tuned for a small Philippine trucking
 * outfit: dispatcher (BRANCH_MANAGER), drivers via mobile (CASHIER for now —
 * future driver-only role), and the owner-operator (BUSINESS_OWNER).
 */
@ApiTags('Trucking')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('trucking')
export class TruckingController {
  constructor(private readonly svc: TruckingService) {}

  private static readonly DISPATCH_OPS = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD',
  ] as const;
  private static readonly TRIP_OPS = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD',
    'CASHIER', 'GENERAL_EMPLOYEE',
  ] as const;

  // ─── Fleet ────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Create a fleet asset (truck/trailer/van)' })
  @Roles(...TruckingController.DISPATCH_OPS)
  @Post('assets')
  @HttpCode(HttpStatus.CREATED)
  createAsset(@CurrentUser() user: JwtPayload, @Body() dto: CreateFleetAssetDto) {
    return this.svc.createAsset(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'List fleet assets' })
  @Roles(...TruckingController.TRIP_OPS)
  @Get('assets')
  listAssets(
    @CurrentUser() user: JwtPayload,
    @Query('branchId')   branchId?:   string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.svc.listAssets(user.tenantId!, {
      branchId, activeOnly: activeOnly === 'true',
    });
  }

  @ApiOperation({ summary: 'Get a single asset with PM schedules + tire serials' })
  @Roles(...TruckingController.TRIP_OPS)
  @Get('assets/:id')
  getAsset(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getAsset(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Update fleet asset (mileage, primary driver, etc.)' })
  @Roles(...TruckingController.DISPATCH_OPS)
  @Patch('assets/:id')
  updateAsset(
    @CurrentUser() user: JwtPayload,
    @Param('id')   id:   string,
    @Body() dto: Partial<CreateFleetAssetDto> & { isActive?: boolean },
  ) {
    return this.svc.updateAsset(user.tenantId!, id, dto);
  }

  // ─── PM ───────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Create a preventive-maintenance schedule for an asset' })
  @Roles(...TruckingController.DISPATCH_OPS)
  @Post('pm-schedules')
  @HttpCode(HttpStatus.CREATED)
  createPm(@CurrentUser() user: JwtPayload, @Body() dto: CreatePmScheduleDto) {
    return this.svc.createPmSchedule(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'PM schedules due within N days (default 14)' })
  @Roles(...TruckingController.TRIP_OPS)
  @Get('pm-schedules/due')
  pmDue(
    @CurrentUser() user: JwtPayload,
    @Query('withinDays') withinDays?: string,
  ) {
    return this.svc.listDuePm(user.tenantId!, withinDays ? Number(withinDays) : 14);
  }

  // ─── Trips ────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Create a trip ticket (DRAFT)' })
  @Roles(...TruckingController.DISPATCH_OPS)
  @Post('trips')
  @HttpCode(HttpStatus.CREATED)
  createTrip(@CurrentUser() user: JwtPayload, @Body() dto: CreateTripDto) {
    return this.svc.createTrip(user.tenantId!, user.sub, dto);
  }

  @ApiOperation({ summary: 'List trips (filter by status / branch / driver / date range)' })
  @Roles(...TruckingController.TRIP_OPS)
  @Get('trips')
  listTrips(
    @CurrentUser() user: JwtPayload,
    @Query('status')   status?:   TripStatus,
    @Query('branchId') branchId?: string,
    @Query('driverId') driverId?: string,
    @Query('from')     from?:     string,
    @Query('to')       to?:       string,
    @Query('take')     take?:     string,
    @Query('skip')     skip?:     string,
  ) {
    return this.svc.listTrips(user.tenantId!, {
      status, branchId, driverId, from, to,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @ApiOperation({ summary: 'Get one trip with liquidation items' })
  @Roles(...TruckingController.TRIP_OPS)
  @Get('trips/:id')
  getTrip(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getTrip(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Advance trip status (DRAFT→DISPATCHED→…→LIQUIDATED)' })
  @Roles(...TruckingController.DISPATCH_OPS)
  @Patch('trips/:id/status')
  setTripStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id')   id:   string,
    @Body() body: { status: TripStatus },
  ) {
    return this.svc.setTripStatus(user.tenantId!, id, body.status, user.sub);
  }

  @ApiOperation({ summary: 'Add a liquidation receipt (fuel/toll/meals) against a trip' })
  @Roles(...TruckingController.TRIP_OPS)
  @Post('trips/:id/liquidation')
  @HttpCode(HttpStatus.CREATED)
  addLiquidation(
    @CurrentUser() user: JwtPayload,
    @Param('id')   id:   string,
    @Body() dto: AddLiquidationItemDto,
  ) {
    return this.svc.addLiquidationItem(user.tenantId!, id, dto);
  }
}
