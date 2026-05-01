import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    opts: { search?: string; isActive?: boolean } = {},
  ) {
    const { search, isActive } = opts;

    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { tin:  { contains: search, mode: 'insensitive' } },
              { contactEmail: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    // Compute outstanding balance per customer
    const withBalance = await Promise.all(
      customers.map(async (c) => {
        const balance = await this.getOutstandingBalance(c.id, tenantId);
        return { ...c, outstandingBalance: balance };
      }),
    );

    return withBalance;
  }

  async findOne(id: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        orders: {
          where: { invoiceType: 'CHARGE' },
          orderBy: { createdAt: 'desc' },
          include: { payments: true },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const outstandingBalance = await this.getOutstandingBalance(id, tenantId);
    return { ...customer, outstandingBalance };
  }

  async create(tenantId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        tenantId,
        name:           dto.name,
        tin:            dto.tin,
        address:        dto.address,
        contactEmail:   dto.contactEmail,
        contactPhone:   dto.contactPhone,
        creditTermDays: dto.creditTermDays ?? 0,
        creditLimit:    dto.creditLimit != null ? new Prisma.Decimal(dto.creditLimit) : undefined,
        notes:          dto.notes,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateCustomerDto) {
    await this.findOne(id, tenantId);
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name            !== undefined ? { name: dto.name }                                              : {}),
        ...(dto.tin             !== undefined ? { tin: dto.tin }                                                : {}),
        ...(dto.address         !== undefined ? { address: dto.address }                                        : {}),
        ...(dto.contactEmail    !== undefined ? { contactEmail: dto.contactEmail }                              : {}),
        ...(dto.contactPhone    !== undefined ? { contactPhone: dto.contactPhone }                              : {}),
        ...(dto.creditTermDays  !== undefined ? { creditTermDays: dto.creditTermDays }                          : {}),
        ...(dto.creditLimit     !== undefined ? { creditLimit: new Prisma.Decimal(dto.creditLimit!) }           : {}),
        ...(dto.notes           !== undefined ? { notes: dto.notes }                                            : {}),
        ...(dto.isActive        !== undefined ? { isActive: dto.isActive }                                      : {}),
      },
    });
  }

  async deactivate(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.customer.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Sum of totalAmount for CHARGE orders that are not fully collected
   * (i.e., order.totalAmount minus sum of all payments for that order, for orders with a positive remaining balance).
   */
  async getOutstandingBalance(customerId: string, tenantId: string): Promise<number> {
    const chargeOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        customerId,
        invoiceType: 'CHARGE',
        status: { not: 'VOIDED' },
      },
      include: { payments: true },
    });

    let total = 0;
    for (const order of chargeOrders) {
      const invoiceAmt = Number(order.totalAmount);
      const collected  = order.payments.reduce((s, p) => s + Number(p.amount), 0);
      const remaining  = invoiceAmt - collected;
      if (remaining > 0) total += remaining;
    }

    return Math.round(total * 100) / 100;
  }

  /**
   * FBL5N — Customer Ledger Explorer.
   * Returns chronologically ordered list of every AR transaction touching
   * this customer: formal invoices (post + void), payments, charge-tab POS
   * orders, and payment applications. With running balance.
   *
   * Each entry has a sign:
   *   + (debit)  = customer owes us more (invoice posted)
   *   − (credit) = customer paid down their balance (payment applied / void / refund)
   */
  async getLedger(tenantId: string, customerId: string, opts: { from?: string; to?: string } = {}) {
    const customer = await this.prisma.customer.findFirstOrThrow({
      where:  { id: customerId, tenantId },
      select: { id: true, name: true, tin: true, creditTermDays: true, creditLimit: true },
    });

    const dateFilter = opts.from || opts.to ? {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to   ? { lte: new Date(opts.to) }   : {}),
    } : undefined;

    type Movement = {
      date:        string;
      kind:        'INVOICE' | 'PAYMENT' | 'POS_CHARGE' | 'VOID';
      reference:   string;
      description: string;
      debit:       number;
      credit:      number;
      balance:     number; // filled at the end
    };

    const movements: Omit<Movement, 'balance'>[] = [];

    // Formal invoices (debit when status != VOIDED)
    const invoices = await this.prisma.aRInvoice.findMany({
      where: { tenantId, customerId, ...(dateFilter ? { invoiceDate: dateFilter } : {}) },
      select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, status: true, description: true, voidedAt: true },
      orderBy: { invoiceDate: 'asc' },
    });
    for (const inv of invoices) {
      if (inv.status !== 'VOIDED' && inv.status !== 'CANCELLED' && inv.status !== 'DRAFT') {
        movements.push({
          date:        inv.invoiceDate.toISOString(),
          kind:        'INVOICE',
          reference:   inv.invoiceNumber,
          description: inv.description ?? `Invoice ${inv.invoiceNumber}`,
          debit:       Number(inv.totalAmount),
          credit:      0,
        });
      }
      if (inv.status === 'VOIDED' && inv.voidedAt) {
        movements.push({
          date:        inv.voidedAt.toISOString(),
          kind:        'VOID',
          reference:   `VOID ${inv.invoiceNumber}`,
          description: `Voided invoice ${inv.invoiceNumber}`,
          debit:       0,
          credit:      Number(inv.totalAmount),
        });
      }
    }

    // Payments — applied amounts only (allocated to invoices; unallocated kept as floats)
    const payments = await this.prisma.aRPayment.findMany({
      where: { tenantId, customerId, ...(dateFilter ? { paymentDate: dateFilter } : {}) },
      select: { id: true, paymentNumber: true, paymentDate: true, totalAmount: true, method: true, reference: true,
                applications: { select: { appliedAmount: true } } },
      orderBy: { paymentDate: 'asc' },
    });
    for (const p of payments) {
      const applied = p.applications.reduce((s, a) => s + Number(a.appliedAmount), 0);
      if (applied > 0) {
        movements.push({
          date:        p.paymentDate.toISOString(),
          kind:        'PAYMENT',
          reference:   p.paymentNumber,
          description: `Payment ${p.method}${p.reference ? ` · ${p.reference}` : ''}`,
          debit:       0,
          credit:      applied,
        });
      }
    }

    // POS charge-tab orders (legacy)
    const posOrders = await this.prisma.order.findMany({
      where:  { tenantId, customerId, invoiceType: 'CHARGE', status: { in: ['COMPLETED', 'OPEN'] }, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      select: { id: true, orderNumber: true, createdAt: true, totalAmount: true, payments: { select: { amount: true } } },
      orderBy: { createdAt: 'asc' },
    });
    for (const o of posOrders) {
      const collected = o.payments.reduce((s, p) => s + Number(p.amount), 0);
      const remaining = Number(o.totalAmount) - collected;
      if (remaining > 0) {
        movements.push({
          date:        o.createdAt.toISOString(),
          kind:        'POS_CHARGE',
          reference:   o.orderNumber,
          description: `POS charge tab — ${o.orderNumber}`,
          debit:       remaining,
          credit:      0,
        });
      }
    }

    // Sort chronologically
    movements.sort((a, b) => a.date.localeCompare(b.date));

    // Compute running balance
    let balance = 0;
    const out: Movement[] = movements.map((m) => {
      balance += m.debit - m.credit;
      return { ...m, balance };
    });

    return {
      customer,
      from:    opts.from ?? null,
      to:      opts.to   ?? null,
      openingBalance: 0, // simplified: we always start at 0 for now (full historical sum on load)
      closingBalance: balance,
      movements: out,
      totalDebit:  out.reduce((s, m) => s + m.debit,  0),
      totalCredit: out.reduce((s, m) => s + m.credit, 0),
    };
  }
}
