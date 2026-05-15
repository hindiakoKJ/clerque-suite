import {
  BadRequestException, Controller, Get, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { InventoryReportsService } from './inventory-reports.service';

@ApiTags('Inventory Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@RequirePlanFeature('advancedReports')
@Controller('inventory-reports')
export class InventoryReportsController {
  constructor(private readonly svc: InventoryReportsService) {}

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'FINANCE_LEAD')
  @Get('variance')
  variance(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to')   to?:   string,
  ) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.variance(user.tenantId, branchId, from, to);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'FINANCE_LEAD')
  @Get('margin')
  margin(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to')   to?:   string,
  ) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.margin(user.tenantId, from, to);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'WAREHOUSE_STAFF', 'ACCOUNTANT')
  @Get('depletion-forecast')
  depletion(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.depletionForecast(user.tenantId, branchId);
  }
}
