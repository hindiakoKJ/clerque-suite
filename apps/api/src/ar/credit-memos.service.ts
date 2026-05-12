/**
 * CreditMemosService — AR credit memo CRUD + GL posting + invoice application.
 *
 * Lifecycle:
 *   create()  → DRAFT  (no GL impact, editable)
 *   update()  → DRAFT  → DRAFT (mutate while still draft)
 *   post()    → DRAFT  → POSTED (atomic GL: DR Sales Returns/Revenue · CR AR)
 *   apply()   → POSTED/APPLIED  (CreditMemoApplication rows;
 *                                decreases ARInvoice.balanceAmount; flips
 *                                memo → APPLIED when fully applied)
 *   void()    → POSTED/APPLIED → VOIDED (reverses JE, unwinds applications)
 *
 * GL posting (on POST) — by design we DO NOT reverse the original invoice's
 * JE. Per Xero/QB convention, the original stays OPEN/PAID and the credit
 * posts its own net-amount JE:
 *
 *   For VAT-registered tenants on a vatable line:
 *     DR Sales Returns / Revenue (per-line accountId) — net of VAT
 *     DR Output VAT (contra)                          — VAT portion
 *     CR Accounts Receivable                          — gross total
 *   For NON_VAT / UNREGISTERED:
 *     DR Sales Returns / Revenue (per-line accountId)
 *     CR Accounts Receivable
 *
 * Application against an invoice:
 *   The original invoice's JE is untouched; the credit-memo's JE has already
 *   moved the GL. Application only mutates the SUBLEDGER: it reduces
 *   ARInvoice.balanceAmount and updates the invoice status when balance hits
 *   zero. The AR control-account balance in the GL still ties to the sum of
 *   all open subledger balances because the credit-memo POST already credited
 *   AR by the same amount the application moves out of the invoice's balance.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { Prisma, CreditMemoStatus, type TaxStatus } from '@prisma/client';
import {
  CreateCreditMemoDto,
  UpdateCreditMemoDto,
  ApplyCreditMemoDto,
} from './dto/credit-memo.dto';

@Injectable()
export class CreditMemosService {
  constructor(
    private prisma:    PrismaService,
    private journal:   JournalService,
    private periods:   AccountingPeriodsService,
    private numbering: NumberingService,
    private audit:     AuditService,
  ) {}

  // ── COA lookups (mirror ar-invoices.service.ts) ────────────────────────────

  private async findArReceivablesAccount(tenantId: string): Promise<string> {
    const byCode = await this.prisma.account.findFirst({
      where: { tenantId, code: '1300', isActive: true },
      select: { id: true },
    });
    if (byCode) return byCode.id;
    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId,
        type: 'ASSET',
        isActive: true,
        OR: [
          { name: { contains: 'receivable', mode: 'insensitive' } },
          { name: { contains: 'AR',         mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (fallback) return fallback.id;
    throw new BadRequestException(
      'No AR Receivables account found. Add one to your Chart of Accounts (e.g. code 1300, type ASSET).',
    );
  }

  private async findOutputVatAccount(tenantId: string): Promise<{ id: string } | null> {
    const byCode = await this.prisma.account.findFirst({
      where: { tenantId, code: '2020', isActive: true },
      select: { id: true },
    });
    if (byCode) return byCode;
    return this.prisma.account.findFirst({
      where: {
        tenantId, type: 'LIABILITY', isActive: true,
        name: { contains: 'output vat', mode: 'insensitive' },
      },
      select: { id: true },
    });
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateCreditMemoDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Credit memo must have at least one line.');
    }

    const customer = await this.prisma.customer.findFirst({
      where:  { id: dto.customerId, tenantId, isActive: true },
      select: { id: true },
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

    // Validate relatedInvoiceId belongs to this tenant + customer if supplied
    if (dto.relatedInvoiceId) {
      const inv = await this.prisma.aRInvoice.findFirst({
        where:  { id: dto.relatedInvoiceId, tenantId, customerId: dto.customerId },
        select: { id: true },
      });
      if (!inv) throw new BadRequestException('relatedInvoiceId is not a valid invoice for this customer.');
    }

    const memoDate    = new Date(dto.memoDate);
    const postingDate = dto.postingDate ? new Date(dto.postingDate) : memoDate;

    const subtotal  = dto.lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0);
    const vatAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
    const total     = dto.lines.reduce((s, l) => s + l.lineTotal, 0);

    return this.prisma.$transaction(async (tx) => {
      const memoNumber = await this.numbering.next(tenantId, 'AR_CREDIT_MEMO', null, tx);

      return tx.creditMemo.create({
        data: {
          tenantId,
          branchId:        dto.branchId ?? null,
          memoNumber,
          customerId:      dto.customerId,
          memoDate,
          postingDate,
          reason:          dto.reason ?? 'OTHER',
          reasonNotes:     dto.reasonNotes,
          relatedInvoiceId: dto.relatedInvoiceId,
          subtotal:        new Prisma.Decimal(subtotal),
          vatAmount:       new Prisma.Decimal(vatAmount),
          totalAmount:     new Prisma.Decimal(total),
          appliedAmount:   new Prisma.Decimal(0),
          unappliedAmount: new Prisma.Decimal(total),
          status:          'DRAFT',
          description:     dto.description,
          notes:           dto.notes,
          createdById:     userId,
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

  async update(tenantId: string, memoId: string, userId: string, dto: UpdateCreditMemoDto) {
    const memo = await this.prisma.creditMemo.findFirst({
      where:  { id: memoId, tenantId },
      select: { id: true, status: true, customerId: true },
    });
    if (!memo) throw new NotFoundException('Credit memo not found.');
    if (memo.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot update credit memo in status ${memo.status}.`);
    }

    // If lines are being replaced, validate them.
    if (dto.lines) {
      if (dto.lines.length === 0) {
        throw new BadRequestException('Credit memo must have at least one line.');
      }
      const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
      const validAccounts = await this.prisma.account.count({
        where: { id: { in: accountIds }, tenantId, isActive: true },
      });
      if (validAccounts !== accountIds.length) {
        throw new BadRequestException('One or more line accounts are invalid for this tenant.');
      }
    }
    if (dto.relatedInvoiceId) {
      const inv = await this.prisma.aRInvoice.findFirst({
        where:  { id: dto.relatedInvoiceId, tenantId, customerId: memo.customerId },
        select: { id: true },
      });
      if (!inv) throw new BadRequestException('relatedInvoiceId is not a valid invoice for this customer.');
    }

    return this.prisma.$transaction(async (tx) => {
      const patch: Prisma.CreditMemoUpdateInput = {};
      if (dto.memoDate)     patch.memoDate    = new Date(dto.memoDate);
      if (dto.postingDate)  patch.postingDate = new Date(dto.postingDate);
      if (dto.reason)       patch.reason      = dto.reason;
      if (dto.reasonNotes !== undefined) patch.reasonNotes = dto.reasonNotes;
      if (dto.relatedInvoiceId !== undefined) patch.relatedInvoiceId = dto.relatedInvoiceId;
      if (dto.description !== undefined) patch.description = dto.description;
      if (dto.notes !== undefined)       patch.notes = dto.notes;

      if (dto.lines) {
        const subtotal  = dto.lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0);
        const vatAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
        const total     = dto.lines.reduce((s, l) => s + l.lineTotal, 0);
        patch.subtotal        = new Prisma.Decimal(subtotal);
        patch.vatAmount       = new Prisma.Decimal(vatAmount);
        patch.totalAmount     = new Prisma.Decimal(total);
        patch.unappliedAmount = new Prisma.Decimal(total);

        await tx.creditMemoLine.deleteMany({ where: { memoId } });
        patch.lines = {
          create: dto.lines.map((l) => ({
            accountId:   l.accountId,
            description: l.description,
            quantity:    new Prisma.Decimal(l.quantity ?? 1),
            unitPrice:   new Prisma.Decimal(l.unitPrice),
            taxAmount:   new Prisma.Decimal(l.taxAmount ?? 0),
            lineTotal:   new Prisma.Decimal(l.lineTotal),
          })),
        };
      }

      // Atomic + tenant-scoped + still-DRAFT guard
      const guard = await tx.creditMemo.updateMany({
        where: { id: memoId, tenantId, status: 'DRAFT' },
        data:  { updatedAt: new Date() },
      });
      if (guard.count === 0) {
        throw new ConflictException('Credit memo is no longer in DRAFT status.');
      }
      return tx.creditMemo.update({
        where: { id: memoId },
        data:  patch,
        include: { lines: true, customer: { select: { id: true, name: true } } },
      });
    });
  }

  /**
   * Post a DRAFT memo → POSTED. Period-lock and posting-control enforced by
   * journal.service (we pass source='AR' to satisfy AR_ONLY posting control
   * on the receivables account).
   */
  async post(tenantId: string, memoId: string, userId: string) {
    const memo = await this.prisma.creditMemo.findFirst({
      where:   { id: memoId, tenantId },
      include: { lines: true, customer: { select: { name: true } } },
    });
    if (!memo) throw new NotFoundException('Credit memo not found.');
    if (memo.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot post credit memo in status ${memo.status}.`);
    }

    // Period-lock guard up-front so we fail fast with a clean message.
    await this.periods.assertDateIsOpen(tenantId, memo.postingDate);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: { taxStatus: true },
    });
    const isVatRegistered = (tenant.taxStatus as TaxStatus) === 'VAT';

    const arAccountId = await this.findArReceivablesAccount(tenantId);
    const vatAccount  = isVatRegistered ? await this.findOutputVatAccount(tenantId) : null;
    if (isVatRegistered && Number(memo.vatAmount) > 0 && !vatAccount) {
      throw new BadRequestException(
        'VAT-registered tenant has no Output VAT account. Add one to your COA (e.g. code 2020, type LIABILITY) before posting.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const totalAmount = Number(memo.totalAmount);
      const vatAmount   = Number(memo.vatAmount);
      const lines: Array<{ accountId: string; debit?: number; credit?: number; description?: string }> = [];

      // Debit each line's revenue / sales-returns account (net of VAT)
      for (const line of memo.lines) {
        const lineNet = Number(line.lineTotal) - Number(line.taxAmount);
        if (lineNet > 0) {
          lines.push({
            accountId:   line.accountId,
            debit:       lineNet,
            description: line.description ?? `Credit memo ${memo.memoNumber}`,
          });
        }
      }
      // Debit Output VAT contra (reverses the original sale's VAT)
      if (vatAccount && vatAmount > 0) {
        lines.push({
          accountId:   vatAccount.id,
          debit:       vatAmount,
          description: `Output VAT reversal — ${memo.memoNumber}`,
        });
      }
      // Credit AR for the gross total
      lines.push({
        accountId:   arAccountId,
        credit:      totalAmount,
        description: `${memo.customer.name} - ${memo.memoNumber}`,
      });

      const je = await this.journal.create(
        tenantId,
        {
          date:        memo.memoDate.toISOString(),
          postingDate: memo.postingDate.toISOString(),
          description: `AR Credit Memo ${memo.memoNumber} — ${memo.customer.name}`,
          reference:   memo.memoNumber,
          saveDraft:   false,
          lines,
        },
        userId,
        'AR',
      );

      // TOCTOU: tenant-scoped, status-conditional flip.
      const claim = await tx.creditMemo.updateMany({
        where: { id: memo.id, tenantId, status: 'DRAFT' },
        data: {
          status:         'POSTED',
          postedById:     userId,
          postedAt:       new Date(),
          journalEntryId: je.id,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Credit memo was already posted concurrently.');
      }

      // Audit D3-07. Reuse AR_INVOICE_POSTED — closest existing enum value;
      // entityType="CreditMemo" disambiguates in reporting.
      void this.audit.log({
        tenantId,
        action:      'AR_INVOICE_POSTED',
        entityType:  'CreditMemo',
        entityId:    memo.id,
        performedBy: userId,
        description: `AR credit memo ${memo.memoNumber} posted (customer ${memo.customer.name}, ₱${Number(memo.totalAmount).toFixed(2)})`,
        before:      { status: 'DRAFT' },
        after:       {
          status:         'POSTED',
          memoNumber:     memo.memoNumber,
          totalAmount:    Number(memo.totalAmount),
          journalEntryId: je.id,
        },
      });

      return tx.creditMemo.findFirstOrThrow({
        where: { id: memo.id, tenantId },
        include: {
          lines:        true,
          customer:     { select: { id: true, name: true } },
          journalEntry: { select: { id: true, entryNumber: true } },
        },
      });
    }, { timeout: 30_000 });
  }

  /**
   * Apply a POSTED memo against an open AR invoice. Mirrors the
   * payment-application pattern; no GL impact (the credit-memo POST already
   * moved AR; application just shifts the subledger balance from invoice to
   * credit consumed).
   */
  async apply(tenantId: string, memoId: string, userId: string, dto: ApplyCreditMemoDto) {
    if (dto.amount <= 0) throw new BadRequestException('amount must be > 0.');

    const memo = await this.prisma.creditMemo.findFirst({
      where: { id: memoId, tenantId },
    });
    if (!memo) throw new NotFoundException('Credit memo not found.');
    if (memo.status !== 'POSTED' && memo.status !== 'APPLIED') {
      throw new BadRequestException(`Cannot apply credit memo in status ${memo.status}.`);
    }

    const remaining = Number(memo.unappliedAmount);
    if (dto.amount > remaining + 0.01) {
      throw new BadRequestException(
        `Cannot apply ${dto.amount.toFixed(2)} — only ${remaining.toFixed(2)} unapplied on this memo.`,
      );
    }

    const invoice = await this.prisma.aRInvoice.findFirst({
      where:  { id: dto.invoiceId, tenantId, customerId: memo.customerId },
      select: { id: true, status: true, balanceAmount: true, totalAmount: true, paidAmount: true, invoiceNumber: true },
    });
    if (!invoice) throw new BadRequestException(`Invoice ${dto.invoiceId} not found for this customer.`);
    if (!['OPEN', 'PARTIALLY_PAID'].includes(invoice.status)) {
      throw new BadRequestException(`Invoice ${invoice.invoiceNumber} is in status ${invoice.status} — cannot apply credit.`);
    }
    if (dto.amount > Number(invoice.balanceAmount) + 0.01) {
      throw new BadRequestException(
        `Cannot apply ${dto.amount.toFixed(2)} to ${invoice.invoiceNumber} — balance is only ${Number(invoice.balanceAmount).toFixed(2)}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Application row (junction)
      await tx.creditMemoApplication.create({
        data: {
          memoId:        memo.id,
          invoiceId:     invoice.id,
          appliedAmount: new Prisma.Decimal(dto.amount),
          appliedById:   userId,
        },
      });

      // Recompute memo applied/unapplied + status
      const sumMemo = await tx.creditMemoApplication.aggregate({
        where: { memoId: memo.id },
        _sum:  { appliedAmount: true },
      });
      const totalAppliedOnMemo = Number(sumMemo._sum.appliedAmount ?? 0);
      const memoTotal          = Number(memo.totalAmount);
      const memoUnapplied      = Math.max(0, memoTotal - totalAppliedOnMemo);
      const memoStatus: CreditMemoStatus =
        memoUnapplied <= 0.01 ? 'APPLIED' : 'POSTED';

      await tx.creditMemo.update({
        where: { id: memo.id },
        data: {
          appliedAmount:   new Prisma.Decimal(totalAppliedOnMemo),
          unappliedAmount: new Prisma.Decimal(memoUnapplied),
          status:          memoStatus,
        },
      });

      // Mutate invoice subledger balance + status
      const newBalance = Math.max(0, Number(invoice.balanceAmount) - dto.amount);
      const newPaid    = Number(invoice.totalAmount) - newBalance;
      const newStatus =
        newBalance <= 0.01                          ? 'PAID' :
        newPaid    >  0.01                          ? 'PARTIALLY_PAID' :
                                                       invoice.status;

      await tx.aRInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount:    new Prisma.Decimal(newPaid),
          balanceAmount: new Prisma.Decimal(newBalance),
          status:        newStatus,
        },
      });

      void this.audit.log({
        tenantId,
        action:      'AR_INVOICE_POSTED', // closest existing enum; entityType disambiguates
        entityType:  'CreditMemoApplication',
        entityId:    memo.id,
        performedBy: userId,
        description: `Credit memo ${memo.memoNumber} applied ₱${dto.amount.toFixed(2)} to invoice ${invoice.invoiceNumber}`,
        after:       {
          memoId:    memo.id,
          invoiceId: invoice.id,
          amount:    dto.amount,
          memoStatus,
          invoiceStatus: newStatus,
        },
      });

      return tx.creditMemo.findFirstOrThrow({
        where: { id: memo.id, tenantId },
        include: {
          applications: { include: { invoice: { select: { id: true, invoiceNumber: true, balanceAmount: true, status: true } } } },
        },
      });
    }, { timeout: 30_000 });
  }

  /**
   * Void a POSTED or APPLIED credit memo. Reverses the GL JE and unwinds all
   * applications, restoring the invoice balances to what they would have been
   * if the memo had never been posted.
   */
  async void(tenantId: string, memoId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (>= 5 characters).');
    }

    const memo = await this.prisma.creditMemo.findFirst({
      where:   { id: memoId, tenantId },
      include: { applications: { select: { invoiceId: true, appliedAmount: true } } },
    });
    if (!memo) throw new NotFoundException('Credit memo not found.');
    if (memo.status === 'VOIDED') {
      throw new BadRequestException('Credit memo is already voided.');
    }
    if (memo.status === 'DRAFT') {
      throw new BadRequestException('Cannot void a DRAFT credit memo — delete or cancel it instead.');
    }
    if (!memo.journalEntryId) {
      throw new BadRequestException('Credit memo has no posted JE to reverse.');
    }

    // Period-lock at void time too.
    await this.periods.assertDateIsOpen(tenantId, new Date());

    return this.prisma.$transaction(async (tx) => {
      // TOCTOU claim
      const claim = await tx.creditMemo.updateMany({
        where: { id: memo.id, tenantId, status: { in: ['POSTED', 'APPLIED'] } },
        data: {
          status:          'VOIDED',
          voidedById:      userId,
          voidedAt:        new Date(),
          voidReason:      reason.trim(),
          appliedAmount:   new Prisma.Decimal(0),
          unappliedAmount: memo.totalAmount,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Credit memo was already voided concurrently.');
      }

      // Reverse the JE
      await this.journal.reverse(tenantId, memo.journalEntryId!, userId);

      // Unwind applications — restore each invoice's balance.
      for (const app of memo.applications) {
        const inv = await tx.aRInvoice.findUnique({
          where:  { id: app.invoiceId },
          select: { totalAmount: true, paidAmount: true, balanceAmount: true, status: true },
        });
        if (!inv) continue; // invoice already deleted somehow — skip
        const amt        = Number(app.appliedAmount);
        const newBalance = Math.min(Number(inv.totalAmount), Number(inv.balanceAmount) + amt);
        const newPaid    = Math.max(0, Number(inv.paidAmount) - amt);
        const newStatus  =
          inv.status === 'VOIDED' || inv.status === 'CANCELLED' ? inv.status :
          newBalance >= Number(inv.totalAmount) - 0.01           ? 'OPEN' :
          newPaid    >  0.01                                      ? 'PARTIALLY_PAID' :
                                                                   'OPEN';
        await tx.aRInvoice.update({
          where: { id: app.invoiceId },
          data: {
            paidAmount:    new Prisma.Decimal(newPaid),
            balanceAmount: new Prisma.Decimal(newBalance),
            status:        newStatus,
          },
        });
      }
      await tx.creditMemoApplication.deleteMany({ where: { memoId: memo.id } });

      void this.audit.log({
        tenantId,
        action:      'AR_INVOICE_VOIDED',
        entityType:  'CreditMemo',
        entityId:    memo.id,
        performedBy: userId,
        description: `AR credit memo ${memo.memoNumber} voided: ${reason.trim().slice(0, 200)}`,
        before:      { status: memo.status },
        after:       { status: 'VOIDED', voidReason: reason.trim() },
      });

      return tx.creditMemo.findFirstOrThrow({ where: { id: memo.id, tenantId } });
    }, { timeout: 30_000 });
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    opts: {
      page?:       number;
      pageSize?:   number;
      customerId?: string;
      status?:     CreditMemoStatus | CreditMemoStatus[];
      from?:       string;
      to?:         string;
    },
  ) {
    const page     = opts.page     ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.CreditMemoWhereInput = { tenantId };
    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.status) where.status = Array.isArray(opts.status) ? { in: opts.status } : opts.status;
    if (opts.from || opts.to) {
      where.postingDate = {};
      if (opts.from) (where.postingDate as { gte?: Date }).gte = new Date(opts.from);
      if (opts.to)   (where.postingDate as { lte?: Date }).lte = new Date(opts.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.creditMemo.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { memoNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          customer: { select: { id: true, name: true } },
          branch:   { select: { id: true, name: true } },
        },
      }),
      this.prisma.creditMemo.count({ where }),
    ]);
    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, memoId: string) {
    const memo = await this.prisma.creditMemo.findFirst({
      where: { id: memoId, tenantId },
      include: {
        lines:    { include: { account: { select: { code: true, name: true } } } },
        customer: true,
        branch:   { select: { id: true, name: true } },
        applications: {
          include: { invoice: { select: { id: true, invoiceNumber: true, balanceAmount: true, status: true } } },
          orderBy: { appliedAt: 'asc' },
        },
        journalEntry: { select: { id: true, entryNumber: true, status: true } },
      },
    });
    if (!memo) throw new NotFoundException('Credit memo not found.');
    return memo;
  }
}
