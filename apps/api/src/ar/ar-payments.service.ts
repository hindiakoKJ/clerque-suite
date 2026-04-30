/**
 * ARPaymentsService — record customer payments + match to invoices.
 *
 * Two operations:
 *   create()  — record a payment + (optionally) apply to one or many invoices
 *               in one shot. Creates the GL JE: DR Cash / CR AR Receivables.
 *   apply()   — apply an existing unapplied payment (or unapplied portion)
 *               to specific invoices later.
 *   void()    — reverse a payment. Reverses the JE + removes applications.
 *
 * Status of an invoice after payment is derived:
 *   paidAmount === 0                                → OPEN
 *   0 < paidAmount < totalAmount                    → PARTIALLY_PAID
 *   paidAmount === totalAmount                      → PAID
 *
 * On every payment-application change, recomputeInvoiceStatus is called
 * to update the parent invoice's paidAmount + balanceAmount + status.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma, type PaymentMethod } from '@prisma/client';

interface PaymentApplicationInput {
  invoiceId:     string;
  appliedAmount: number;
}

export interface CreateARPaymentDto {
  customerId:    string;
  branchId?:     string;
  paymentDate:   string;
  postingDate?:  string;
  method:        PaymentMethod;
  reference?:    string;
  totalAmount:   number;
  description?:  string;
  /** Optional immediate application to invoices. Sum of appliedAmount must <= totalAmount. */
  applications?: PaymentApplicationInput[];
}

@Injectable()
export class ARPaymentsService {
  constructor(
    private prisma:    PrismaService,
    private journal:   JournalService,
    private numbering: NumberingService,
  ) {}

