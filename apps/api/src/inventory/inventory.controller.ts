import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { SetThresholdDto } from './dto/set-threshold.dto';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { ReceiveRawMaterialDto } from './dto/receive-raw-material.dto';

@ApiTags('Inventory')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  /** List inventory items for a branch — paginated, searchable */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD')
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('page') page?: string,
    @Query('search') search?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
  ) {
    return this.inventoryService.list(user.tenantId!, branchId ?? user.branchId!, {
      page: page ? parseInt(page) : 1,
      search,
      lowStockOnly: lowStockOnly === 'true',
    });
  }

  /** Items at or below their low-stock threshold */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD')
  @Get('low-stock')
  getLowStock(@CurrentUser() user: JwtPayload, @Query('branchId') branchId: string) {
    return this.inventoryService.getLowStock(user.tenantId!, branchId ?? user.branchId!);
  }

  /** Movement log for one product — WAREHOUSE_STAFF can view their own adjustments */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD')
  @Get(':productId/logs')
  getLogs(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
    @Query('branchId') branchId: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.getLogs(
      user.tenantId!,
      productId,
      branchId ?? user.branchId!,
      limit ? parseInt(limit) : 50,
    );
  }

  /**
   * All stock movements — finished goods AND raw materials — for the branch.
   * Used by the Stock Movements page (the "show me everything that happened
   * to my inventory" audit view).
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'ACCOUNTANT', 'BOOKKEEPER', 'SUPER_ADMIN')
  @Get('movements')
  getMovements(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to')   to?: string,
    @Query('kind') kind?: 'PRODUCT' | 'RAW_MATERIAL' | 'ALL',
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.getAllMovements(user.tenantId!, {
      branchId: branchId ?? user.branchId ?? undefined,
      from,
      to,
      kind: kind ?? 'ALL',
      limit: limit ? Math.min(500, parseInt(limit)) : 200,
    });
  }

  /** Manual stock-in / stock-out / adjustment — WAREHOUSE_STAFF is the new gatekeeper */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  adjust(@CurrentUser() user: JwtPayload, @Body() body: AdjustStockDto) {
    return this.inventoryService.adjust(user.tenantId!, user.sub, body);
  }

  /** Set low-stock alert threshold — OWNER and MDM only (master data governance) */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @Patch('threshold')
  @HttpCode(HttpStatus.OK)
  setThreshold(@CurrentUser() user: JwtPayload, @Body() body: SetThresholdDto) {
    return this.inventoryService.setThreshold(user.tenantId!, body);
  }

  // ─── Raw Materials (F&B ingredient library) ─────────────────────────────────

  /** List all raw materials — used to populate recipe dropdowns */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Get('raw-materials')
  listRawMaterials(
    @CurrentUser() user: JwtPayload,
    @Query('includeInactive') includeInactive?: string,
    @Query('branchId') branchId?: string,
  ) {
    // Prefer explicit branchId query param; fall back to the user's own branch.
    // This lets the Inventory page pass the currently-selected branch.
    const branch = branchId ?? user.branchId ?? undefined;
    return this.inventoryService.listRawMaterials(user.tenantId!, includeInactive === 'true', branch);
  }

  /** Raw material stock levels for a branch */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD')
  @Get('raw-materials/stock')
  listRawMaterialStock(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
  ) {
    return this.inventoryService.listRawMaterialStock(user.tenantId!, branchId ?? user.branchId!);
  }

  /** Create a new raw material (ingredient) */
  @Roles('BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Post('raw-materials')
  createRawMaterial(@CurrentUser() user: JwtPayload, @Body() dto: CreateRawMaterialDto) {
    return this.inventoryService.createRawMaterial(user.tenantId!, dto);
  }

  /** Update raw material name, unit, or cost price */
  @Roles('BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Patch('raw-materials/:id')
  @HttpCode(HttpStatus.OK)
  updateRawMaterial(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: Partial<CreateRawMaterialDto> & { isActive?: boolean },
  ) {
    return this.inventoryService.updateRawMaterial(user.tenantId!, id, dto);
  }

  /** Receive a delivery of a raw material — adds stock + updates WAC cost */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Post('raw-materials/:id/receive')
  @HttpCode(HttpStatus.OK)
  receiveRawMaterial(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReceiveRawMaterialDto,
  ) {
    return this.inventoryService.receiveRawMaterial(user.tenantId!, id, dto);
  }
}
