import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RecordCollectionDto } from './dto/record-collection.dto';

@Injectable()
export class ArService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List CHARGE orders as AR invoices ──────────────────────────────────────

  async findInvoices(
    tenantId: string,
    opts: {
      customerId?: string;
      collected?: boolean;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const { customerId, collected, from, to, page = 1, limit = 50 } = opts;
    const skip = (page - 1) * limit;

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        invoiceType: 'CHARGE',
        status: { not: 'VOIDED' },
        ...(customerId ? { customerId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to   ? { lte: new Date(to + 'T23:59:59.999Z') } : {}),
              },
            }
          : {}),
      },
      include: {
        payments: true,
        customer: { select: { id: true, name: true, tin: true, creditTermDays: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Compute balance per invoice and apply `collected` filter
    const invoices = orders.map((order) => {
      const invoiceAmt = Number(order.totalAmount);
      const collectedAmt = order.payments.reduce((s, p) => s + Number(p.amount), 0);
      const balance = Math.max(invoiceAmt - collectedAmt, 0);
      return { ...order, collectedAmount: collectedAmt, balance };
    });

    const filtered =
      collected === undefined
        ? invoices
        : collected
        ? invoices.filter((inv) => inv.balance === 0)
        : invoices.filter((inv) => inv.balance > 0);

    const total = filtered.length;
    const paginated = filtered.slice(skip, skip + limit);

    return { data: paginated, total, page, pages: Math.ceil(total / limit) };
  }

  // ── Single invoice with collections ───────────────────────────────────────

  async getInvoice(orderId: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, invoiceType: 'CHARGE' },
      include: {
        payments: { orderBy: { createdAt: 'asc' } },
        customer: true,
        items: true,
      },
    });
    if (!order) throw new NotFoundException('AR invoice not found');

    const invoiceAmt   = Number(order.totalAmount);
    const collectedAmt = order.payments.reduce((s, p) => s + Number(p.amount), 0);
    const balance      = Math.max(invoiceAmt - collectedAmt, 0);

    return { ...order, collectedAmount: collectedAmt, balance };
  }

  // ── Record a customer payment ──────────────────────────────────────────────

  async recordCollection(
    orderId: string,
    tenantId: string,
    userId: string,
    dto: RecordCollectionDto,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, invoiceType: 'CHARGE' },
      include: {
        payments: true,
        customer: true,
      },
    });
    if (!order) throw new NotFoundException('AR invoice not found');
    if (order.status === 'VOIDED') {
      throw new BadRequestException('Cannot collect payment on a voided order');
    }

    const invoiceAmt   = Number(order.totalAmount);
    const alreadyPaid  = order.payments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining    = Math.max(invoiceAmt - alreadyPaid, 0);

    if (remaining === 0) {
      throw new BadRequestException('Invoice is already fully collected');
    }
    if (dto.amount > remaining + 0.01) {
      throw new BadRequestException(
        `Amount (${dto.amount}) exceeds remaining balance (${remaining.toFixed(2)})`,
      );
    }

    const collectedAt = dto.collectedAt ? new Date(dto.collectedAt) : new Date();
    const customer    = order.customer;

    // Find GL accounts
    const cashAccount = await this.prisma.account.findFirst({
      where: { tenantId, code: '1010' },
    });
    const arAccount = await this.prisma.account.findFirst({
      where: { tenantId, code: '1030' },
    });

    if (!cashAccount) {
      throw new BadRequestException(
        'Cash on Hand account (1010) not found. Please seed the chart of accounts.',
      );
    }
    if (!arAccount) {
      throw new BadRequestException(
        'Accounts Receivable account (1030) not found. Please seed the chart of accounts.',
      );
    }

    const newlyCollected = alreadyPaid + dto.amount;
    const isFullyPaid    = newlyCollected >= invoiceAmt - 0.01;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create OrderPayment record
      const payment = await tx.orderPayment.create({
        data: {
          orderId,
          method:    dto.paymentMethod as any,
          amount:    new Prisma.Decimal(dto.amount),
          reference: dto.reference ?? null,
        },
      });

      // 2. Mark order COMPLETED if fully paid
      if (isFullyPaid) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: 'COMPLETED', completedAt: collectedAt },
        });
      }

      // 3. Post Journal Entry: DR Cash 1010 / CR AR 1030
      const customerName = customer?.name ?? order.customerName ?? 'Unknown';
      const je = await tx.journalEntry.create({
        data: {
          tenantId,
          entryNumber:  `AR-${Date.now()}`,
          date:         collectedAt,
          postingDate:  new Date(),
          description:  `AR Collection: ${order.orderNumber} — ${customerName}`,
          reference:    dto.reference ?? null,
          status:       'POSTED',
          source:       'AR',
          createdBy:    userId,
          postedBy:     userId,
          postedAt:     new Date(),
          lines: {
            create: [
              {
                accountId:   cashAccount.id,
                description: 'Collection received',
                debit:       new Prisma.Decimal(dto.amount),
                credit:      new Prisma.Decimal(0),
                currency:    'PHP',
                exchangeRate: 1,
              },
              {
                accountId:   arAccount.id,
                description: `Invoice ${order.orderNumber}`,
                debit:       new Prisma.Decimal(0),
                credit:      new Prisma.Decimal(dto.amount),
                currency:    'PHP',
                exchangeRate: 1,
              },
            ],
          },
        },
      });

      return { payment, journalEntry: je, fullyCollected: isFullyPaid };
    });

    return result;
  }

  // ── AR Aging ───────────────────────────────────────────────────────────────

  async getAging(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const chargeOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        invoiceType: 'CHARGE',
        status: { not: 'VOIDED' },
      },
      include: {
        payments: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by customer
    const customerMap = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        notDue: number;
        bucket1_30: number;
        bucket31_60: number;
        bucket61_90: number;
        bucket90plus: number;
        total: number;
      }
    >();

    for (const order of chargeOrders) {
      const invoiceAmt   = Number(order.totalAmount);
      const collectedAmt = order.payments.reduce((s, p) => s + Number(p.amount), 0);
      const balance      = Math.max(invoiceAmt - collectedAmt, 0);

      if (balance <= 0) continue; // fully paid — skip

      const customerId   = order.customerId   ?? 'UNKNOWN';
      const customerName = order.customer?.name ?? order.customerName ?? 'Unknown';

      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, {
          customerId,
          customerName,
          notDue:       0,
          bucket1_30:   0,
          bucket31_60:  0,
          bucket61_90:  0,
          bucket90plus: 0,
          total:        0,
        });
      }

      const row = customerMap.get(customerId)!;
      row.total += balance;

      if (!order.dueDate) {
        // No due date — treat as not yet due
        row.notDue += balance;
        continue;
      }

      const due = new Date(order.dueDate);
      due.setHours(0, 0, 0, 0);
      const diffMs   = today.getTime() - due.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        row.notDue += balance;
      } else if (diffDays <= 30) {
        row.bucket1_30 += balance;
      } else if (diffDays <= 60) {
        row.bucket31_60 += balance;
      } else if (diffDays <= 90) {
        row.bucket61_90 += balance;
      } else {
        row.bucket90plus += balance;
      }
    }

    const rows = Array.from(customerMap.values()).map((r) => ({
      ...r,
      notDue:       Math.round(r.notDue       * 100) / 100,
      bucket1_30:   Math.round(r.bucket1_30   * 100) / 100,
      bucket31_60:  Math.round(r.bucket31_60  * 100) / 100,
      bucket61_90:  Math.round(r.bucket61_90  * 100) / 100,
      bucket90plus: Math.round(r.bucket90plus * 100) / 100,
      total:        Math.round(r.total        * 100) / 100,
    }));

    const grandTotal = {
      notDue:       rows.reduce((s, r) => s + r.notDue,       0),
      bucket1_30:   rows.reduce((s, r) => s + r.bucket1_30,   0),
      bucket31_60:  rows.reduce((s, r) => s + r.bucket31_60,  0),
      bucket61_90:  rows.reduce((s, r) => s + r.bucket61_90,  0),
      bucket90plus: rows.reduce((s, r) => s + r.bucket90plus, 0),
      total:        rows.reduce((s, r) => s + r.total,        0),
    };

    return { asOf: today.toISOString(), rows, grandTotal };
  }

  // ── AR Dashboard Summary ───────────────────────────────────────────────────

  async getSummary(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const chargeOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        invoiceType: 'CHARGE',
        status: { not: 'VOIDED' },
      },
      include: { payments: true },
    });

    let totalOutstanding = 0;
    let totalOverdue     = 0;
    const openCustomers  = new Set<string>();

    for (const order of chargeOrders) {
      const invoiceAmt   = Number(order.totalAmount);
      const collectedAmt = order.payments.reduce((s, p) => s + Number(p.amount), 0);
      const balance      = Math.max(invoiceAmt - collectedAmt, 0);

      if (balance <= 0) continue;

      totalOutstanding += balance;

      if (order.customerId) openCustomers.add(order.customerId);

      if (order.dueDate) {
        const due = new Date(order.dueDate);
        due.setHours(0, 0, 0, 0);
        if (due < today) totalOverdue += balance;
      }
    }

    return {
      totalOutstanding:         Math.round(totalOutstanding * 100) / 100,
      totalOverdue:             Math.round(totalOverdue     * 100) / 100,
      customersWithOpenInvoices: openCustomers.size,
    };
  }
}
