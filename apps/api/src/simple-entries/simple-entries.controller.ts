import {
  Controller, Get, Post, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { SimpleEntriesService } from './simple-entries.service';
import { CreateSimpleEntryDto } from './dto/simple-entry.dto';

/**
 * SIMPLE-tier feature: requires the Ledger module (SOLO_BOOKS+) but NOT
 * advancedAccounting — so Solo Books tenants get it, POS-only Solo plans don't.
 * Guard stack mirrors the SIMPLE ledger controllers (no PlanFeatureGuard).
 */
@ApiTags('Simple Entries')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard)
@RequireApp('LEDGER', 'READ_ONLY')
@Controller('simple-entries')
export class SimpleEntriesController {
  constructor(private readonly svc: SimpleEntriesService) {}

  @ApiOperation({ summary: 'Record a simple operational entry (posts a balanced JE)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSimpleEntryDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  @ApiOperation({ summary: 'List recent simple entries' })
  @Roles(
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT',
    'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR',
  )
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.list(user.tenantId!);
  }
}
