import {
  Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { RequireIdempotency } from '../common/decorators/require-idempotency.decorator';
import { CustomerAdvancesService } from './customer-advances.service';
import {
  CreateCustomerAdvanceDto,
  ApplyCustomerAdvanceDto,
  RefundCustomerAdvanceDto,
  VoidCustomerAdvanceDto,
} from './dto/customer-advance.dto';

@ApiTags('AR Customer Advances')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard)
@RequireApp('LEDGER', 'READ_ONLY')
@Controller('ar/customer-advances')
export class CustomerAdvancesController {
  constructor(private svc: CustomerAdvancesService) {}

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR', 'CASHIER')
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
      customerId, status, from, to,
    });
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR', 'CASHIER')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  /** Create a DRAFT customer advance. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'CASHIER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCustomerAdvanceDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  /** Post a DRAFT advance — emits the cash/liability JE. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'CASHIER')
  @RequireIdempotency()
  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.post(user.tenantId!, id, user.sub);
  }

  /** Apply the (unapplied portion of a) posted advance to an invoice. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApplyCustomerAdvanceDto,
  ) {
    return this.svc.apply(user.tenantId!, id, user.sub, dto);
  }

  /** Refund the unapplied balance to the customer — terminal state. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @RequireIdempotency()
  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  refund(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RefundCustomerAdvanceDto,
  ) {
    return this.svc.refund(user.tenantId!, id, user.sub, dto);
  }

  /** Void a posted advance — reverses the JE + rolls back applications. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT')
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  voidAdvance(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: VoidCustomerAdvanceDto,
  ) {
    return this.svc.void(user.tenantId!, id, user.sub, dto.reason);
  }
}
