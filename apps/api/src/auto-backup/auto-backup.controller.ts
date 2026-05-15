/**
 * Sprint 25 Phase 2C — Auto-backup controller.
 *
 * Routes are gated on the `autoBackup` plan feature flag (Pro-tier).
 */
import {
  Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { AutoBackupConfig, AutoBackupService } from './auto-backup.service';

@ApiTags('Auto-backup')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@RequirePlanFeature('autoBackup')
@Controller('auto-backup')
export class AutoBackupController {
  constructor(private readonly svc: AutoBackupService) {}

  @ApiOperation({ summary: 'Trigger a backup now and return the JSON blob' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(@CurrentUser() user: JwtPayload) {
    const { meta, blob } = await this.svc.runForTenant(user.tenantId!);
    return {
      meta: {
        filename:    meta.filename,
        sizeBytes:   meta.sizeBytes,
        generatedAt: meta.generatedAt,
      },
      blob,
    };
  }

  @ApiOperation({ summary: 'Latest backup metadata (filename, size, time)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Get('latest')
  async latest(@CurrentUser() user: JwtPayload) {
    const meta = await this.svc.getLatestBackup(user.tenantId!);
    if (!meta) return { exists: false };
    return {
      exists:      true,
      filename:    meta.filename,
      sizeBytes:   meta.sizeBytes,
      generatedAt: meta.generatedAt,
    };
  }

  @ApiOperation({ summary: 'Read the Tenant.autoBackupConfigJson placeholder' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('config')
  config(@CurrentUser() user: JwtPayload) {
    return this.svc.getConfig(user.tenantId!);
  }

  @ApiOperation({ summary: 'Patch the Drive-config placeholder (folderId, tokens, lastBackupAt)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('config')
  patchConfig(
    @CurrentUser() user: JwtPayload,
    @Body() body: Partial<AutoBackupConfig>,
  ) {
    return this.svc.updateConfig(user.tenantId!, body);
  }
}
