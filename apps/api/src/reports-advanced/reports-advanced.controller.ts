import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ReportsAdvancedService } from './reports-advanced.service';

@ApiTags('ReportsAdvanced')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@RequirePlanFeature('advancedReports')
@Controller('reports-advanced')
export class ReportsAdvancedController {
  constructor(private readonly svc: ReportsAdvancedService) {}

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'SUPER_ADMIN', 'FINANCE_LEAD')
  @Get('sales-heatmap')
  salesHeatmap(@CurrentUser() user: JwtPayload) {
    return this.svc.salesHeatmap(user.tenantId!);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'SUPER_ADMIN', 'FINANCE_LEAD')
  @Get('cohorts')
  cohorts(@CurrentUser() user: JwtPayload) {
    return this.svc.cohorts(user.tenantId!);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'SUPER_ADMIN', 'FINANCE_LEAD')
  @Get('attach-rate')
  attachRate(@CurrentUser() user: JwtPayload) {
    return this.svc.attachRate(user.tenantId!);
  }
}
