import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, opts: { search?: string; isActive?: boolean }) {
    const { search, isActive } = opts;

    const where: Prisma.VendorWhereInput = {
      tenantId,
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { tin: { contains: search, mode: 'insensitive' } },
              { contactEmail: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const vendors = await this.prisma.vendor.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { expenses: true } },
        expenses: {
          where: { tenantId, status: 'POSTED' },
          select: { netAmount: true, paidAmount: true },
        },
      },
    });

    // Compute outstanding per vendor
    return vendors.map((v) => {
      const outstanding = v.expenses.reduce((sum, e) => {
        const net = Number(e.netAmount);
        const paid = Number(e.paidAmount ?? 0);
        return sum + Math.max(0, net - paid);
      }, 0);
      const { expenses: _exp, ...rest } = v;
      return { ...rest, outstanding };
    });
  }

  async findOne(id: string, tenantId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, tenantId },
      include: {
        expenses: {
          where: { status: 'POSTED' },
          select: { netAmount: true, paidAmount: true, status: true },
        },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const outstanding = vendor.expenses.reduce((sum, e) => {
      const net = Number(e.netAmount);
      const paid = Number(e.paidAmount ?? 0);
      return sum + Math.max(0, net - paid);
    }, 0);

    const { expenses: _exp, ...rest } = vendor;
    return { ...rest, outstanding };
  }

  async create(tenantId: string, dto: CreateVendorDto) {
    return this.prisma.vendor.create({
      data: {
        tenantId,
        name: dto.name,
        tin: dto.tin ?? null,
        address: dto.address ?? null,
        contactEmail: dto.contactEmail ?? null,
        contactPhone: dto.contactPhone ?? null,
        defaultAtcCode: dto.defaultAtcCode ?? null,
        defaultWhtRate: dto.defaultWhtRate
          ? new Prisma.Decimal(dto.defaultWhtRate)
          : null,
        notes: dto.notes ?? null,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateVendorDto) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, tenantId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    return this.prisma.vendor.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.tin !== undefined ? { tin: dto.tin } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        ...(dto.defaultAtcCode !== undefined ? { defaultAtcCode: dto.defaultAtcCode } : {}),
        ...(dto.defaultWhtRate !== undefined
          ? { defaultWhtRate: new Prisma.Decimal(dto.defaultWhtRate) }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  async deactivate(id: string, tenantId: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, tenantId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendor.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * FBL1N — Vendor Ledger Explorer.
   * Returns chronologically ordered list of every AP transaction touching
   * this vendor: bills posted, payments made, voids. With running balance.
   *
   * Each entry has a sign:
   *   + (credit) = we owe the vendor more (bill posted)
   *   − (debit)  = we paid them down (payment) or void
   *
   * Note: For AP we conventionally show the vendor balance as a credit
   * balance (positive = we owe). The signs below maintain that convention.
   */
  async getLedger(tenantId: string, vendorId: string, opts: { from?: string; to?: string } = {}) {
    const vendor = await this.prisma.vendor.findFirstOrThrow({
      where:  { id: vendorId, tenantId },
      select: { id: true, name: true, tin: true, defaultAtcCode: true, defaultWhtRate: true },
    });

    const dateFilter = opts.from || opts.to ? {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to   ? { lte: new Date(opts.to)   } : {}),
    } : undefined;

    type Movement = {
      date:        string;
      kind:        'BILL' | 'PAYMENT' | 'VOID';
      reference:   string;
      description: string;
      debit:       number;  // payments + voids
      credit:      number;  // bills
      balance:     number;
    };

    const movements: Omit<Movement, 'balance'>[] = [];

    const bills = await this.prisma.aPBill.findMany({
      where:  { tenantId, vendorId, ...(dateFilter ? { billDate: dateFilter } : {}) },
      select: { id: true, billNumber: true, billDate: true, totalAmount: true, whtAmount: true,
                vendorBillRef: true, status: true, description: true, voidedAt: true },
      orderBy: { billDate: 'asc' },
    });
    for (const b of bills) {
      const netPayable = Number(b.totalAmount) - Number(b.whtAmount);
      if (b.status !== 'VOIDED' && b.status !== 'CANCELLED' && b.status !== 'DRAFT') {
        movements.push({
          date:        b.billDate.toISOString(),
          kind:        'BILL',
          reference:   b.billNumber,
          description: b.description ?? `Bill ${b.billNumber}${b.vendorBillRef ? ` · SI: ${b.vendorBillRef}` : ''}`,
          debit:       0,
          credit:      netPayable,
        });
      }
      if (b.status === 'VOIDED' && b.voidedAt) {
        movements.push({
          date:        b.voidedAt.toISOString(),
          kind:        'VOID',
          reference:   `VOID ${b.billNumber}`,
          description: `Voided bill ${b.billNumber}`,
          debit:       netPayable,
          credit:      0,
        });
      }
    }

    const payments = await this.prisma.aPPayment.findMany({
      where:  { tenantId, vendorId, ...(dateFilter ? { paymentDate: dateFilter } : {}) },
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
          debit:       applied,
          credit:      0,
        });
      }
    }

    movements.sort((a, b) => a.date.localeCompare(b.date));

    let balance = 0;
    const out: Movement[] = movements.map((m) => {
      balance += m.credit - m.debit; // credit-balance convention for AP
      return { ...m, balance };
    });

    return {
      vendor,
      from: opts.from ?? null,
      to:   opts.to   ?? null,
      openingBalance: 0,
      closingBalance: balance,
      movements: out,
      totalDebit:  out.reduce((s, m) => s + m.debit,  0),
      totalCredit: out.reduce((s, m) => s + m.credit, 0),
    };
  }
}
