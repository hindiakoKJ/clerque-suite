/**
 * VendorAdvancesService — Sprint 22.
 *
 * Mirrors CustomerAdvancesService for the AP side. Vendor prepayments /
 * deposits we paid BEFORE receiving the bill. Sits as an asset (vendor
 * owes us delivery) until applied against an actual APBill.
 *
 * Lifecycle:
 *   create() → DRAFT  (no GL impact)
 *   post()   → POSTED (DR Vendor Prepayments Asset · CR Cash)
 *   apply()  → decreases APBill.balanceAmount + bumps appliedAmount.
 *   refund() → terminal. DR Cash · CR Asset for unappliedAmount → REFUNDED
 *   void()   → reverses the original posting JE → VOIDED
 *
 * Account discovery: looks up "Vendor Prepayments / Advance Deposits" by
 * COA code 1063. Throws a friendly error if missing.
 */

import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertBranchInTenant } from '../common/tenant-fk-guards';
import { JournalService } from '../accounting/journal.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { Prisma, type PaymentMethod, AuditAction } from '@prisma/client';
import {
  CreateVendorAdvanceDto,
  ApplyVendorAdvanceDto,
  RefundVendorAdvanceDto,
} from './dto/vendor-advance.dto';

@Injectable()
export class VendorAdvancesService {
  constructor(
    private prisma:    PrismaService,
    private journal:   JournalService,
    private periods:   AccountingPeriodsService,
    private numbering: NumberingService,
    private audit:     AuditService,
  ) {}

