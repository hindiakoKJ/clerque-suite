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

  // ── Read — available to all Ledger roles ─────────────────────────────────

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.svc.findAll(user.tenantId!);
  }

  @Get('trial-balance')
  trialBalance(@CurrentUser() user: JwtPayload, @Query('asOf') asOf?: string) {
    return this.svc.getTrialBalance(user.tenantId!, asOf);
  }

  @Get('pl-summary')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER')
  plSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    const now = new Date().toISOString().split('T')[0];
    return this.svc.getPLSummary(user.tenantId!, from ?? now, to ?? now);
  }

  @Get(':accountId/ledger')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER')
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
