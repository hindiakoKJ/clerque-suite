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
}
