import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting/accounts')
export class AccountsController {
  constructor(private readonly svc: AccountsService) {}

  // ── Read — scoped by role ──────────────────────────────────────────────────

  /** Chart of accounts list — all Ledger roles can view the COA. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.svc.findAll(user.tenantId!);
  }

  /** Trial balance — all Ledger roles. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get('trial-balance')
  trialBalance(@CurrentUser() user: JwtPayload, @Query('asOf') asOf?: string) {
    return this.svc.getTrialBalance(user.tenantId!, asOf);
  }

  /**
   * P&L Summary — restricted to management + finance roles.
   * Bookkeeper and External Auditor do NOT get P&L access (SOD).
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_LEAD')
  @Get('pl-summary')
  plSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    const now = new Date().toISOString().split('T')[0];
    return this.svc.getPLSummary(user.tenantId!, from ?? now, to ?? now);
  }

  /**
   * Balance Sheet as of a date. Same access set as Trial Balance —
   * Bookkeeper + External Auditor included since this is a published
   * statement, not internal management info.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get('balance-sheet')
  balanceSheet(@CurrentUser() user: JwtPayload, @Query('asOf') asOf?: string) {
    return this.svc.getBalanceSheet(user.tenantId!, asOf);
  }

  /**
   * Cash Flow Statement (indirect method) for a date range.
   * Same access set as P&L — restricted to management + finance roles.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_LEAD')
  @Get('cash-flow')
  cashFlow(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    const now = new Date().toISOString().split('T')[0];
    return this.svc.getCashFlow(user.tenantId!, from ?? now, to ?? now);
  }

  /**
   * Account ledger drill-down (FBL3N equivalent).
   * Bookkeeper included — they review individual GL movements.
   * External Auditor included — read-only audit trail access.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':accountId/ledger')
  accountLedger(
    @CurrentUser() user: JwtPayload,
    @Param('accountId') accountId: string,
    @Query('from')      from?: string,
    @Query('to')        to?: string,
    @Query('page')      page?: string,
  ) {
    return this.svc.getAccountLedger(user.tenantId!, accountId, {
      from, to, page: page ? Number(page) : 1,
    });
  }

  /** Single account detail — same read-access set as list. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  // ── Write — SUPER_ADMIN only (COA structure changes) ─────────────────────
  // Regular users can view the COA but cannot add/edit/delete accounts.
  // This enforces COA integrity: only the platform admin tailors it per tenant.

  @Post()
  @Roles('SUPER_ADMIN')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAccountDto) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.delete(user.tenantId, id);
  }
}
