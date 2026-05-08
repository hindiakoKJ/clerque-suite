import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCustomerLite {
  name:           string;
  contactPhone?:  string | null;
  contactEmail?:  string | null;
  /// BIR-registered address (used on invoices). Optional.
  address?:       string | null;
  /// Default pickup/delivery address for laundry. Falls back to `address`.
  defaultAddress?: string | null;
  notes?:         string | null;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string, opts?: { search?: string; activeOnly?: boolean }) {
    const where: Record<string, unknown> = { tenantId };
    if (opts?.activeOnly !== false) where['isActive'] = true;
    if (opts?.search) {
      const q = opts.search.trim();
      if (q.length > 0) {
        where['OR'] = [
          { name:         { contains: q, mode: 'insensitive' } },
          { contactPhone: { contains: q, mode: 'insensitive' } },
          { contactEmail: { contains: q, mode: 'insensitive' } },
        ];
      }
    }
    return this.prisma.customer.findMany({
      where,
      select: {
        id: true, name: true, contactPhone: true, contactEmail: true,
        address: true, defaultAddress: true, loyaltyVisits: true,
        isActive: true, createdAt: true,
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async create(tenantId: string, dto: CreateCustomerLite) {
    const name = dto.name.trim();
    if (name.length < 2) {
      throw new ConflictException('Customer name must be at least 2 characters.');
    }
    return this.prisma.customer.create({
      data: {
        tenantId,
        name,
        contactPhone:   dto.contactPhone?.trim() || null,
        contactEmail:   dto.contactEmail?.trim() || null,
        address:        dto.address?.trim()      || null,
        defaultAddress: dto.defaultAddress?.trim() || null,
        notes:          dto.notes?.trim()        || null,
      },
      select: {
        id: true, name: true, contactPhone: true, contactEmail: true,
        address: true, defaultAddress: true, loyaltyVisits: true,
        isActive: true,
      },
    });
  }

  async getOne(tenantId: string, id: string) {
    const c = await this.prisma.customer.findFirst({
      where:  { id, tenantId },
      select: {
        id: true, name: true, contactPhone: true, contactEmail: true,
        address: true, defaultAddress: true, loyaltyVisits: true,
        creditTermDays: true, creditLimit: true, notes: true,
        isActive: true, createdAt: true,
      },
    });
    if (!c) throw new NotFoundException('Customer not found.');
    return c;
  }
}
