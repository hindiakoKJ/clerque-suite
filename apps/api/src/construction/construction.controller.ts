import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import type { ProgressBillingStatus } from '@prisma/client';
import {
  ConstructionService,
  CreateProgressBillingDto,
  ReleaseRetentionDto,
} from './construction.service';

/**
 * Project-Engine — Construction endpoints.
 *
 * Progress billing + retention release are bookkeeping events that hit AR.
 * Roles tuned for the workflow: site engineers (BRANCH_MANAGER) draft the
 * billings, owner/finance issues + approves, accountant marks paid.
 */
@ApiTags('Construction')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('construction')
export class ConstructionController {
  constructor(private readonly svc: ConstructionService) {}

  private static readonly READ_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD',
    'AR_ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'ACCOUNTANT',
  ] as const;
  private static readonly DRAFT_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD',
  ] as const;
  private static readonly ISSUE_ROLES = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'AR_ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD',
  ] as const;

  // ─── Progress billings ────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Draft a new progress billing against a project' })
  @Roles(...ConstructionController.DRAFT_ROLES)
  @Post('progress-billings')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProgressBillingDto) {
    return this.svc.createProgressBilling(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'List progress billings (filter by project / status)' })
  @Roles(...ConstructionController.READ_ROLES)
  @Get('progress-billings')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('projectId') projectId?: string,
    @Query('status')    status?:    ProgressBillingStatus,
    @Query('take')      take?:      string,
    @Query('skip')      skip?:      string,
  ) {
    return this.svc.listProgressBillings(user.tenantId!, {
      projectId, status,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @ApiOperation({ summary: 'Get one progress billing with linked Order + retention release' })
  @Roles(...ConstructionController.READ_ROLES)
  @Get('progress-billings/:id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getProgressBilling(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Issue a DRAFT progress billing (ready for invoicing)' })
  @Roles(...ConstructionController.ISSUE_ROLES)
  @Patch('progress-billings/:id/issue')
  @HttpCode(HttpStatus.OK)
  issue(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.issueProgressBilling(user.tenantId!, id);
  }

  @ApiOperation({ summary: 'Link an Order (AR invoice) to an issued progress billing' })
  @Roles(...ConstructionController.ISSUE_ROLES)
  @Patch('progress-billings/:id/link-order')
  link(
    @CurrentUser() user: JwtPayload,
    @Param('id')   id:   string,
    @Body() body: { orderId: string },
  ) {
    return this.svc.linkOrderToBilling(user.tenantId!, id, body.orderId);
  }

  @ApiOperation({ summary: 'Mark an ISSUED progress billing as PAID' })
  @Roles(...ConstructionController.ISSUE_ROLES)
  @Patch('progress-billings/:id/mark-paid')
  paid(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.markProgressBillingPaid(user.tenantId!, id);
  }

  // ─── Retention release ────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Release retention held against a paid progress billing' })
  @Roles(...ConstructionController.ISSUE_ROLES)
  @Post('retention-releases')
  @HttpCode(HttpStatus.CREATED)
  release(@CurrentUser() user: JwtPayload, @Body() dto: ReleaseRetentionDto) {
    return this.svc.releaseRetention(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'List retention releases (audit view)' })
  @Roles(...ConstructionController.READ_ROLES)
  @Get('retention-releases')
  listReleases(
    @CurrentUser() user: JwtPayload,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.svc.listRetentionReleases(user.tenantId!, {
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Project P&L (revenue billed vs material cost vs WIP)' })
  @Roles(...ConstructionController.READ_ROLES)
  @Get('projects/:id/pnl')
  pnl(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.projectPnl(user.tenantId!, id);
  }
}
