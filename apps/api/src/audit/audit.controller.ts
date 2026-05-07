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
   * Access: BUSINESS_OWNER, SUPER_ADMIN, ACCOUNTANT, FINANCE_LEAD, EXTERNAL_AUDITOR (read-only).
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
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
}
