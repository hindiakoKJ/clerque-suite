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
import { InventoryService, AdjustStockDto, SetThresholdDto } from './inventory.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  /** List all inventory items for a branch */
  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('branchId') branchId: string) {
    return this.inventoryService.list(user.tenantId!, branchId ?? user.branchId!);
  }

  /** Items at or below their low-stock threshold */
  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('low-stock')
  getLowStock(@CurrentUser() user: JwtPayload, @Query('branchId') branchId: string) {
    return this.inventoryService.getLowStock(user.tenantId!, branchId ?? user.branchId!);
  }

  /** Movement log for one product */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
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

  /** Manual stock-in / stock-out / adjustment */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  adjust(@CurrentUser() user: JwtPayload, @Body() body: AdjustStockDto) {
    return this.inventoryService.adjust(user.tenantId!, user.sub, body);
  }

  /** Set low-stock alert threshold */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Patch('threshold')
  @HttpCode(HttpStatus.OK)
  setThreshold(@CurrentUser() user: JwtPayload, @Body() body: SetThresholdDto) {
    return this.inventoryService.setThreshold(user.tenantId!, body);
  }
}
