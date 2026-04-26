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
}
