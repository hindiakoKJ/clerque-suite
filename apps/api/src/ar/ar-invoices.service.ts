/**
 * ARInvoicesService — formal customer-invoice CRUD + GL posting + status.
 *
 * Lifecycle:
 *   create()  → DRAFT (no GL impact, can be edited)
 *   post()    → DRAFT → OPEN (creates a balanced JE atomically)
 *   void()    → OPEN/PARTIALLY_PAID/PAID → VOIDED (creates a reversal JE)
 *   cancel()  → DRAFT → CANCELLED (no GL impact, kept for audit)
 *
 * Status transitions on payment (handled by ARPaymentsService):
 *   OPEN ↔ PARTIALLY_PAID ↔ PAID (driven by paidAmount vs totalAmount)
 *
 * GL posting (on POST):
 *   For VAT-registered tenants on a vatable line:
 *     DR  AR Receivables (sum of line totals + VAT)
 *     CR  Revenue (per-line accountId)
 *     CR  Output VAT
 *   For NON_VAT / UNREGISTERED tenants:
 *     DR  AR Receivables (sum of line totals)
 *     CR  Revenue (per-line accountId)
 *
 * AR Receivables account is looked up by code (1300 standard PH) or falls
 * back to the first account where type=ASSET and name contains "receivable".
 * Output VAT account: lookup by code 2020 or name contains "output vat".
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma, InvoiceStatus, type TaxStatus } from '@prisma/client';

interface InvoiceLineInput {
  accountId:   string;
  description?: string;
  quantity?:   number;
  unitPrice:   number;
  taxAmount?:  number;
  lineTotal:   number;       // = (quantity * unitPrice) + taxAmount; client computes
}

export interface CreateInvoiceDto {
  customerId:   string;
  branchId?:    string;
  invoiceDate:  string;       // ISO date
  postingDate?: string;       // defaults to invoiceDate
  termsDays?:   number;       // null → use customer.creditTermDays
  reference?:   string;
  description?: string;
  notes?:       string;
  lines:        InvoiceLineInput[];
}

@Injectable()
export class ARInvoicesService {
  constructor(
    private prisma:    PrismaService,
    private journal:   JournalService,
    private periods:   AccountingPeriodsService,
    private numbering: NumberingService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  /** Find the canonical AR Receivables account for a tenant. */
  private async findArReceivablesAccount(tenantId: string): Promise<{ id: string; code: string }> {
    // 1. Try code 1300 (standard PH SFRS chart)
    const byCode = await this.prisma.account.findFirst({
      where: { tenantId, code: '1300', isActive: true },
      select: { id: true, code: true },
    });
    if (byCode) return byCode;

    // 2. Fall back to any active asset account whose name mentions "receivable"
    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId,
        type:  'ASSET',
        isActive: true,
        OR: [
          { name: { contains: 'receivable', mode: 'insensitive' } },
          { name: { contains: 'AR',         mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true },
    });
    if (fallback) return fallback;

    throw new BadRequestException(
      'No AR Receivables account found. Add one to your Chart of Accounts (e.g. code 1300, type ASSET).',
    );
  }

  /** Find the canonical Output VAT account for a tenant. */
  private async findOutputVatAccount(tenantId: string): Promise<{ id: string; code: string } | null> {
    const byCode = await this.prisma.account.findFirst({
      where: { tenantId, code: '2020', isActive: true },
      select: { id: true, code: true },
    });
    if (byCode) return byCode;

    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId,
        type:  'LIABILITY',
        isActive: true,
        name:  { contains: 'output vat', mode: 'insensitive' },
      },
      select: { id: true, code: true },
    });
    return fallback;
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /** Create a DRAFT invoice. No GL impact. */
  async create(tenantId: string, userId: string, dto: CreateInvoiceDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Invoice must have at least one line.');
    }

    const customer = await this.prisma.customer.findFirst({
      where:  { id: dto.customerId, tenantId, isActive: true },
      select: { id: true, creditTermDays: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');

    // Validate accounts on every line
    const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
    const validAccounts = await this.prisma.account.count({
      where: { id: { in: accountIds }, tenantId, isActive: true },
    });
    if (validAccounts !== accountIds.length) {
      throw new BadRequestException('One or more line accounts are invalid for this tenant.');
    }

    const invoiceDate = new Date(dto.invoiceDate);
    const postingDate = dto.postingDate ? new Date(dto.postingDate) : invoiceDate;
    const termsDays   = dto.termsDays ?? customer.creditTermDays ?? 0;
    const dueDate     = this.addDays(invoiceDate, termsDays);

    const subtotal  = dto.lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0);
    const vatAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
    const total     = dto.lines.reduce((s, l) => s + l.lineTotal, 0);

    return this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.numbering.next(tenantId, 'AR_INVOICE', null, tx);

      return tx.aRInvoice.create({
        data: {
          tenantId,
          branchId:      dto.branchId ?? null,
          invoiceNumber,
          reference:     dto.reference,
          customerId:    dto.customerId,
          invoiceDate,
          postingDate,
          dueDate,
          termsDays,
          subtotal:      new Prisma.Decimal(subtotal),
          vatAmount:     new Prisma.Decimal(vatAmount),
          totalAmount:   new Prisma.Decimal(total),
          paidAmount:    new Prisma.Decimal(0),
          balanceAmount: new Prisma.Decimal(total),
          status:        'DRAFT',
          description:   dto.description,
          notes:         dto.notes,
          createdById:   userId,
          lines: {
            create: dto.lines.map((l) => ({
              accountId:   l.accountId,
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

  /**
   * Post a DRAFT invoice → OPEN. Creates the GL journal entry inside one
   * transaction. Period-lock check applies via journal.service.
   */
  async post(tenantId: string, invoiceId: string, userId: string) {
    const invoice = await this.prisma.aRInvoice.findFirst({
      where:   { id: invoiceId, tenantId },
      include: { lines: true, customer: { select: { name: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot post invoice in status ${invoice.status}.`);
    }

    // Tax status drives whether VAT is split out
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: { taxStatus: true },
    });
    const isVatRegistered = (tenant.taxStatus as TaxStatus) === 'VAT';

    const arAccount = await this.findArReceivablesAccount(tenantId);
    const vatAccount = isVatRegistered ? await this.findOutputVatAccount(tenantId) : null;
    if (isVatRegistered && Number(invoice.vatAmount) > 0 && !vatAccount) {
      throw new BadRequestException(
        'VAT-registered tenant has no Output VAT account. Add one to your COA (e.g. code 2020, type LIABILITY) before posting.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Build the JE: DR AR / CR Revenue + Output VAT
      const totalAmount = Number(invoice.totalAmount);
      const vatAmount   = Number(invoice.vatAmount);
      const lines: Array<{ accountId: string; debit?: number; credit?: number; description?: string }> = [];

      // Debit AR for the gross total
      lines.push({
        accountId:   arAccount.id,
        debit:       totalAmount,
        description: `${invoice.customer.name} - ${invoice.invoiceNumber}`,
      });

      // Credit each line's revenue account
      for (const line of invoice.lines) {
        const lineNet = Number(line.lineTotal) - Number(line.taxAmount);
        if (lineNet > 0) {
          lines.push({
            accountId:   line.accountId,
            credit:      lineNet,
            description: line.description ?? undefined,
          });
        }
      }

      // Credit Output VAT (if VAT-registered + non-zero VAT)
      if (vatAccount && vatAmount > 0) {
        lines.push({
          accountId:   vatAccount.id,
          credit:      vatAmount,
          description: 'Output VAT',
        });
      }

      // Post the JE — period-lock + balance check enforced by journal.service
      const je = await this.journal.create(
        tenantId,
        {
          date:        invoice.invoiceDate.toISOString(),
          postingDate: invoice.postingDate.toISOString(),
          description: `AR Invoice ${invoice.invoiceNumber} — ${invoice.customer.name}`,
          reference:   invoice.invoiceNumber,
          saveDraft:   false,
          lines,
        },
        userId,
      );

      // Move invoice to OPEN + link to JE
      return tx.aRInvoice.update({
        where: { id: invoice.id },
        data: {
          status:         'OPEN',
          postedById:     userId,
          postedAt:       new Date(),
          journalEntryId: je.id,
        },
        include: { lines: true, customer: { select: { id: true, name: true } } },
      });
    }, { timeout: 30_000 });
  }

  /**
   * Void a posted invoice. Creates a reversal JE so the GL stays balanced.
   * Drops paidAmount / balanceAmount to zero — pending payment applications
   * are NOT auto-removed; they'll show as unapplied credit on the customer
   * which the user can re-apply or refund manually.
   */
  async void(tenantId: string, invoiceId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (>= 5 characters).');
    }

    const invoice = await this.prisma.aRInvoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (!['OPEN', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status)) {
      throw new BadRequestException(`Cannot void invoice in status ${invoice.status}.`);
    }
    if (!invoice.journalEntryId) {
      throw new BadRequestException('Invoice has no posted JE to reverse.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Reverse the JE — journal.service handles flipping debits/credits
      await this.journal.reverse(tenantId, invoice.journalEntryId!, userId);

      return tx.aRInvoice.update({
        where: { id: invoice.id },
        data: {
          status:     'VOIDED',
          voidedById: userId,
          voidedAt:   new Date(),
          voidReason: reason.trim(),
        },
      });
    }, { timeout: 30_000 });
  }

  /** Cancel a DRAFT invoice (no GL impact, kept for audit). */
  async cancel(tenantId: string, invoiceId: string, userId: string, reason: string) {
    const invoice = await this.prisma.aRInvoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status !== 'DRAFT') {
      throw new ForbiddenException('Only DRAFT invoices can be cancelled. Use Void for posted invoices.');
    }
    return this.prisma.aRInvoice.update({
      where: { id: invoiceId },
      data:  { status: 'CANCELLED', voidedById: userId, voidedAt: new Date(), voidReason: reason },
    });
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    opts: {
      page?:       number;
      pageSize?:   number;
      customerId?: string;
      status?:     InvoiceStatus | InvoiceStatus[];
      from?:       string;     // postingDate >= from
      to?:         string;     // postingDate <= to
      onlyOpen?:   boolean;    // shortcut: status in OPEN, PARTIALLY_PAID
      onlyOverdue?: boolean;   // open + dueDate < today
    },
  ) {
    const page     = opts.page     ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.ARInvoiceWhereInput = { tenantId };

    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.status)     where.status     = Array.isArray(opts.status) ? { in: opts.status } : opts.status;
    if (opts.from)       where.postingDate = { ...(where.postingDate as object ?? {}), gte: new Date(opts.from) };
    if (opts.to)         where.postingDate = { ...(where.postingDate as object ?? {}), lte: new Date(opts.to) };
    if (opts.onlyOpen)   where.status     = { in: ['OPEN', 'PARTIALLY_PAID'] };
    if (opts.onlyOverdue) {
      where.status   = { in: ['OPEN', 'PARTIALLY_PAID'] };
      where.dueDate  = { lt: new Date() };
    }

    const [data, total] = await Promise.all([
      this.prisma.aRInvoice.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { invoiceNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          customer: { select: { id: true, name: true, tin: true } },
          branch:   { select: { id: true, name: true } },
        },
      }),
      this.prisma.aRInvoice.count({ where }),
    ]);

    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.aRInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: {
        lines:    { include: { account: { select: { code: true, name: true } } } },
        customer: true,
        branch:   { select: { id: true, name: true } },
        applications: {
          include: { payment: { select: { id: true, paymentNumber: true, paymentDate: true, method: true } } },
          orderBy: { appliedAt: 'asc' },
        },
        journalEntry: { select: { id: true, entryNumber: true, status: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }
}
