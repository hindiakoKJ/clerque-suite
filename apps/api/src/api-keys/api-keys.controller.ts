import {
  Body, Controller, Delete, Get, Param, Post, UseGuards, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload, ApiAccessLevel } from '@repo/shared-types';
import { ApiKeysService } from './api-keys.service';

interface CreateApiKeyDto {
  label:       string;
  accessLevel: ApiAccessLevel;
  expiresAt?:  string | null;
}

@ApiTags('API Keys')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@RequirePlanFeature('apiAccess', 'read')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly svc: ApiKeysService) {}

  @Roles('BUSINESS_OWNER')
  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateApiKeyDto) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('expiresAt is not a valid date.');
    }
    return this.svc.create(user.tenantId, user.sub, dto.label, dto.accessLevel, expiresAt);
  }

  @Roles('BUSINESS_OWNER')
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.list(user.tenantId);
  }

  @Roles('BUSINESS_OWNER')
  @Delete(':id')
  revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (!user.tenantId) throw new BadRequestException('No tenant context.');
    return this.svc.revoke(user.tenantId, id);
  }
}
