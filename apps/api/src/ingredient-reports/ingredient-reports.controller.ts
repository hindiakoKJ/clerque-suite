import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { IngredientReportsService } from './ingredient-reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { purchaseCostsVisibleTo } from '../procure/cost-visibility';

/*
  Every figure on these three is money: what each delivery cost, what the
  shelf is worth, what was used at what cost. On a shop that hides purchase
  costs from staff (Settings), the only staff role these routes admit --
  WAREHOUSE_STAFF -- is refused outright rather than handed a page of blanks;
  the screens that link here hide the links for them. Quantities they need
  are on Stock on hand and the Movement Log, which carry no money for them.
*/
const COSTS_HIDDEN =
  'Only the owner or a manager can open this, because it shows what the shop paid for stock.';

@ApiTags('Ingredient Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class IngredientReportsController {
  constructor(
    private svc: IngredientReportsService,
    // Only to read the owner's "show purchase costs to staff" switch.
    private prisma: PrismaService,
  ) {}

  private async refuseIfCostsHidden(user: JwtPayload): Promise<void> {
    if (!(await purchaseCostsVisibleTo(this.prisma, user.tenantId!, user.role))) {
      throw new ForbiddenException(COSTS_HIDDEN);
    }
  }

  /**
   * Per-ingredient movement timeline — receipts + consumption
   * GET /inventory/raw-materials/:id/movements
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'ACCOUNTANT', 'BOOKKEEPER')
  @Get('inventory/raw-materials/:id/movements')
  async getMovements(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('branchId') branchId?: string,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
    @Query('limit')    limit?: string,
  ) {
    await this.refuseIfCostsHidden(user);
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
  async getLots(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('branchId') branchId?: string,
  ) {
    await this.refuseIfCostsHidden(user);
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
  async getAggregated(
    @CurrentUser() user: JwtPayload,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
    @Query('branchId') branchId?: string,
  ) {
    await this.refuseIfCostsHidden(user);
    return this.svc.getAggregatedReport(user.tenantId!, {
      from,
      to,
      branchId: branchId ?? user.branchId ?? undefined,
    });
  }
}