  /** Find tenant's AR Receivables account (mirrors ARInvoicesService). */
  private async findArReceivablesAccount(tenantId: string): Promise<string> {
    const byCode = await this.prisma.account.findFirst({
      where:  { tenantId, code: '1300', isActive: true },
      select: { id: true },
    });
    if (byCode) return byCode.id;
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
      select: { id: true },
    });
    if (fallback) return fallback.id;
    throw new BadRequestException('No AR Receivables account found in COA.');
  }

  /** Find the cash/bank account by payment method. */
  private async findCashAccountForMethod(tenantId: string, method: PaymentMethod): Promise<string> {
    // Method → preferred account name fragment
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
        where: {
          tenantId,
          type:  'ASSET',
          isActive: true,
          name:  { contains: term, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (acct) return acct.id;
    }
    throw new BadRequestException(`No matching cash/bank account found for method ${method}.`);
  }

  /**
   * Create a payment, optionally apply to invoices, and post the JE.
   * Atomic — payment + JE + invoice status updates all roll back together.
   */
  async create(tenantId: string, userId: string, dto: CreateARPaymentDto) {
    if (dto.totalAmount <= 0) throw new BadRequestException('totalAmount must be > 0.');

    const customer = await this.prisma.customer.findFirst({
      where:  { id: dto.customerId, tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');

    // Validate applications (if any)
    const applications = dto.applications ?? [];
    if (applications.length > 0) {
      const sumApplied = applications.reduce((s, a) => s + a.appliedAmount, 0);
      if (sumApplied > dto.totalAmount + 0.01) {
        throw new BadRequestException(
          `Total applied (${sumApplied.toFixed(2)}) exceeds payment amount (${dto.totalAmount.toFixed(2)}).`,
        );
      }
      // Validate each invoice belongs to this tenant + customer + has open balance
      const invoiceIds = applications.map((a) => a.invoiceId);
      const invoices = await this.prisma.aRInvoice.findMany({
        where:  { id: { in: invoiceIds }, tenantId, customerId: dto.customerId },
        select: { id: true, status: true, balanceAmount: true, invoiceNumber: true },
      });
      if (invoices.length !== applications.length) {
        throw new BadRequestException('One or more invoices not found for this customer.');
      }
      for (const a of applications) {
        const inv = invoices.find((i) => i.id === a.invoiceId)!;
        if (inv.status === 'CANCELLED' || inv.status === 'VOIDED' || inv.status === 'DRAFT') {
          throw new BadRequestException(`Invoice ${inv.invoiceNumber} is in status ${inv.status} — cannot apply payment.`);
        }
        if (a.appliedAmount > Number(inv.balanceAmount) + 0.01) {
          throw new BadRequestException(
            `Cannot apply ${a.appliedAmount.toFixed(2)} to invoice ${inv.invoiceNumber} — balance is only ${Number(inv.balanceAmount).toFixed(2)}.`,
          );
        }
      }
    }

    const paymentDate = new Date(dto.paymentDate);
    const postingDate = dto.postingDate ? new Date(dto.postingDate) : paymentDate;

    const arAccount   = await this.findArReceivablesAccount(tenantId);
    const cashAccount = await this.findCashAccountForMethod(tenantId, dto.method);

    return this.prisma.$transaction(async (tx) => {
      const paymentNumber = await this.numbering.next(tenantId, 'AR_PAYMENT', null, tx);

      const appliedSum   = applications.reduce((s, a) => s + a.appliedAmount, 0);
      const unappliedSum = dto.totalAmount - appliedSum;

      // Create the payment
      const payment = await tx.aRPayment.create({
        data: {
          tenantId,
          branchId:        dto.branchId ?? null,
          paymentNumber,
          customerId:      dto.customerId,
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
                  invoiceId:     a.invoiceId,
                  appliedAmount: new Prisma.Decimal(a.appliedAmount),
                })),
              }
            : undefined,
        },
      });

      // Post JE: DR Cash / CR AR Receivables
      const je = await this.journal.create(
        tenantId,
        {
          date:        paymentDate.toISOString(),
          postingDate: postingDate.toISOString(),
          description: `AR Payment ${paymentNumber} — ${customer.name}`,
          reference:   dto.reference ?? paymentNumber,
          saveDraft:   false,
          lines: [
            { accountId: cashAccount, debit:  dto.totalAmount, description: dto.description ?? 'Customer payment received' },
            { accountId: arAccount,   credit: dto.totalAmount, description: `${customer.name} settlement` },
          ],
        },
        userId,
      );

      // Link payment to JE
      await tx.aRPayment.update({
        where: { id: payment.id },
        data:  { journalEntryId: je.id },
      });

      // Recompute affected invoices' paidAmount / status
      for (const a of applications) {
        await this.recomputeInvoiceStatus(tx, a.invoiceId);
      }

      return tx.aRPayment.findFirstOrThrow({
        where:   { id: payment.id },
        include: {
          customer:     { select: { id: true, name: true } },
          applications: { include: { invoice: { select: { id: true, invoiceNumber: true, balanceAmount: true, status: true } } } },
          journalEntry: { select: { id: true, entryNumber: true } },
        },
      });
    }, { timeout: 30_000 });
  }

  /**
   * Apply unallocated portion of an existing payment to invoices.
   * Useful when a customer pre-pays and we later allocate against bills as
   * they're issued.
   */
  async apply(
    tenantId: string,
    paymentId: string,
    userId: string,
    applications: PaymentApplicationInput[],
  ) {
    if (applications.length === 0) {
      throw new BadRequestException('Provide at least one application.');
    }

    const payment = await this.prisma.aRPayment.findFirst({
      where: { id: paymentId, tenantId },
    });
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
        const inv = await tx.aRInvoice.findFirst({
          where:  { id: a.invoiceId, tenantId, customerId: payment.customerId },
          select: { status: true, balanceAmount: true, invoiceNumber: true },
        });
        if (!inv) throw new BadRequestException(`Invoice ${a.invoiceId} not found for this customer.`);
        if (a.appliedAmount > Number(inv.balanceAmount) + 0.01) {
          throw new BadRequestException(
            `Cannot apply ${a.appliedAmount.toFixed(2)} to ${inv.invoiceNumber} — balance ${Number(inv.balanceAmount).toFixed(2)}.`,
          );
        }
        await tx.aRPaymentApplication.create({
          data: {
            paymentId:     payment.id,
            invoiceId:     a.invoiceId,
            appliedAmount: new Prisma.Decimal(a.appliedAmount),
          },
        });
        await this.recomputeInvoiceStatus(tx, a.invoiceId);
      }

      // Update payment's appliedAmount + unapplied
      const sum = await tx.aRPaymentApplication.aggregate({
        where: { paymentId: payment.id },
        _sum:  { appliedAmount: true },
      });
      const totalApplied = Number(sum._sum.appliedAmount ?? 0);
      return tx.aRPayment.update({
        where: { id: payment.id },
        data: {
          appliedAmount:   new Prisma.Decimal(totalApplied),
          unappliedAmount: new Prisma.Decimal(Number(payment.totalAmount) - totalApplied),
        },
        include: {
          applications: { include: { invoice: { select: { id: true, invoiceNumber: true, balanceAmount: true, status: true } } } },
        },
      });
    });
  }

  /** Void a payment — reverses JE + clears applications + recomputes invoices. */
  async void(tenantId: string, paymentId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (>= 5 characters).');
    }

    const payment = await this.prisma.aRPayment.findFirst({
      where:   { id: paymentId, tenantId },
      include: { applications: { select: { invoiceId: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.voidedAt) throw new BadRequestException('Payment already voided.');
    if (!payment.journalEntryId) throw new BadRequestException('Payment has no JE to reverse.');

    return this.prisma.$transaction(async (tx) => {
      await this.journal.reverse(tenantId, payment.journalEntryId!, userId);

      // Capture invoice IDs to recompute, then delete applications
      const invoiceIds = payment.applications.map((a) => a.invoiceId);
      await tx.aRPaymentApplication.deleteMany({ where: { paymentId: payment.id } });

      const updated = await tx.aRPayment.update({
        where: { id: payment.id },
        data: {
          appliedAmount:   new Prisma.Decimal(0),
          unappliedAmount: payment.totalAmount,
          voidedById:      userId,
          voidedAt:        new Date(),
          voidReason:      reason.trim(),
        },
      });

      for (const invoiceId of invoiceIds) {
        await this.recomputeInvoiceStatus(tx, invoiceId);
      }

      return updated;
    }, { timeout: 30_000 });
  }

  // ── Private: status recomputation ──────────────────────────────────────────

  /**
   * Sum all payment applications against an invoice and update its
   * paidAmount / balanceAmount / status. Called after every application
   * change (create / void / void-payment-cascade).
   */
  private async recomputeInvoiceStatus(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<void> {
    const [invoice, sum] = await Promise.all([
      tx.aRInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalAmount: true, status: true } }),
      tx.aRPaymentApplication.aggregate({
        where: { invoiceId },
        _sum:  { appliedAmount: true },
      }),
    ]);

    if (invoice.status === 'VOIDED' || invoice.status === 'CANCELLED' || invoice.status === 'DRAFT') {
      return; // don't touch — terminal / pre-post states
    }

    const total = Number(invoice.totalAmount);
    const paid  = Number(sum._sum.appliedAmount ?? 0);
    const bal   = total - paid;

    let status = invoice.status;
    if (paid <= 0.01)                 status = 'OPEN';
    else if (paid + 0.01 >= total)    status = 'PAID';
    else                              status = 'PARTIALLY_PAID';

    await tx.aRInvoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount:    new Prisma.Decimal(paid),
        balanceAmount: new Prisma.Decimal(Math.max(0, bal)),
        status,
      },
    });
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    opts: { page?: number; pageSize?: number; customerId?: string; from?: string; to?: string },
  ) {
    const page     = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.ARPaymentWhereInput = { tenantId };
    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.from || opts.to) {
      where.postingDate = {};
      if (opts.from) (where.postingDate as { gte?: Date }).gte = new Date(opts.from);
      if (opts.to)   (where.postingDate as { lte?: Date }).lte = new Date(opts.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.aRPayment.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { paymentNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          customer:     { select: { id: true, name: true } },
          applications: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
        },
      }),
      this.prisma.aRPayment.count({ where }),
    ]);

    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, paymentId: string) {
    const payment = await this.prisma.aRPayment.findFirst({
      where: { id: paymentId, tenantId },
      include: {
        customer:     true,
        applications: { include: { invoice: { select: { id: true, invoiceNumber: true, balanceAmount: true, status: true } } } },
        journalEntry: { select: { id: true, entryNumber: true, status: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    return payment;
  }
}
