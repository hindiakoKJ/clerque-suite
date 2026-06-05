/**
 * CustomerAdvancesService — Sprint 22.
 *
 * Customer down payments / deposits received BEFORE invoicing. Sits as a
 * liability (we owe goods/services to the customer) until applied against
 * an actual ARInvoice.
 *
 * Lifecycle:
 *   create() → DRAFT  (no GL impact)
 *   post()   → POSTED (DR Cash · CR Customer Deposits Liability)
 *   apply()  → decreases ARInvoice.balanceAmount + bumps appliedAmount.
 *              When unappliedAmount hits 0 → status = APPLIED.
 *   refund() → terminal. DR Liability · CR Cash for unappliedAmount → REFUNDED
 *   void()   → reverses the original posting JE → VOIDED
 *
 * Account discovery: looks up "Customer Deposits" by COA codes 2031 or 2030.
 * If neither exists, throws BadRequest pointing the user to /ledger/accounts.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertBranchInTenant } from '../common/tenant-fk-guards';
import { JournalService } from '../accounting/journal.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { Prisma, type PaymentMethod, AuditAction } from '@prisma/client';
import {
  CreateCustomerAdvanceDto,
  ApplyCustomerAdvanceDto,
  RefundCustomerAdvanceDto,
} from './dto/customer-advance.dto';

@Injectable()
export class CustomerAdvancesService {
  constructor(
    private prisma:    PrismaService,
    private journal:   JournalService,
    private periods:   AccountingPeriodsService,
    private numbering: NumberingService,
    private audit:     AuditService,
  ) {}

  // ── Account discovery ─────────────────────────────────────────────────────

  /**
   * Find the tenant's Customer Deposits Liability account. Tries seeded COA
   * codes 2031 then 2030. Throws a friendly error if neither exists.
   */
  private async getCustomerDepositsLiabilityAccountId(tenantId: string): Promise<string> {
    for (const code of ['2031', '2030']) {
      const a = await this.prisma.account.findFirst({
        where:  { tenantId, code, isActive: true },
        select: { id: true },
      });
      if (a) return a.id;
    }
    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId, type: 'LIABILITY', isActive: true,
        OR: [
          { name: { contains: 'customer deposit',  mode: 'insensitive' } },
          { name: { contains: 'customer advance',  mode: 'insensitive' } },
          { name: { contains: 'unearned revenue',  mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (fallback) return fallback.id;
    throw new BadRequestException(
      'Customer Deposits Liability account not found in your Chart of Accounts. ' +
      'Create an account with code 2031 (or 2030) under Ledger → Chart of Accounts.',
    );
  }

  private async findCashAccountForMethod(tenantId: string, method: PaymentMethod): Promise<string> {
    const search: Record<PaymentMethod, string[]> = {
      CASH:           ['cash on hand', 'cash'],
      GCASH_PERSONAL: ['gcash', 'cash'],
      GCASH_BUSINESS: ['gcash', 'cash'],
      MAYA_PERSONAL:  ['maya', 'cash'],
      MAYA_BUSINESS:  ['maya', 'cash'],
      QR_PH:          ['cash in bank', 'bank', 'cash'],
      CARD:           ['cash in bank', 'bank', 'card', 'cash'],
    };
    for (const term of search[method] ?? ['cash']) {
      const acct = await this.prisma.account.findFirst({
        where: { tenantId, type: 'ASSET', isActive: true, name: { contains: term, mode: 'insensitive' } },
        select: { id: true },
      });
      if (acct) return acct.id;
    }
    throw new BadRequestException(`No matching cash/bank account found for method ${method}.`);
  }

  // ── create (DRAFT) ────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateCustomerAdvanceDto) {
    if (dto.totalAmount <= 0) throw new BadRequestException('totalAmount must be > 0.');

    const customer = await this.prisma.customer.findFirst({
      where:  { id: dto.customerId, tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');

    const advanceDate = new Date(dto.advanceDate);
    const postingDate = dto.postingDate ? new Date(dto.postingDate) : advanceDate;


    // SecAudit 2026-05 T2 — assert dto.branchId belongs to this tenant.
    await assertBranchInTenant(this.prisma, tenantId, dto.branchId);

    return this.prisma.$transaction(async (tx) => {
      const advanceNumber = await this.numbering.next(tenantId, 'CUSTOMER_ADVANCE', null, tx);
      return tx.customerAdvance.create({
        data: {
          tenantId,
          branchId:        dto.branchId ?? null,
          advanceNumber,
          customerId:      dto.customerId,
          advanceDate,
          postingDate,
          method:          dto.method,
          reference:       dto.reference,
          totalAmount:     new Prisma.Decimal(dto.totalAmount),
          appliedAmount:   new Prisma.Decimal(0),
          unappliedAmount: new Prisma.Decimal(dto.totalAmount),
          status:          'DRAFT',
          description:     dto.description,
          notes:           dto.notes,
          createdById:     userId,
        },
        include: { customer: { select: { id: true, name: true } } },
      });
    });
  }

  // ── post (DRAFT → POSTED + emit JE) ───────────────────────────────────────

  async post(tenantId: string, advanceId: string, userId: string) {
    const advance = await this.prisma.customerAdvance.findFirst({
      where: { id: advanceId, tenantId },
      include: { customer: { select: { id: true, name: true } } },
    });
    if (!advance) throw new NotFoundException('Customer advance not found.');
    if (advance.status !== 'DRAFT') {
      throw new BadRequestException(`Advance is in status ${advance.status} — only DRAFT can be posted.`);
    }

    await this.periods.assertDateIsOpen(tenantId, advance.postingDate);

    const liabAccountId = await this.getCustomerDepositsLiabilityAccountId(tenantId);
    const cashAccountId = await this.findCashAccountForMethod(tenantId, advance.method);
    const amount = Number(advance.totalAmount);

    return this.prisma.$transaction(async (tx) => {
      // Idempotency: claim DRAFT → guard against concurrent posts
      const claim = await tx.customerAdvance.updateMany({
        where: { id: advance.id, tenantId, status: 'DRAFT' },
        data:  { status: 'POSTED', postedById: userId, postedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Advance was already posted concurrently.');
      }

      const je = await this.journal.create(
        tenantId,
        {
          date:        advance.advanceDate.toISOString(),
          postingDate: advance.postingDate.toISOString(),
          description: `Customer Advance ${advance.advanceNumber} — ${advance.customer.name}`,
          reference:   advance.reference ?? advance.advanceNumber,
          saveDraft:   false,
          lines: [
            { accountId: cashAccountId, debit:  amount, description: 'Customer deposit received' },
            { accountId: liabAccountId, credit: amount, description: `Deposit from ${advance.customer.name}` },
          ],
        },
        userId,
      );

      await tx.customerAdvance.update({
        where: { id: advance.id },
        data:  { journalEntryId: je.id },
      });

      void this.audit.log({
        tenantId,
        action:      AuditAction.JOURNAL_POSTED,
        entityType:  'CustomerAdvance',
        entityId:    advance.id,
        performedBy: userId,
        description: `Customer advance ${advance.advanceNumber} posted (${advance.customer.name}, P${amount.toFixed(2)})`,
        before:      { status: 'DRAFT' },
        after:       { status: 'POSTED', journalEntryId: je.id },
      });

      return tx.customerAdvance.findFirstOrThrow({
        where:   { id: advance.id },
        include: {
          customer:     { select: { id: true, name: true } },
          journalEntry: { select: { id: true, entryNumber: true } },
        },
      });
    }, { timeout: 30_000 });
  }

  // ── apply (POSTED → applied against an invoice) ───────────────────────────

  async apply(tenantId: string, advanceId: string, userId: string, dto: ApplyCustomerAdvanceDto) {
    if (dto.amount <= 0) throw new BadRequestException('amount must be > 0.');

    const advance = await this.prisma.customerAdvance.findFirst({
      where: { id: advanceId, tenantId },
    });
    if (!advance) throw new NotFoundException('Customer advance not found.');
    if (advance.status !== 'POSTED' && advance.status !== 'APPLIED') {
      throw new BadRequestException(`Advance is in status ${advance.status} — cannot apply.`);
    }
    if (Number(advance.unappliedAmount) < dto.amount - 0.01) {
      throw new BadRequestException(
        `Cannot apply ${dto.amount.toFixed(2)} — only ${Number(advance.unappliedAmount).toFixed(2)} remains unapplied.`,
      );
    }

    // Period lock guard
    await this.periods.assertDateIsOpen(tenantId, new Date());

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.aRInvoice.findFirst({
        where:  { id: dto.invoiceId, tenantId, customerId: advance.customerId },
        select: { id: true, status: true, balanceAmount: true, paidAmount: true, totalAmount: true, invoiceNumber: true },
      });
      if (!invoice) throw new BadRequestException('Invoice not found for this customer.');
      if (!['OPEN', 'PARTIALLY_PAID'].includes(invoice.status)) {
        throw new BadRequestException(`Invoice ${invoice.invoiceNumber} is in status ${invoice.status} — cannot apply advance.`);
      }
      if (dto.amount > Number(invoice.balanceAmount) + 0.01) {
        throw new BadRequestException(
          `Cannot apply ${dto.amount.toFixed(2)} to ${invoice.invoiceNumber} — balance ${Number(invoice.balanceAmount).toFixed(2)}.`,
        );
      }

      await tx.customerAdvanceApplication.create({
        data: {
          advanceId:     advance.id,
          invoiceId:     invoice.id,
          appliedAmount: new Prisma.Decimal(dto.amount),
          appliedById:   userId,
        },
      });

      const newApplied   = Number(advance.appliedAmount) + dto.amount;
      const newUnapplied = Number(advance.totalAmount) - newApplied;
      const fullyApplied = newUnapplied <= 0.01;

      const updatedAdvance = await tx.customerAdvance.update({
        where: { id: advance.id },
        data: {
          appliedAmount:   new Prisma.Decimal(newApplied),
          unappliedAmount: new Prisma.Decimal(Math.max(0, newUnapplied)),
          status:          fullyApplied ? 'APPLIED' : advance.status,
        },
      });

      // Decrease invoice balance + status
      const newPaid    = Number(invoice.paidAmount) + dto.amount;
      const newBalance = Number(invoice.totalAmount) - newPaid;
      let newStatus   = invoice.status;
      if (newPaid + 0.01 >= Number(invoice.totalAmount)) newStatus = 'PAID';
      else if (newPaid > 0.01)                           newStatus = 'PARTIALLY_PAID';

      await tx.aRInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount:    new Prisma.Decimal(newPaid),
          balanceAmount: new Prisma.Decimal(Math.max(0, newBalance)),
          status:        newStatus,
        },
      });

      void this.audit.log({
        tenantId,
        action:      AuditAction.JOURNAL_POSTED,
        entityType:  'CustomerAdvanceApplication',
        entityId:    advance.id,
        performedBy: userId,
        description: `Applied P${dto.amount.toFixed(2)} of advance ${advance.advanceNumber} to invoice ${invoice.invoiceNumber}`,
        after:       { invoiceId: invoice.id, amount: dto.amount, unappliedAfter: newUnapplied },
      });

      return updatedAdvance;
    }, { timeout: 30_000 });
  }

  // ── refund (POSTED → REFUNDED for unappliedAmount) ────────────────────────

  async refund(tenantId: string, advanceId: string, userId: string, dto: RefundCustomerAdvanceDto) {
    const advance = await this.prisma.customerAdvance.findFirst({
      where: { id: advanceId, tenantId },
      include: { customer: { select: { id: true, name: true } } },
    });
    if (!advance) throw new NotFoundException('Customer advance not found.');
    if (advance.status !== 'POSTED' && advance.status !== 'APPLIED') {
      throw new BadRequestException(`Advance is in status ${advance.status} — cannot refund.`);
    }
    const refundAmount = Number(advance.unappliedAmount);
    if (refundAmount <= 0.01) {
      throw new BadRequestException('No unapplied balance to refund.');
    }

    await this.periods.assertDateIsOpen(tenantId, new Date());

    const liabAccountId = await this.getCustomerDepositsLiabilityAccountId(tenantId);
    const cashAccountId = await this.findCashAccountForMethod(tenantId, dto.method);

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.customerAdvance.updateMany({
        where:
          { id: advance.id, tenantId, status: { in: ['POSTED', 'APPLIED'] } },
        data: {
          status:          'REFUNDED',
          unappliedAmount: new Prisma.Decimal(0),
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Advance state changed concurrently.');
      }

      const je = await this.journal.create(
        tenantId,
        {
          date:        new Date().toISOString(),
          description: `Refund Customer Advance ${advance.advanceNumber} — ${advance.customer.name}`,
          reference:   dto.reference ?? advance.advanceNumber,
          saveDraft:   false,
          lines: [
            { accountId: liabAccountId, debit:  refundAmount, description: 'Refund customer deposit' },
            { accountId: cashAccountId, credit: refundAmount, description: `Refund to ${advance.customer.name}` },
          ],
        },
        userId,
      );

      void this.audit.log({
        tenantId,
        action:      AuditAction.JOURNAL_POSTED,
        entityType:  'CustomerAdvance',
        entityId:    advance.id,
        performedBy: userId,
        description: `Refunded P${refundAmount.toFixed(2)} on advance ${advance.advanceNumber}`,
        after:       { status: 'REFUNDED', refundJournalEntryId: je.id, amount: refundAmount },
      });

      return tx.customerAdvance.findFirstOrThrow({
        where:   { id: advance.id },
        include: { customer: { select: { id: true, name: true } } },
      });
    }, { timeout: 30_000 });
  }

  // ── void (POSTED/APPLIED → VOIDED — reverses the post JE) ─────────────────

  async void(tenantId: string, advanceId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (>= 5 characters).');
    }
    const advance = await this.prisma.customerAdvance.findFirst({
      where:   { id: advanceId, tenantId },
      include: { applications: { select: { invoiceId: true, appliedAmount: true } } },
    });
    if (!advance) throw new NotFoundException('Customer advance not found.');
    if (advance.status === 'VOIDED') throw new BadRequestException('Advance already voided.');
    if (advance.status === 'DRAFT')  throw new BadRequestException('Cannot void a DRAFT advance — delete instead.');
    if (!advance.journalEntryId)     throw new BadRequestException('Advance has no JE to reverse.');

    await this.periods.assertDateIsOpen(tenantId, new Date());

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.customerAdvance.updateMany({
        where: { id: advance.id, tenantId, voidedAt: null },
        data: {
          status:     'VOIDED',
          voidedById: userId,
          voidedAt:   new Date(),
          voidReason: reason.trim(),
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Advance was already voided concurrently.');
      }

      await this.journal.reverse(tenantId, advance.journalEntryId!, userId);

      // Roll back any applications — restore invoice balances
      for (const app of advance.applications) {
        const inv = await tx.aRInvoice.findUnique({
          where:  { id: app.invoiceId },
          select: { totalAmount: true, paidAmount: true, status: true },
        });
        if (!inv) continue;
        const newPaid    = Math.max(0, Number(inv.paidAmount) - Number(app.appliedAmount));
        const newBalance = Number(inv.totalAmount) - newPaid;
        let st = inv.status;
        if (inv.status !== 'VOIDED' && inv.status !== 'CANCELLED' && inv.status !== 'DRAFT') {
          if (newPaid <= 0.01)                                 st = 'OPEN';
          else if (newPaid + 0.01 >= Number(inv.totalAmount))  st = 'PAID';
          else                                                 st = 'PARTIALLY_PAID';
        }
        await tx.aRInvoice.update({
          where: { id: app.invoiceId },
          data: {
            paidAmount:    new Prisma.Decimal(newPaid),
            balanceAmount: new Prisma.Decimal(Math.max(0, newBalance)),
            status:        st,
          },
        });
      }
      await tx.customerAdvanceApplication.deleteMany({ where: { advanceId: advance.id } });

      void this.audit.log({
        tenantId,
        action:      AuditAction.VOID_PROCESSED,
        entityType:  'CustomerAdvance',
        entityId:    advance.id,
        performedBy: userId,
        description: `Customer advance ${advance.advanceNumber} voided: ${reason.trim().slice(0, 200)}`,
        before:      { status: advance.status },
        after:       { status: 'VOIDED', voidReason: reason.trim() },
      });

      return tx.customerAdvance.findFirstOrThrow({ where: { id: advance.id } });
    }, { timeout: 30_000 });
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    opts: { page?: number; pageSize?: number; customerId?: string; status?: string; from?: string; to?: string },
  ) {
    const page     = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.CustomerAdvanceWhereInput = { tenantId };
    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.status)     where.status = opts.status as Prisma.CustomerAdvanceWhereInput['status'];
    if (opts.from || opts.to) {
      where.postingDate = {};
      if (opts.from) (where.postingDate as { gte?: Date }).gte = new Date(opts.from);
      if (opts.to)   (where.postingDate as { lte?: Date }).lte = new Date(opts.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.customerAdvance.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { advanceNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          customer:     { select: { id: true, name: true } },
          journalEntry: { select: { id: true, entryNumber: true } },
        },
      }),
      this.prisma.customerAdvance.count({ where }),
    ]);

    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, advanceId: string) {
    const adv = await this.prisma.customerAdvance.findFirst({
      where: { id: advanceId, tenantId },
      include: {
        customer:     true,
        applications: { include: { invoice: { select: { id: true, invoiceNumber: true, balanceAmount: true, status: true } } } },
        journalEntry: { select: { id: true, entryNumber: true, status: true } },
      },
    });
    if (!adv) throw new NotFoundException('Customer advance not found.');
    return adv;
  }
}
