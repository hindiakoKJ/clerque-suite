import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { AuditService } from './audit.service';
import { AuditAction } from '@prisma/client';

@ApiTags('Audit')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@RequirePlanFeature('auditLog')
@Controller('audit')
export class AuditController {
  constructor(private audit: AuditService) {}

  /**
   * List audit log entries for the current tenant, paginated.
   * Access: BUSINESS_OWNER, SUPER_ADMIN, BRANCH_MANAGER, ACCOUNTANT, FINANCE_LEAD, EXTERNAL_AUDITOR.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page')       page?:       string,
    @Query('action')     action?:     string,
    @Query('entityType') entityType?: string,
  ) {
    return this.audit.findAll(user.tenantId!, {
      page:       page ? parseInt(page, 10) : 1,
      action:     action as AuditAction | undefined,
      entityType: entityType ?? undefined,
    });
  }

  /**
   * Sprint 19 — Login history for the tenant (success + failed attempts
   * in the last N days). Owner / Manager see "who logged in when, from
   * where, on what device". Failed-login burst is the early warning sign
   * for credential stuffing or brute force.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'EXTERNAL_AUDITOR')
  @Get('logins')
  loginHistory(
    @CurrentUser() user: JwtPayload,
    @Query('days') days?: string,
  ) {
    return this.audit.recentLogins(user.tenantId!, days ? Math.min(Number(days), 90) : 14);
  }

  /**
   * Audit D4-05 — Historical SOD violations. Returns users whose role
   * history has crossed a conflict pair (e.g. AP_ACCOUNTANT then later
   * PAYROLL_MASTER → same person could have created fake bills and then
   * paid themselves). Owner / Super-admin / Auditor only.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'EXTERNAL_AUDITOR')
  @Get('sod-violations')
  sodViolations(
    @CurrentUser() user: JwtPayload,
    @Query('fromDate') fromDate?: string,
    @Query('toDate')   toDate?:   string,
  ) {
    return this.audit.findSodViolations(user.tenantId!, { fromDate, toDate });
  }
}
