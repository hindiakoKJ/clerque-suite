import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { SubscriptionInvoiceStatus } from '@prisma/client';
import {
  SubscriptionBillingService,
  IssueInvoiceDto,
  MarkPaidDto,
} from './subscription-billing.service';

/**
 * Console-only billing endpoints. SUPER_ADMIN exclusively — this is HNS
 * Corp PH operational data, not tenant business data.
 *
 * Privacy invariant: every endpoint here reads ONLY from
 * subscription_invoices + tenants. No Order / Payslip / JournalEntry.
 */
@ApiTags('Subscription Billing (Console)')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/billing')
export class SubscriptionBillingController {
  constructor(private readonly svc: SubscriptionBillingService) {}

  @ApiOperation({ summary: 'List subscription invoices (filter by tenant / status / period)' })
  @Get('invoices')
  list(
    @Query('tenantId') tenantId?: string,
    @Query('status')   status?:   SubscriptionInvoiceStatus,
    @Query('from')     from?:     string,
    @Query('to')       to?:       string,
    @Query('take')     take?:     string,
    @Query('skip')     skip?:     string,
  ) {
    return this.svc.listInvoices({
      tenantId, status, from, to,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @ApiOperation({ summary: 'Get a single invoice with tenant contact info' })
  @Get('invoices/:id')
  get(@Param('id') id: string) {
    return this.svc.getInvoice(id);
  }

  @ApiOperation({ summary: 'Issue a subscription invoice (manual or backfill)' })
  @Post('invoices')
  @HttpCode(HttpStatus.CREATED)
  issue(@Body() dto: IssueInvoiceDto) {
    return this.svc.issueInvoice(dto);
  }

  @ApiOperation({ summary: 'Mark an invoice as PAID (manual reconciliation)' })
  @Post('invoices/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  markPaid(@Param('id') id: string, @Body() dto: MarkPaidDto) {
    return this.svc.markPaid(id, dto);
  }

  @ApiOperation({ summary: 'Write off an unpaid invoice (with audit reason)' })
  @Post('invoices/:id/write-off')
  @HttpCode(HttpStatus.OK)
  writeOff(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.svc.writeOff(id, body.reason);
  }

  @ApiOperation({ summary: 'Console billing dashboard metrics (operational only)' })
  @Get('metrics')
  metrics() {
    return this.svc.metrics();
  }
}
