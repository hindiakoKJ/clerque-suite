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
import type {
  LaundryOrderStatus, LaundryServiceCode, LaundryServiceMode,
  LaundryMachineKind, LaundryMachineStatus, LaundryPromoKind, LaundryAddOnKind,
} from '@prisma/client';

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

  @ApiOperation({ summary: 'List active laundry orders (everything except CLAIMED). Paginated.' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Get('orders')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('take')     take?:     string,
    @Query('skip')     skip?:     string,
  ) {
    return this.svc.listActive(
      user.tenantId!,
      branchId,
      take ? Number(take) : undefined,
      skip ? Number(skip) : undefined,
    );
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

  // ═════════════════════════════════════════════════════════════════════════
  // v2 — Multi-line tickets, machines, service prices, promos
  // ═════════════════════════════════════════════════════════════════════════

  // ── Service prices ─────────────────────────────────────────────────────
  @ApiOperation({ summary: 'List service price matrix' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Get('service-prices')
  listServicePrices(@CurrentUser() user: JwtPayload) {
    return this.svc.listServicePrices(user.tenantId!);
  }

  @ApiOperation({ summary: 'Set/update one row in the service price matrix' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post('service-prices')
  @HttpCode(HttpStatus.OK)
  setServicePrice(
    @CurrentUser() user: JwtPayload,
    @Body() body: { serviceCode: LaundryServiceCode; mode: LaundryServiceMode; unitPrice: number; isActive?: boolean },
  ) {
    return this.svc.setServicePrice(user.tenantId!, body.serviceCode, body.mode, body.unitPrice, body.isActive);
  }

  // ── Machines ───────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'List machines with current state and active line' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Get('machines')
  listMachines(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string) {
    return this.svc.listMachines(user.tenantId!, branchId);
  }

  @ApiOperation({ summary: 'Add a machine (W1, D1, etc.)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post('machines')
  @HttpCode(HttpStatus.CREATED)
  createMachine(
    @CurrentUser() user: JwtPayload,
    @Body() body: { branchId: string; code: string; kind: LaundryMachineKind; capacityKg: number; notes?: string },
  ) {
    return this.svc.createMachine(user.tenantId!, body);
  }

  @ApiOperation({ summary: 'Set machine status (IDLE / RUNNING / OUT_OF_ORDER)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch('machines/:id/status')
  @HttpCode(HttpStatus.OK)
  setMachineStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: LaundryMachineStatus },
  ) {
    return this.svc.updateMachineStatus(user.tenantId!, id, body.status);
  }

  // ── Multi-line ticket ──────────────────────────────────────────────────
  @ApiOperation({ summary: 'Create a v2 ticket — multiple service lines + retail products + auto-promo' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Post('orders/v2')
  @HttpCode(HttpStatus.CREATED)
  createOrderV2(
    @CurrentUser() user: JwtPayload,
    @Body() dto: any,
  ) {
    return this.svc.createOrderV2(user.tenantId!, user.sub, dto);
  }

  // ── Machine assignment per line ────────────────────────────────────────
  @ApiOperation({ summary: 'Assign a machine to a line (starts the run)' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Patch('lines/:lineId/assign')
  @HttpCode(HttpStatus.OK)
  assignMachine(
    @CurrentUser() user: JwtPayload,
    @Param('lineId') lineId: string,
    @Body() body: { machineId: string },
  ) {
    return this.svc.assignMachine(user.tenantId!, lineId, body.machineId);
  }

  @ApiOperation({ summary: 'Mark a running line DONE (frees the machine)' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Patch('lines/:lineId/done')
  @HttpCode(HttpStatus.OK)
  markLineDone(@CurrentUser() user: JwtPayload, @Param('lineId') lineId: string) {
    return this.svc.markLineDone(user.tenantId!, lineId);
  }

  // ── Promos ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'List promos' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Get('promos')
  listPromos(@CurrentUser() user: JwtPayload) {
    return this.svc.listPromos(user.tenantId!);
  }

  @ApiOperation({ summary: 'Create a promo' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post('promos')
  @HttpCode(HttpStatus.CREATED)
  createPromo(
    @CurrentUser() user: JwtPayload,
    @Body() body: { code: string; name: string; kind: LaundryPromoKind; conditions: any; priority?: number; isActive?: boolean; validFrom?: string; validTo?: string },
  ) {
    return this.svc.createPromo(user.tenantId!, body);
  }

  @ApiOperation({ summary: 'Toggle a promo active/inactive' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch('promos/:id/toggle')
  @HttpCode(HttpStatus.OK)
  togglePromo(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.svc.togglePromo(user.tenantId!, id, body.isActive);
  }

  @ApiOperation({ summary: 'Delete a promo' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('promos/:id/delete')
  @HttpCode(HttpStatus.OK)
  deletePromo(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.deletePromo(user.tenantId!, id);
  }

  // ── Service Add-Ons (Sprint 8) ────────────────────────────────────────────

  @ApiOperation({ summary: 'List service add-ons / modifiers' })
  @Roles(...LaundryController.LAUNDRY_OPS)
  @Get('addons')
  listAddOns(
    @CurrentUser() user: JwtPayload,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.svc.listAddOns(user.tenantId!, includeInactive === 'true');
  }

  @ApiOperation({ summary: 'Create a service add-on (BYO detergent, no-fold, express, etc.)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post('addons')
  @HttpCode(HttpStatus.CREATED)
  createAddOn(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      code: string; name: string; kind?: LaundryAddOnKind;
      amount: number; priority?: number; defaultOn?: boolean; isActive?: boolean;
    },
  ) {
    return this.svc.createAddOn(user.tenantId!, body);
  }

  @ApiOperation({ summary: 'Update an add-on' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch('addons/:id')
  @HttpCode(HttpStatus.OK)
  updateAddOn(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Partial<{ name: string; amount: number; priority: number; defaultOn: boolean; isActive: boolean }>,
  ) {
    return this.svc.updateAddOn(user.tenantId!, id, body);
  }

  @ApiOperation({ summary: 'Delete (or soft-deactivate if used) an add-on' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('addons/:id/delete')
  @HttpCode(HttpStatus.OK)
  deleteAddOn(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.deleteAddOn(user.tenantId!, id);
  }
}
