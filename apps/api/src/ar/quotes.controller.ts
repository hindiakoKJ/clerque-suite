import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { QuoteStatus } from '@prisma/client';
import { QuotesService } from './quotes.service';
import {
  CreateQuoteDto, UpdateQuoteDto, ConvertQuoteDto,
} from './dto/quote.dto';

const READ_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'SALES_LEAD', 'EXTERNAL_AUDITOR'] as const;
const WRITE_ROLES = ['BUSINESS_OWNER', 'AR_ACCOUNTANT', 'ACCOUNTANT', 'SALES_LEAD'] as const;

@ApiTags('AR Quotes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard)
@RequireApp('LEDGER', 'READ_ONLY')
@Controller('ar/quotes')
export class QuotesController {
  constructor(private svc: QuotesService) {}

  @Roles(...READ_ROLES)
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
      status:   status as QuoteStatus | undefined,
      from, to,
    });
  }

  @Roles(...READ_ROLES)
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  @Roles(...WRITE_ROLES)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateQuoteDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  @Roles(...WRITE_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.svc.update(user.tenantId!, id, dto);
  }

  @Roles(...WRITE_ROLES)
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.markSent(user.tenantId!, id);
  }

  @Roles(...WRITE_ROLES)
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.markAccepted(user.tenantId!, id);
  }

  @Roles(...WRITE_ROLES)
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.markRejected(user.tenantId!, id);
  }

  @Roles(...WRITE_ROLES)
  @Post(':id/convert')
  @HttpCode(HttpStatus.OK)
  convert(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ConvertQuoteDto,
  ) {
    return this.svc.convertToInvoice(user.tenantId!, id, user.sub, dto);
  }

  @Roles(...WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.remove(user.tenantId!, id);
  }
}
