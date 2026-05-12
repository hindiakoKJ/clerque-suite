import {
  Controller, Get, Post, Patch, Param, Body, Query, Res, UseGuards, HttpCode, HttpStatus,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { InvoiceStatus } from '@prisma/client';
import { RequireIdempotency } from '../common/decorators/require-idempotency.decorator';
import { ARInvoicesService } from './ar-invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateARInvoiceDto } from './dto/ar-invoice.dto';

@ApiTags('AR Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard)
@RequireApp('LEDGER', 'READ_ONLY')
@Controller('ar/invoices')
export class ARInvoicesController {
  constructor(
    private svc:        ARInvoicesService,
    private invoicePdf: InvoicePdfService,
    private mail:       MailService,
    private audit:      AuditService,
    private prisma:     PrismaService,
  ) {}

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
    @Query('dueBucket')   dueBucket?:   string,
  ) {
    return this.svc.findAll(user.tenantId!, {
      page:        page     ? Number(page)     : undefined,
      pageSize:    pageSize ? Number(pageSize) : undefined,
      customerId,
      status:      status as InvoiceStatus | undefined,
      from, to,
      onlyOpen:    onlyOpen    === 'true',
      onlyOverdue: onlyOverdue === 'true',
      dueBucket:   (['1-30', '31-60', '61-90', '90+'] as const).includes(dueBucket as never)
        ? (dueBucket as '1-30' | '31-60' | '61-90' | '90+')
        : undefined,
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
  @RequireIdempotency()
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

  // ── Sprint 22 — Invoice PDF + Email ─────────────────────────────────────

  /** GET /ar/invoices/:id/pdf — download a single-page PDF rendering. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AR_ACCOUNTANT', 'FINANCE_LEAD')
  @Get(':id/pdf')
  async downloadPdf(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const invoice = await this.svc.findOne(user.tenantId!, id);
    const buffer  = await this.invoicePdf.renderInvoicePdf(user.tenantId!, id);
    const filename = `${invoice.invoiceNumber}.pdf`;
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      buffer.length,
    });
    res.send(buffer);
  }

  /**
   * POST /ar/invoices/:id/email — render the PDF + send via Resend.
   * Body { to?: string }. Defaults to customer.contactEmail; 400 if neither set.
   * Audit-logs DATA_EXPORTED on success.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'FINANCE_LEAD')
  @Post(':id/email')
  @HttpCode(HttpStatus.OK)
  async emailInvoice(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { to?: string },
  ) {
    const invoice = await this.svc.findOne(user.tenantId!, id);
    const recipient = body.to?.trim() || invoice.customer?.contactEmail?.trim();
    if (!recipient) {
      throw new BadRequestException(
        'No recipient email provided and the customer has no contactEmail on file. Provide { to: "user@example.com" } or set the customer contactEmail first.',
      );
    }

    const pdfBuffer = await this.invoicePdf.renderInvoicePdf(user.tenantId!, id);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId! }, select: { name: true, businessName: true },
    });

    const fmtPeso = (v: { toString(): string } | number | string) => {
      const n = typeof v === 'number' ? v : Number(v.toString());
      return '₱ ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    await this.mail.sendInvoice({
      to:            recipient,
      customerName:  invoice.customer?.name ?? 'Customer',
      tenantName:    tenant.businessName ?? tenant.name,
      invoiceNumber: invoice.invoiceNumber,
      invoiceTotal:  fmtPeso(invoice.totalAmount),
      dueDate:       new Date(invoice.dueDate).toLocaleDateString('en-PH', {
        day: '2-digit', month: 'short', year: 'numeric',
      }),
      pdfBuffer,
    });

    void this.audit.log({
      tenantId:    user.tenantId!,
      action:      'DATA_EXPORTED',
      entityType:  'ARInvoice',
      entityId:    invoice.id,
      performedBy: user.sub,
      description: `Emailed AR invoice ${invoice.invoiceNumber} to ${recipient}`,
      after:       { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, recipient },
    });

    return { ok: true, recipient, invoiceNumber: invoice.invoiceNumber };
  }
}
