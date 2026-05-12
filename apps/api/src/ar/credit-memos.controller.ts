import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { CreditMemoStatus } from '@prisma/client';
import { RequireIdempotency } from '../common/decorators/require-idempotency.decorator';
import { CreditMemosService } from './credit-memos.service';
import {
  CreateCreditMemoDto,
  UpdateCreditMemoDto,
  ApplyCreditMemoDto,
  VoidCreditMemoDto,
} from './dto/credit-memo.dto';

@ApiTags('AR Credit Memos')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard)
@RequireApp('LEDGER', 'READ_ONLY')
@Controller('ar/credit-memos')
export class CreditMemosController {
  constructor(private svc: CreditMemosService) {}

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page')       page?:       string,
    @Query('pageSize')   pageSize?:   string,
    @Query('customerId') customerId?: string,
    @Query('status')     status?:     string,
    @Query('from')       from?:       string,
    @Query('to')         to?:         string,
  ) {
    return this.svc.findAll(user.tenantId!, {
      page:     page     ? Number(page)     : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      customerId,
      status:   status as CreditMemoStatus | undefined,
      from, to,
    });
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCreditMemoDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCreditMemoDto,
  ) {
    return this.svc.update(user.tenantId!, id, user.sub, dto);
  }

  /** Post a DRAFT credit memo → POSTED, creating the GL JE. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @RequireIdempotency()
  @Patch(':id/post')
  @HttpCode(HttpStatus.OK)
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.post(user.tenantId!, id, user.sub);
  }

  /** Apply a posted credit memo against one open AR invoice. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @RequireIdempotency()
  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApplyCreditMemoDto,
  ) {
    return this.svc.apply(user.tenantId!, id, user.sub, dto);
  }

  /** Void a posted credit memo — reverses the JE and unwinds applications. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  @RequireIdempotency()
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: VoidCreditMemoDto,
  ) {
    return this.svc.void(user.tenantId!, id, user.sub, body.reason ?? '');
  }
}
