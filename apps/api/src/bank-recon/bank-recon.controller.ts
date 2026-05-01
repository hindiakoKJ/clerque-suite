import {
  Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { BankReconciliationService } from './bank-recon.service';

const RECON_ROLES = ['BUSINESS_OWNER', 'ACCOUNTANT', 'FINANCE_LEAD', 'SUPER_ADMIN'] as const;

@ApiTags('Bank Reconciliation')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bank-recon')
export class BankReconciliationController {
  constructor(private svc: BankReconciliationService) {}

  @Roles(...RECON_ROLES)
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.list(user.tenantId!);
  }

  @Roles(...RECON_ROLES)
  @Get('draft')
  draft(
    @CurrentUser() user: JwtPayload,
    @Query('accountId')   accountId:   string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd')   periodEnd:   string,
  ) {
    return this.svc.draft(user.tenantId!, accountId, periodStart, periodEnd);
  }

  @Roles(...RECON_ROLES)
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  @Roles(...RECON_ROLES)
  @Post()
  @HttpCode(HttpStatus.OK)
  upsert(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      id?:           string;
      accountId:     string;
      periodStart:   string;
      periodEnd:     string;
      bankBalance:   number;
      glBalance:     number;
      notes?:        string;
      items:         Array<{
        itemType:        'STATEMENT' | 'JE_LINE' | 'MATCHED';
        statementDate?:  string;
        statementDesc?:  string;
        statementAmount?: number;
        journalLineId?:  string;
        isMatched?:      boolean;
        notes?:          string;
      }>;
      complete?:     boolean;
    },
  ) {
    return this.svc.upsert(user.tenantId!, user.sub, body);
  }
}
