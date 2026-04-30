import {
  Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ARPaymentsService } from './ar-payments.service';
import { CreateARPaymentDto, ApplyARPaymentDto } from './dto/ar-payment.dto';

@ApiTags('AR Payments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ar/payments')
export class ARPaymentsController {
  constructor(private svc: ARPaymentsService) {}

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page')        page?:       string,
    @Query('pageSize')    pageSize?:   string,
    @Query('customerId')  customerId?: string,
    @Query('from')        from?:       string,
    @Query('to')          to?:         string,
  ) {
    return this.svc.findAll(user.tenantId!, {
      page:     page     ? Number(page)     : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      customerId, from, to,
    });
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  /** Record a customer payment + (optionally) apply to invoices. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'CASHIER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateARPaymentDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  /** Apply unallocated portion of an existing payment to invoices. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ApplyARPaymentDto,
  ) {
    return this.svc.apply(user.tenantId!, id, user.sub, body.applications);
  }

  /** Void a payment — reverses JE + clears applications. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.svc.void(user.tenantId!, id, user.sub, body.reason ?? '');
  }
}
