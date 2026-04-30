/**
 * APPaymentsService — vendor payment outflows + bill matching. Mirror of
 * ARPaymentsService for AP.
 *
 * GL posting (on create):
 *   DR  AP Payables (the amount we owed before paying)
 *   CR  Cash (the amount actually paid out — already net of WHT, since WHT
 *       was withheld at bill posting).
 *
 * Status of a bill is recomputed after every application change.
 */

import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma, type PaymentMethod } from '@prisma/client';
import { CreateAPPaymentDto, APPaymentApplicationDto } from './dto/ap-payment.dto';

@Injectable()
export class APPaymentsService {
  constructor(
    private prisma:    PrismaService,
    private journal:   JournalService,
    private numbering: NumberingService,
  ) {}

  private async findApPayablesAccount(tenantId: string): Promise<string> {
    const byCode = await this.prisma.account.findFirst({
      where: { tenantId, code: '2010', isActive: true }, select: { id: true },
    });
    if (byCode) return byCode.id;
    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId, type: 'LIABILITY', isActive: true,
        OR: [
          { name: { contains: 'payable', mode: 'insensitive' } },
          { name: { contains: 'AP',      mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (fallback) return fallback.id;
    throw new BadRequestException('No AP Payables account in COA.');
  }

  private async findCashAccountForMethod(tenantId: string, method: PaymentMethod): Promise<string> {
    const search: Record<PaymentMethod, string[]> = {
      CASH:           ['cash on hand', 'cash'],
      GCASH_PERSONAL: ['gcash', 'cash'],
      GCASH_BUSINESS: ['gcash', 'cash'],
      MAYA_PERSONAL:  ['maya', 'cash'],
      MAYA_BUSINESS:  ['maya', 'cash'],
      QR_PH:          ['cash in bank', 'bank', 'cash'],
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

  async create(tenantId: string, userId: string, dto: CreateAPPaymentDto) {
    if (dto.totalAmount <= 0) throw new BadRequestException('totalAmount must be > 0.');

    const vendor = await this.prisma.vendor.findFirst({
      where: { id: dto.vendorId, tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');

    const applications = dto.applications ?? [];
    if (applications.length > 0) {
      const sumApplied = applications.reduce((s, a) => s + a.appliedAmount, 0);
      if (sumApplied > dto.totalAmount + 0.01) {
        throw new BadRequestException(
          `Total applied (${sumApplied.toFixed(2)}) exceeds payment amount (${dto.totalAmount.toFixed(2)}).`,
        );
      }
      const billIds = applications.map((a) => a.billId);
      const bills = await this.prisma.aPBill.findMany({
        where: { id: { in: billIds }, tenantId, vendorId: dto.vendorId },
        select: { id: true, status: true, balanceAmount: true, billNumber: true },
      });
      if (bills.length !== applications.length) {
        throw new BadRequestException('One or more bills not found for this vendor.');
      }
      for (const a of applications) {
        const bill = bills.find((b) => b.id === a.billId)!;
        if (bill.status === 'CANCELLED' || bill.status === 'VOIDED' || bill.status === 'DRAFT') {
          throw new BadRequestException(`Bill ${bill.billNumber} is in status ${bill.status} — cannot apply payment.`);
        }
        if (a.appliedAmount > Number(bill.balanceAmount) + 0.01) {
          throw new BadRequestException(
            `Cannot apply ${a.appliedAmount.toFixed(2)} to bill ${bill.billNumber} — balance is only ${Number(bill.balanceAmount).toFixed(2)}.`,
          );
        }
      }
    }

    const paymentDate = new Date(dto.paymentDate);
    const postingDate = dto.postingDate ? new Date(dto.postingDate) : paymentDate;

    const apAccount   = await this.findApPayablesAccount(tenantId);
    const cashAccount = await this.findCashAccountForMethod(tenantId, dto.method);

    return this.prisma.$transaction(async (tx) => {
      const paymentNumber = await this.numbering.next(tenantId, 'AP_PAYMENT', null, tx);
      const appliedSum   = applications.reduce((s, a) => s + a.appliedAmount, 0);
      const unappliedSum = dto.totalAmount - appliedSum;

      const payment = await tx.aPPayment.create({
        data: {
          tenantId,
          branchId:        dto.branchId ?? null,
          paymentNumber,
          vendorId:        dto.vendorId,
          paymentDate,
          postingDate,
          method:          dto.method,
          reference:       dto.reference,
          totalAmount:     new Prisma.Decimal(dto.totalAmount),
          appliedAmount:   new Prisma.Decimal(appliedSum),
          unappliedAmount: new Prisma.Decimal(unappliedSum),
          description:     dto.description,
          createdById:     userId,
          applications: applications.length
            ? {
                create: applications.map((a) => ({
                  billId:        a.billId,
                  appliedAmount: new Prisma.Decimal(a.appliedAmount),
                })),
              }
            : undefined,
        },
      });

      const je = await this.journal.create(
        tenantId,
        {
          date:        paymentDate.toISOString(),
          postingDate: postingDate.toISOString(),
          description: `AP Payment ${paymentNumber} — ${vendor.name}`,
          reference:   dto.reference ?? paymentNumber,
          saveDraft:   false,
          lines: [
            { accountId: apAccount,   debit:  dto.totalAmount, description: `${vendor.name} settlement` },
            { accountId: cashAccount, credit: dto.totalAmount, description: dto.description ?? 'Vendor payment' },
          ],
        },
        userId,
      );

      await tx.aPPayment.update({
        where: { id: payment.id },
        data:  { journalEntryId: je.id },
      });

      for (const a of applications) {
        await this.recomputeBillStatus(tx, a.billId);
      }

      return tx.aPPayment.findFirstOrThrow({
        where: { id: payment.id },
        include: {
          vendor:       { select: { id: true, name: true } },
          applications: { include: { bill: { select: { id: true, billNumber: true, balanceAmount: true, status: true } } } },
          journalEntry: { select: { id: true, entryNumber: true } },
        },
      });
    }, { timeout: 30_000 });
  }

  async apply(
    tenantId: string,
    paymentId: string,
    userId: string,
    applications: APPaymentApplicationDto[],
  ) {
    if (applications.length === 0) {
      throw new BadRequestException('Provide at least one application.');
    }

    const payment = await this.prisma.aPPayment.findFirst({ where: { id: paymentId, tenantId } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.voidedAt) throw new BadRequestException('Cannot apply a voided payment.');

    const additionalApplied = applications.reduce((s, a) => s + a.appliedAmount, 0);
    const newApplied        = Number(payment.appliedAmount) + additionalApplied;
    if (newApplied > Number(payment.totalAmount) + 0.01) {
      throw new BadRequestException(
        `Total applications (${newApplied.toFixed(2)}) exceed payment total (${Number(payment.totalAmount).toFixed(2)}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const a of applications) {
        const bill = await tx.aPBill.findFirst({
          where:  { id: a.billId, tenantId, vendorId: payment.vendorId },
          select: { status: true, balanceAmount: true, billNumber: true },
        });
        if (!bill) throw new BadRequestException(`Bill ${a.billId} not found for this vendor.`);
        if (a.appliedAmount > Number(bill.balanceAmount) + 0.01) {
          throw new BadRequestException(
            `Cannot apply ${a.appliedAmount.toFixed(2)} to ${bill.billNumber} — balance ${Number(bill.balanceAmount).toFixed(2)}.`,
          );
        }
        await tx.aPPaymentApplication.create({
          data: {
            paymentId:     payment.id,
            billId:        a.billId,
            appliedAmount: new Prisma.Decimal(a.appliedAmount),
          },
        });
        await this.recomputeBillStatus(tx, a.billId);
      }

      const sum = await tx.aPPaymentApplication.aggregate({
        where: { paymentId: payment.id },
        _sum:  { appliedAmount: true },
      });
      const totalApplied = Number(sum._sum.appliedAmount ?? 0);
      return tx.aPPayment.update({
        where: { id: payment.id },
        data: {
          appliedAmount:   new Prisma.Decimal(totalApplied),
          unappliedAmount: new Prisma.Decimal(Number(payment.totalAmount) - totalApplied),
        },
        include: {
          applications: { include: { bill: { select: { id: true, billNumber: true, balanceAmount: true, status: true } } } },
        },
      });
    });
  }

  async void(tenantId: string, paymentId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (>= 5 characters).');
    }
    const payment = await this.prisma.aPPayment.findFirst({
      where:   { id: paymentId, tenantId },
      include: { applications: { select: { billId: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.voidedAt) throw new BadRequestException('Payment already voided.');
    if (!payment.journalEntryId) throw new BadRequestException('Payment has no JE to reverse.');

    return this.prisma.$transaction(async (tx) => {
      await this.journal.reverse(tenantId, payment.journalEntryId!, userId);
      const billIds = payment.applications.map((a) => a.billId);
      await tx.aPPaymentApplication.deleteMany({ where: { paymentId: payment.id } });

      const updated = await tx.aPPayment.update({
        where: { id: payment.id },
        data: {
          appliedAmount:   new Prisma.Decimal(0),
          unappliedAmount: payment.totalAmount,
          voidedById:      userId,
          voidedAt:        new Date(),
          voidReason:      reason.trim(),
        },
      });

      for (const billId of billIds) {
        await this.recomputeBillStatus(tx, billId);
      }
      return updated;
    }, { timeout: 30_000 });
  }

  private async recomputeBillStatus(tx: Prisma.TransactionClient, billId: string): Promise<void> {
    const [bill, sum] = await Promise.all([
      tx.aPBill.findUniqueOrThrow({ where: { id: billId }, select: { totalAmount: true, whtAmount: true, status: true } }),
      tx.aPPaymentApplication.aggregate({ where: { billId }, _sum: { appliedAmount: true } }),
    ]);

    if (bill.status === 'VOIDED' || bill.status === 'CANCELLED' || bill.status === 'DRAFT') return;

    const total = Number(bill.totalAmount) - Number(bill.whtAmount); // we only owe net of WHT
    const paid  = Number(sum._sum.appliedAmount ?? 0);
    const bal   = total - paid;

    let status = bill.status;
    if (paid <= 0.01)              status = 'OPEN';
    else if (paid + 0.01 >= total) status = 'PAID';
    else                           status = 'PARTIALLY_PAID';

    await tx.aPBill.update({
      where: { id: billId },
      data: {
        paidAmount:    new Prisma.Decimal(paid),
        balanceAmount: new Prisma.Decimal(Math.max(0, bal)),
        status,
      },
    });
  }

  async findAll(
    tenantId: string,
    opts: { page?: number; pageSize?: number; vendorId?: string; from?: string; to?: string },
  ) {
    const page     = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.APPaymentWhereInput = { tenantId };
    if (opts.vendorId) where.vendorId = opts.vendorId;
    if (opts.from || opts.to) {
      where.postingDate = {};
      if (opts.from) (where.postingDate as { gte?: Date }).gte = new Date(opts.from);
      if (opts.to)   (where.postingDate as { lte?: Date }).lte = new Date(opts.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.aPPayment.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { paymentNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          vendor:       { select: { id: true, name: true } },
          applications: { include: { bill: { select: { id: true, billNumber: true } } } },
        },
      }),
      this.prisma.aPPayment.count({ where }),
    ]);
    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, paymentId: string) {
    const payment = await this.prisma.aPPayment.findFirst({
      where: { id: paymentId, tenantId },
      include: {
        vendor: true,
        applications: { include: { bill: { select: { id: true, billNumber: true, balanceAmount: true, status: true } } } },
        journalEntry: { select: { id: true, entryNumber: true, status: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    return payment;
  }
}
