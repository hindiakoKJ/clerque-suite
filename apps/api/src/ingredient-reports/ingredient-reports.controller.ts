import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { IngredientReportsService } from './ingredient-reports.service';

@ApiTags('Ingredient Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class IngredientReportsController {
  constructor(private svc: IngredientReportsService) {}

  /**
   * Per-ingredient movement timeline — receipts + consumption
   * GET /inventory/raw-materials/:id/movements
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'ACCOUNTANT', 'BOOKKEEPER')
  @Get('inventory/raw-materials/:id/movements')
  getMovements(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('branchId') branchId?: string,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
    @Query('limit')    limit?: string,
  ) {
    return this.svc.getMovements(user.tenantId!, id, {
      branchId: branchId ?? user.branchId ?? undefined,
      from,
      to,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  /**
   * Per-ingredient FIFO lot list
   * GET /inventory/raw-materials/:id/lots
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'ACCOUNTANT', 'BOOKKEEPER')
  @Get('inventory/raw-materials/:id/lots')
  getLots(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getLots(user.tenantId!, id, branchId ?? user.branchId ?? undefined);
  }

  /**
   * Aggregated tenant-wide ingredient report
   * GET /reports/ingredients?from=&to=&branchId=
   *
   * Default range: last 30 days. All currency values in PHP.
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'ACCOUNTANT', 'BOOKKEEPER')
  @Get('reports/ingredients')
  getAggregated(
    @CurrentUser() user: JwtPayload,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getAggregatedReport(user.tenantId!, {
      from,
      to,
      branchId: branchId ?? user.branchId ?? undefined,
    });
  }
}
