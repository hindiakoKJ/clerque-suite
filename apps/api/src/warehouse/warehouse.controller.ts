import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard }   from '../auth/guards/roles.guard';
import { Roles }        from '../auth/decorators/roles.decorator';
import { CurrentUser }  from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import type { StockTransferStatus, CycleCountStatus } from '@prisma/client';
import { WarehouseService, CreateTransferDto } from './warehouse.service';

@ApiTags('Warehouse')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly svc: WarehouseService) {}

  // Roles allowed to operate the warehouse module. WAREHOUSE_STAFF is the
  // primary persona; managers + owners get full visibility.
  private static readonly WAREHOUSE_OPS = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER',
    'WAREHOUSE_STAFF', 'MDM',
  ] as const;

  // ── Stock Transfers ────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List stock transfers (optional status filter)' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Get('transfers')
  listTransfers(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: StockTransferStatus,
  ) {
    return this.svc.listTransfers(user.tenantId!, status);
  }

  @ApiOperation({ summary: 'Get one stock transfer with lines' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Get('transfers/:id')
  getTransfer(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getTransfer(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Create a DRAFT stock transfer' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Post('transfers')
  @HttpCode(HttpStatus.CREATED)
  createTransfer(@CurrentUser() user: JwtPayload, @Body() dto: CreateTransferDto) {
    return this.svc.createTransfer(user.tenantId!, user.sub, dto);
  }

  @ApiOperation({ summary: 'Send a DRAFT transfer (deducts source inventory)' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Post('transfers/:id/send')
  @HttpCode(HttpStatus.OK)
  sendTransfer(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.sendTransfer(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Receive an IN_TRANSIT transfer (books destination inventory)' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Post('transfers/:id/receive')
  @HttpCode(HttpStatus.OK)
  receiveTransfer(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.receiveTransfer(user.tenantId!, id, user.sub);
  }

  @ApiOperation({ summary: 'Cancel a transfer (refunds source if in-transit)' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Post('transfers/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelTransfer(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.cancelTransfer(user.tenantId!, id);
  }

  // ── Cycle Counts ───────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List cycle counts (optional status filter)' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Get('cycle-counts')
  listCycleCounts(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: CycleCountStatus,
  ) {
    return this.svc.listCycleCounts(user.tenantId!, status);
  }

  @ApiOperation({ summary: 'Get one cycle count with lines' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Get('cycle-counts/:id')
  getCycleCount(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getCycleCount(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Start a cycle count for a branch (snapshots current qty)' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Post('cycle-counts')
  @HttpCode(HttpStatus.CREATED)
  startCycleCount(
    @CurrentUser() user: JwtPayload,
    @Body() body: { branchId: string; notes?: string },
  ) {
    return this.svc.startCycleCount(user.tenantId!, body.branchId, user.sub, body.notes);
  }

  @ApiOperation({ summary: 'Update the counted qty for a single line' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Patch('cycle-counts/lines/:lineId')
  @HttpCode(HttpStatus.OK)
  setLineCount(
    @CurrentUser() user: JwtPayload,
    @Param('lineId') lineId: string,
    @Body() body: { countedQty: number },
  ) {
    return this.svc.setLineCount(user.tenantId!, lineId, body.countedQty);
  }

  @ApiOperation({ summary: 'Post the count — applies variances to inventory' })
  @Roles(...WarehouseController.WAREHOUSE_OPS)
  @Post('cycle-counts/:id/post')
  @HttpCode(HttpStatus.OK)
  postCycleCount(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.postCycleCount(user.tenantId!, id, user.sub);
  }
}
