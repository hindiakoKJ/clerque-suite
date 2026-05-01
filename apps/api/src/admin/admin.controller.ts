import {
  Controller, Get, Patch, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@ApiTags('Admin (Console)')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private svc: AdminService) {}

  @Get('metrics')
  metrics() {
    return this.svc.getPlatformMetrics();
  }

  @Get('tenants')
  listTenants(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('tier')   tier?:   string,
  ) {
    return this.svc.listTenants({ search, status, tier });
  }

  @Get('tenants/:id')
  tenantDetail(@Param('id') id: string) {
    return this.svc.getTenantDetail(id);
  }

  @Patch('tenants/:id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'GRACE' | 'SUSPENDED' },
  ) {
    return this.svc.setTenantStatus(id, body.status);
  }

  @Patch('tenants/:id/tier')
  @HttpCode(HttpStatus.OK)
  setTier(
    @Param('id') id: string,
    @Body() body: { tier: 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6' },
  ) {
    return this.svc.setTenantTier(id, body.tier);
  }

  @Patch('tenants/:id/ai-override')
  @HttpCode(HttpStatus.OK)
  setAiOverride(
    @Param('id') id: string,
    @Body() body: { quotaOverride: number | null; addonType: string | null },
  ) {
    return this.svc.setAiOverride(id, body.quotaOverride, body.addonType);
  }

  @Get('failed-events')
  failedEvents(@Query('limit') limit?: string) {
    return this.svc.listFailedEvents({ limit: limit ? Number(limit) : undefined });
  }
}