  private async getVendorPrepaymentsAssetAccountId(tenantId: string): Promise<string> {
    for (const code of ['1063']) {
      const a = await this.prisma.account.findFirst({
        where:  { tenantId, code, isActive: true },
        select: { id: true },
      });
      if (a) return a.id;
    }
    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId, type: 'ASSET', isActive: true,
        OR: [
          { name: { contains: 'vendor prepay',     mode: 'insensitive' } },
          { name: { contains: 'advance deposit',   mode: 'insensitive' } },
          { name: { contains: 'prepaid expense',   mode: 'insensitive' } },
          { name: { contains: 'supplier advance',  mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (fallback) return fallback.id;
    throw new BadRequestException(
      'Vendor Prepayments Asset account not found in your Chart of Accounts. ' +
      'Create an account with code 1063 (Advance Deposits) under Ledger → Chart of Accounts.',
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

  async create(tenantId: string, userId: string, dto: CreateVendorAdvanceDto) {
    if (dto.totalAmount <= 0) throw new BadRequestException('totalAmount must be > 0.');

    const vendor = await this.prisma.vendor.findFirst({
      where:  { id: dto.vendorId, tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');

    const advanceDate = new Date(dto.advanceDate);
    const postingDate = dto.postingDate ? new Date(dto.postingDate) : advanceDate;


    // SecAudit 2026-05 T2 — assert dto.branchId belongs to this tenant.
    await assertBranchInTenant(this.prisma, tenantId, dto.branchId);

    return this.prisma.$transaction(async (tx) => {
      const advanceNumber = await this.numbering.next(tenantId, 'VENDOR_ADVANCE', null, tx);
      return tx.vendorAdvance.create({
        data: {
          tenantId,
          branchId:        dto.branchId ?? null,
          advanceNumber,
          vendorId:        dto.vendorId,
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
        include: { vendor: { select: { id: true, name: true } } },
      });
    });
  }

  async post(tenantId: string, advanceId: string, userId: string) {
    const advance = await this.prisma.vendorAdvance.findFirst({
      where: { id: advanceId, tenantId },
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (!advance) throw new NotFoundException('Vendor advance not found.');
    if (advance.status !== 'DRAFT') {
      throw new BadRequestException(`Advance is in status ${advance.status} — only DRAFT can be posted.`);
    }

    await this.periods.assertDateIsOpen(tenantId, advance.postingDate);

    const assetAccountId = await this.getVendorPrepaymentsAssetAccountId(tenantId);
    const cashAccountId  = await this.findCashAccountForMethod(tenantId, advance.method);
    const amount = Number(advance.totalAmount);

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.vendorAdvance.updateMany({
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
          description: `Vendor Advance ${advance.advanceNumber} — ${advance.vendor.name}`,
          reference:   advance.reference ?? advance.advanceNumber,
          saveDraft:   false,
          lines: [
            { accountId: assetAccountId, debit:  amount, description: `Prepayment to ${advance.vendor.name}` },
            { accountId: cashAccountId,  credit: amount, description: 'Vendor prepayment disbursed' },
          ],
        },
        userId,
      );

      await tx.vendorAdvance.update({
        where: { id: advance.id },
        data:  { journalEntryId: je.id },
      });

      void this.audit.log({
        tenantId,
        action:      AuditAction.JOURNAL_POSTED,
        entityType:  'VendorAdvance',
        entityId:    advance.id,
        performedBy: userId,
        description: `Vendor advance ${advance.advanceNumber} posted (${advance.vendor.name}, P${amount.toFixed(2)})`,
        before:      { status: 'DRAFT' },
        after:       { status: 'POSTED', journalEntryId: je.id },
      });

      return tx.vendorAdvance.findFirstOrThrow({
        where:   { id: advance.id },
        include: {
          vendor:       { select: { id: true, name: true } },
          journalEntry: { select: { id: true, entryNumber: true } },
        },
      });
    }, { timeout: 30_000 });
  }

  async apply(tenantId: string, advanceId: string, userId: string, dto: ApplyVendorAdvanceDto) {
    if (dto.amount <= 0) throw new BadRequestException('amount must be > 0.');

    const advance = await this.prisma.vendorAdvance.findFirst({
      where: { id: advanceId, tenantId },
    });
    if (!advance) throw new NotFoundException('Vendor advance not found.');
    if (advance.status !== 'POSTED' && advance.status !== 'APPLIED') {
      throw new BadRequestException(`Advance is in status ${advance.status} — cannot apply.`);
    }
    if (Number(advance.unappliedAmount) < dto.amount - 0.01) {
      throw new BadRequestException(
        `Cannot apply ${dto.amount.toFixed(2)} — only ${Number(advance.unappliedAmount).toFixed(2)} remains unapplied.`,
      );
    }

    await this.periods.assertDateIsOpen(tenantId, new Date());

    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.aPBill.findFirst({
        where:  { id: dto.billId, tenantId, vendorId: advance.vendorId },
        select: { id: true, status: true, balanceAmount: true, paidAmount: true, totalAmount: true, whtAmount: true, billNumber: true },
      });
      if (!bill) throw new BadRequestException('Bill not found for this vendor.');
      if (!['OPEN', 'PARTIALLY_PAID'].includes(bill.status)) {
        throw new BadRequestException(`Bill ${bill.billNumber} is in status ${bill.status} — cannot apply advance.`);
      }
      if (dto.amount > Number(bill.balanceAmount) + 0.01) {
        throw new BadRequestException(
          `Cannot apply ${dto.amount.toFixed(2)} to ${bill.billNumber} — balance ${Number(bill.balanceAmount).toFixed(2)}.`,
        );
      }

      await tx.vendorAdvanceApplication.create({
        data: {
          advanceId:     advance.id,
          billId:        bill.id,
          appliedAmount: new Prisma.Decimal(dto.amount),
          appliedById:   userId,
        },
      });

      const newApplied   = Number(advance.appliedAmount) + dto.amount;
      const newUnapplied = Number(advance.totalAmount) - newApplied;
      const fullyApplied = newUnapplied <= 0.01;

      const updatedAdvance = await tx.vendorAdvance.update({
        where: { id: advance.id },
        data: {
          appliedAmount:   new Prisma.Decimal(newApplied),
          unappliedAmount: new Prisma.Decimal(Math.max(0, newUnapplied)),
          status:          fullyApplied ? 'APPLIED' : advance.status,
        },
      });

      const billNetTotal = Number(bill.totalAmount) - Number(bill.whtAmount);
      const newPaid    = Number(bill.paidAmount) + dto.amount;
      const newBalance = billNetTotal - newPaid;
      let newStatus   = bill.status;
      if (newPaid + 0.01 >= billNetTotal) newStatus = 'PAID';
      else if (newPaid > 0.01)            newStatus = 'PARTIALLY_PAID';

      await tx.aPBill.update({
        where: { id: bill.id },
        data: {
          paidAmount:    new Prisma.Decimal(newPaid),
          balanceAmount: new Prisma.Decimal(Math.max(0, newBalance)),
          status:        newStatus,
        },
      });

      void this.audit.log({
        tenantId,
        action:      AuditAction.JOURNAL_POSTED,
        entityType:  'VendorAdvanceApplication',
        entityId:    advance.id,
        performedBy: userId,
        description: `Applied P${dto.amount.toFixed(2)} of advance ${advance.advanceNumber} to bill ${bill.billNumber}`,
        after:       { billId: bill.id, amount: dto.amount, unappliedAfter: newUnapplied },
      });

      return updatedAdvance;
    }, { timeout: 30_000 });
  }

  async refund(tenantId: string, advanceId: string, userId: string, dto: RefundVendorAdvanceDto) {
    const advance = await this.prisma.vendorAdvance.findFirst({
      where: { id: advanceId, tenantId },
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (!advance) throw new NotFoundException('Vendor advance not found.');
    if (advance.status !== 'POSTED' && advance.status !== 'APPLIED') {
      throw new BadRequestException(`Advance is in status ${advance.status} — cannot refund.`);
    }
    const refundAmount = Number(advance.unappliedAmount);
    if (refundAmount <= 0.01) {
      throw new BadRequestException('No unapplied balance to refund.');
    }

    await this.periods.assertDateIsOpen(tenantId, new Date());

    const assetAccountId = await this.getVendorPrepaymentsAssetAccountId(tenantId);
    const cashAccountId  = await this.findCashAccountForMethod(tenantId, dto.method);

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.vendorAdvance.updateMany({
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
          description: `Refund Vendor Advance ${advance.advanceNumber} — ${advance.vendor.name}`,
          reference:   dto.reference ?? advance.advanceNumber,
          saveDraft:   false,
          lines: [
            { accountId: cashAccountId,  debit:  refundAmount, description: `Refund from ${advance.vendor.name}` },
            { accountId: assetAccountId, credit: refundAmount, description: 'Refund vendor prepayment' },
          ],
        },
        userId,
      );

      void this.audit.log({
        tenantId,
        action:      AuditAction.JOURNAL_POSTED,
        entityType:  'VendorAdvance',
        entityId:    advance.id,
        performedBy: userId,
        description: `Refunded P${refundAmount.toFixed(2)} on advance ${advance.advanceNumber}`,
        after:       { status: 'REFUNDED', refundJournalEntryId: je.id, amount: refundAmount },
      });

      return tx.vendorAdvance.findFirstOrThrow({
        where:   { id: advance.id },
        include: { vendor: { select: { id: true, name: true } } },
      });
    }, { timeout: 30_000 });
  }

  async void(tenantId: string, advanceId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (>= 5 characters).');
    }
    const advance = await this.prisma.vendorAdvance.findFirst({
      where:   { id: advanceId, tenantId },
      include: { applications: { select: { billId: true, appliedAmount: true } } },
    });
    if (!advance) throw new NotFoundException('Vendor advance not found.');
    if (advance.status === 'VOIDED') throw new BadRequestException('Advance already voided.');
    if (advance.status === 'DRAFT')  throw new BadRequestException('Cannot void a DRAFT advance — delete instead.');
    if (!advance.journalEntryId)     throw new BadRequestException('Advance has no JE to reverse.');

    await this.periods.assertDateIsOpen(tenantId, new Date());

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.vendorAdvance.updateMany({
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

      for (const app of advance.applications) {
        const bill = await tx.aPBill.findUnique({
          where:  { id: app.billId },
          select: { totalAmount: true, paidAmount: true, whtAmount: true, status: true },
        });
        if (!bill) continue;
        const netTotal   = Number(bill.totalAmount) - Number(bill.whtAmount);
        const newPaid    = Math.max(0, Number(bill.paidAmount) - Number(app.appliedAmount));
        const newBalance = netTotal - newPaid;
        let st = bill.status;
        if (bill.status !== 'VOIDED' && bill.status !== 'CANCELLED' && bill.status !== 'DRAFT') {
          if (newPaid <= 0.01)                  st = 'OPEN';
          else if (newPaid + 0.01 >= netTotal)  st = 'PAID';
          else                                  st = 'PARTIALLY_PAID';
        }
        await tx.aPBill.update({
          where: { id: app.billId },
          data: {
            paidAmount:    new Prisma.Decimal(newPaid),
            balanceAmount: new Prisma.Decimal(Math.max(0, newBalance)),
            status:        st,
          },
        });
      }
      await tx.vendorAdvanceApplication.deleteMany({ where: { advanceId: advance.id } });

      void this.audit.log({
        tenantId,
        action:      AuditAction.VOID_PROCESSED,
        entityType:  'VendorAdvance',
        entityId:    advance.id,
        performedBy: userId,
        description: `Vendor advance ${advance.advanceNumber} voided: ${reason.trim().slice(0, 200)}`,
        before:      { status: advance.status },
        after:       { status: 'VOIDED', voidReason: reason.trim() },
      });

      return tx.vendorAdvance.findFirstOrThrow({ where: { id: advance.id } });
    }, { timeout: 30_000 });
  }

  async findAll(
    tenantId: string,
    opts: { page?: number; pageSize?: number; vendorId?: string; status?: string; from?: string; to?: string },
  ) {
    const page     = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.VendorAdvanceWhereInput = { tenantId };
    if (opts.vendorId) where.vendorId = opts.vendorId;
    if (opts.status)   where.status   = opts.status as Prisma.VendorAdvanceWhereInput['status'];
    if (opts.from || opts.to) {
      where.postingDate = {};
      if (opts.from) (where.postingDate as { gte?: Date }).gte = new Date(opts.from);
      if (opts.to)   (where.postingDate as { lte?: Date }).lte = new Date(opts.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.vendorAdvance.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { advanceNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          vendor:       { select: { id: true, name: true } },
          journalEntry: { select: { id: true, entryNumber: true } },
        },
      }),
      this.prisma.vendorAdvance.count({ where }),
    ]);

    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, advanceId: string) {
    const adv = await this.prisma.vendorAdvance.findFirst({
      where: { id: advanceId, tenantId },
      include: {
        vendor:       true,
        applications: { include: { bill: { select: { id: true, billNumber: true, balanceAmount: true, status: true } } } },
        journalEntry: { select: { id: true, entryNumber: true, status: true } },
      },
    });
    if (!adv) throw new NotFoundException('Vendor advance not found.');
    return adv;
  }
}
