/**
 * QuotesService — Sales Quote (Proforma / Estimate) CRUD + status flow + conversion.
 *
 * Lifecycle:
 *   create()           → DRAFT (editable, no GL impact)
 *   markSent()         → DRAFT → SENT
 *   markAccepted()     → SENT  → ACCEPTED
 *   markRejected()     → SENT  → REJECTED
 *   convertToInvoice() → ACCEPTED → CONVERTED (creates ARInvoice via ARInvoicesService)
 *
 * A Quote does NOT post to the GL. Conversion is when the JE gets created, by
 * delegating to ARInvoicesService.create. Lines copy across; the default
 * Revenue account (code 4000) is used for every converted line — owners can
 * adjust on the resulting DRAFT invoice before posting.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertBranchInTenant } from '../common/tenant-fk-guards';
import { NumberingService } from '../numbering/numbering.service';
import { ARInvoicesService } from './ar-invoices.service';
import { Prisma, QuoteStatus } from '@prisma/client';
import { CreateQuoteDto, UpdateQuoteDto, ConvertQuoteDto } from './dto/quote.dto';

@Injectable()
export class QuotesService {
  constructor(
    private prisma:      PrismaService,
    private numbering:   NumberingService,
    private arInvoices:  ARInvoicesService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Pick a default Revenue account for converted lines. Code 4000 standard. */
  private async findDefaultRevenueAccount(tenantId: string): Promise<{ id: string }> {
    const byCode = await this.prisma.account.findFirst({
      where:  { tenantId, code: '4000', isActive: true },
      select: { id: true },
    });
    if (byCode) return byCode;

    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId,
        type: 'REVENUE',
        isActive: true,
      },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    if (fallback) return fallback;

    throw new BadRequestException(
      'No active REVENUE account found. Add one to your Chart of Accounts (e.g. code 4000, type REVENUE) before converting a quote.',
    );
  }

  private computeTotals(lines: { quantity?: number; unitPrice: number; taxAmount?: number; lineTotal: number }[]) {
    const subtotal  = lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0);
    const vatAmount = lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
    const total     = lines.reduce((s, l) => s + l.lineTotal, 0);
    return { subtotal, vatAmount, total };
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /** Create a DRAFT quote. */
  async create(tenantId: string, userId: string, dto: CreateQuoteDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Quote must have at least one line.');
    }

    const customer = await this.prisma.customer.findFirst({
      where:  { id: dto.customerId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');

    const { subtotal, vatAmount, total } = this.computeTotals(dto.lines);


    // SecAudit 2026-05 T2 — assert dto.branchId belongs to this tenant.
    await assertBranchInTenant(this.prisma, tenantId, dto.branchId);

    return this.prisma.$transaction(async (tx) => {
      const quoteNumber = await this.numbering.next(tenantId, 'QUOTE', null, tx);

      return tx.quote.create({
        data: {
          tenantId,
          branchId:    dto.branchId ?? null,
          quoteNumber,
          customerId:  dto.customerId,
          quoteDate:   new Date(dto.quoteDate),
          validUntil:  new Date(dto.validUntil),
          terms:       dto.terms,
          notes:       dto.notes,
          status:      'DRAFT',
          subtotal:    new Prisma.Decimal(subtotal),
          vatAmount:   new Prisma.Decimal(vatAmount),
          totalAmount: new Prisma.Decimal(total),
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              description: l.description,
              quantity:    new Prisma.Decimal(l.quantity ?? 1),
              unitPrice:   new Prisma.Decimal(l.unitPrice),
              taxAmount:   new Prisma.Decimal(l.taxAmount ?? 0),
              lineTotal:   new Prisma.Decimal(l.lineTotal),
            })),
          },
        },
        include: { lines: true, customer: { select: { id: true, name: true } } },
      });
    });
  }

  /** Update a DRAFT quote (only DRAFT is editable). */
  async update(tenantId: string, quoteId: string, dto: UpdateQuoteDto) {
    const existing = await this.prisma.quote.findFirst({
      where: { id: quoteId, tenantId },
    });
    if (!existing) throw new NotFoundException('Quote not found.');
    if (existing.status !== 'DRAFT') {
      throw new ForbiddenException(`Cannot edit quote in status ${existing.status}. Only DRAFT quotes can be updated.`);
    }

    const data: Prisma.QuoteUpdateInput = {};
    if (dto.customerId !== undefined) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('Customer not found.');
      data.customer = { connect: { id: dto.customerId } };
    }
    if (dto.quoteDate)  data.quoteDate  = new Date(dto.quoteDate);
    if (dto.validUntil) data.validUntil = new Date(dto.validUntil);
    if (dto.terms !== undefined) data.terms = dto.terms;
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        const { subtotal, vatAmount, total } = this.computeTotals(dto.lines);
        data.subtotal    = new Prisma.Decimal(subtotal);
        data.vatAmount   = new Prisma.Decimal(vatAmount);
        data.totalAmount = new Prisma.Decimal(total);
        await tx.quoteLine.deleteMany({ where: { quoteId } });
        data.lines = {
          create: dto.lines.map((l) => ({
            description: l.description,
            quantity:    new Prisma.Decimal(l.quantity ?? 1),
            unitPrice:   new Prisma.Decimal(l.unitPrice),
            taxAmount:   new Prisma.Decimal(l.taxAmount ?? 0),
            lineTotal:   new Prisma.Decimal(l.lineTotal),
          })),
        };
      }

      return tx.quote.update({
        where: { id: quoteId },
        data,
        include: { lines: true, customer: { select: { id: true, name: true } } },
      });
    });
  }

  /** Delete a DRAFT quote. */
  async remove(tenantId: string, quoteId: string) {
    const existing = await this.prisma.quote.findFirst({
      where: { id: quoteId, tenantId },
    });
    if (!existing) throw new NotFoundException('Quote not found.');
    if (existing.status !== 'DRAFT') {
      throw new ForbiddenException(`Cannot delete quote in status ${existing.status}. Only DRAFT quotes can be deleted.`);
    }
    await this.prisma.quote.delete({ where: { id: quoteId } });
    return { ok: true };
  }

  // ── Status transitions ────────────────────────────────────────────────────

  async markSent(tenantId: string, quoteId: string) {
    const result = await this.prisma.quote.updateMany({
      where: { id: quoteId, tenantId, status: 'DRAFT' },
      data:  { status: 'SENT', sentAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException('Quote not found or not in DRAFT status.');
    }
    return this.findOne(tenantId, quoteId);
  }

  async markAccepted(tenantId: string, quoteId: string) {
    const result = await this.prisma.quote.updateMany({
      where: { id: quoteId, tenantId, status: 'SENT' },
      data:  { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException('Quote not found or not in SENT status.');
    }
    return this.findOne(tenantId, quoteId);
  }

  async markRejected(tenantId: string, quoteId: string) {
    const result = await this.prisma.quote.updateMany({
      where: { id: quoteId, tenantId, status: 'SENT' },
      data:  { status: 'REJECTED' },
    });
    if (result.count === 0) {
      throw new BadRequestException('Quote not found or not in SENT status.');
    }
    return this.findOne(tenantId, quoteId);
  }

  /**
   * Convert ACCEPTED quote → DRAFT ARInvoice. Mirrors the line structure
   * 1:1, applies the default Revenue account, links the invoice back via
   * convertedToInvoiceId, and stamps the quote as CONVERTED.
   */
  async convertToInvoice(
    tenantId: string,
    quoteId:  string,
    userId:   string,
    dto:      ConvertQuoteDto = {},
  ) {
    const quote = await this.prisma.quote.findFirst({
      where:   { id: quoteId, tenantId },
      include: { lines: true },
    });
    if (!quote) throw new NotFoundException('Quote not found.');
    if (quote.status !== 'ACCEPTED') {
      throw new BadRequestException(`Cannot convert quote in status ${quote.status}. Quote must be ACCEPTED.`);
    }

    const revenueAccount = await this.findDefaultRevenueAccount(tenantId);
    const invoiceDate = dto.invoiceDate ?? new Date().toISOString().slice(0, 10);
    const termsDays   = dto.termsDays ?? 30;

    // Create the invoice via the existing service so its create() logic stays
    // the single source of truth for AR invoice creation.
    const invoice = await this.arInvoices.create(tenantId, userId, {
      customerId:  quote.customerId,
      branchId:    quote.branchId ?? undefined,
      invoiceDate,
      termsDays,
      reference:   quote.quoteNumber,
      description: `Converted from quote ${quote.quoteNumber}`,
      notes:       quote.notes ?? undefined,
      lines: quote.lines.map((l) => ({
        accountId:   revenueAccount.id,
        description: l.description,
        quantity:    Number(l.quantity),
        unitPrice:   Number(l.unitPrice),
        taxAmount:   Number(l.taxAmount),
        lineTotal:   Number(l.lineTotal),
      })),
    });

    // Link & mark CONVERTED atomically (guarded against double-convert).
    const updated = await this.prisma.quote.updateMany({
      where: { id: quoteId, tenantId, status: 'ACCEPTED' },
      data: {
        status:              'CONVERTED',
        convertedAt:         new Date(),
        convertedToInvoiceId: invoice.id,
      },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Quote was no longer in ACCEPTED status — conversion aborted.');
    }

    return this.findOne(tenantId, quoteId);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    opts: {
      page?:       number;
      pageSize?:   number;
      customerId?: string;
      status?:     QuoteStatus;
      from?:       string;
      to?:         string;
    },
  ) {
    const page     = opts.page     ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.QuoteWhereInput = { tenantId };

    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.status)     where.status     = opts.status;
    if (opts.from)       where.quoteDate  = { ...(where.quoteDate as object ?? {}), gte: new Date(opts.from) };
    if (opts.to)         where.quoteDate  = { ...(where.quoteDate as object ?? {}), lte: new Date(opts.to) };

    const [data, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        orderBy: [{ quoteDate: 'desc' }, { quoteNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          customer: { select: { id: true, name: true, tin: true } },
          branch:   { select: { id: true, name: true } },
          convertedInvoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
      this.prisma.quote.count({ where }),
    ]);

    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, quoteId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, tenantId },
      include: {
        lines:    { orderBy: { createdAt: 'asc' } },
        customer: true,
        branch:   { select: { id: true, name: true } },
        convertedInvoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
    if (!quote) throw new NotFoundException('Quote not found.');
    return quote;
  }
}
