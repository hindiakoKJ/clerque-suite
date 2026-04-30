import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { LedgerMetricsService } from './ledger-metrics.service';

@ApiTags('Ledger Metrics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ledger')
export class LedgerMetricsController {
  constructor(private svc: LedgerMetricsService) {}

  /**
   * Process-health metrics for the Ledger dashboard.
   * Open to all Ledger-eligible roles — these are operational metrics, not
   * sensitive financials. The page itself filters which sections to show
   * per role (e.g. SOD overrides hidden from EXTERNAL_AUDITOR).
   */
  @Roles(
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER',
    'FINANCE_LEAD', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR',
  )
  @Get('process-metrics')
  getProcessMetrics(@CurrentUser() user: JwtPayload) {
    return this.svc.getProcessMetrics(user.tenantId!);
  }
}
