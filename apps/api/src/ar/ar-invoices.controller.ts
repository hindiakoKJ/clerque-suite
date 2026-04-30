import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { InvoiceStatus } from '@prisma/client';
import { ARInvoicesService } from './ar-invoices.service';
import { CreateARInvoiceDto } from './dto/ar-invoice.dto';

@ApiTags('AR Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ar/invoices')
export class ARInvoicesController {
  constructor(private svc: ARInvoicesService) {}

  /** List with filters: status, customerId, date range, onlyOpen, onlyOverdue */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page')        page?:        string,
    @Query('pageSize')    pageSize?:    string,
    @Query('customerId')  customerId?:  string,
    @Query('status')      status?:      string,
    @Query('from')        from?:        string,
    @Query('to')          to?:          string,
    @Query('onlyOpen')    onlyOpen?:    string,
    @Query('onlyOverdue') onlyOverdue?: string,
  ) {
    return this.svc.findAll(user.tenantId!, {
      page:        page     ? Number(page)     : undefined,
      pageSize:    pageSize ? Number(pageSize) : undefined,
      customerId,
      status:      status as InvoiceStatus | undefined,
      from, to,
      onlyOpen:    onlyOpen    === 'true',
      onlyOverdue: onlyOverdue === 'true',
    });
  }

  /** Aging summary for open formal AR invoices. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get('aging')
  getAging(@CurrentUser() user: JwtPayload) {
    return this.svc.getAging(user.tenantId!);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  /** Create a DRAFT invoice. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateARInvoiceDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  /** Post a DRAFT invoice → OPEN, creating the GL JE. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @Patch(':id/post')
  @HttpCode(HttpStatus.OK)
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.post(user.tenantId!, id, user.sub);
  }

  /** Void a posted invoice — reverses the JE. */
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

  /** Cancel a DRAFT invoice (no GL impact). */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AR_ACCOUNTANT')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.svc.cancel(user.tenantId!, id, user.sub, body.reason ?? 'No reason given');
  }
}
