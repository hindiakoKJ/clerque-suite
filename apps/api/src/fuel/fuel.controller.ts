import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard }   from '../auth/guards/roles.guard';
import { Roles }        from '../auth/decorators/roles.decorator';
import { CurrentUser }  from '../auth/decorators/current-user.decorator';
import { JwtPayload }   from '@repo/shared-types';
import { FuelDispenseStatus } from '@prisma/client';
import {
  FuelService,
  CreatePumpDto, UpdatePumpDto,
  StartDispenseDto, EndDispenseDto,
  RecordTankDipDto,
} from './fuel.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fuel')
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  // ── Pumps ────────────────────────────────────────────────────────────────

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('pumps')
  listPumps(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string) {
    return this.fuel.listPumps(user.tenantId!, branchId);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('pumps')
  createPump(@CurrentUser() user: JwtPayload, @Body() body: CreatePumpDto) {
    return this.fuel.createPump(user.tenantId!, body);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Patch('pumps/:id')
  updatePump(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: UpdatePumpDto) {
    return this.fuel.updatePump(user.tenantId!, id, body);
  }

  // ── Dispenses (cashier till) ─────────────────────────────────────────────

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('dispenses/start')
  startDispense(@CurrentUser() user: JwtPayload, @Body() body: StartDispenseDto) {
    return this.fuel.startDispense(user.tenantId!, user.sub, body);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('dispenses/:id/end')
  @HttpCode(HttpStatus.OK)
  endDispense(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: EndDispenseDto) {
    return this.fuel.endDispense(user.tenantId!, id, body);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('dispenses/:id/void')
  @HttpCode(HttpStatus.OK)
  voidDispense(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.fuel.voidDispense(user.tenantId!, id, body.reason);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('dispenses/:id/attach-order')
  @HttpCode(HttpStatus.OK)
  attachOrder(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { orderId: string },
  ) {
    return this.fuel.attachOrder(user.tenantId!, id, body.orderId);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('dispenses')
  listDispenses(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('from')     fromIso?: string,
    @Query('to')       toIso?:   string,
    @Query('status')   status?:  FuelDispenseStatus,
  ) {
    return this.fuel.listDispenses(user.tenantId!, {
      branchId,
      from:   fromIso ? new Date(fromIso) : undefined,
      to:     toIso   ? new Date(toIso)   : undefined,
      status,
    });
  }

  // ── Tank dips ────────────────────────────────────────────────────────────

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('tank-dips')
  recordDip(@CurrentUser() user: JwtPayload, @Body() body: RecordTankDipDto) {
    return this.fuel.recordTankDip(user.tenantId!, user.sub, body);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('tank-dips')
  listDips(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('from')     fromIso?: string,
    @Query('to')       toIso?:   string,
  ) {
    return this.fuel.listTankDips(user.tenantId!, {
      branchId,
      from: fromIso ? new Date(fromIso) : undefined,
      to:   toIso   ? new Date(toIso)   : undefined,
    });
  }
}
