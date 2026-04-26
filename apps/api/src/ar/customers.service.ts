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
}
