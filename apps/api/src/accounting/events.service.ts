/**
 * EventsService — tenant-scoped AccountingEvent queries.
 *
 * Extracted from EventsController to eliminate direct PrismaService access in controllers
 * (MEDIUM-2 audit finding). All queries enforce tenantId isolation at the service layer,
 * consistent with every other module in the codebase.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    opts: { page?: number; status?: string },
  ) {
    const take = 50;
    const skip = ((opts.page || 1) - 1) * take;

    const where = {
      tenantId,
      ...(opts.status
        ? { status: opts.status as 'PENDING' | 'SYNCED' | 'FAILED' }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.accountingEvent.count({ where }),
      this.prisma.accountingEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          order:        { select: { orderNumber: true } },
          journalEntry: { select: { entryNumber: true, id: true } },
        },
      }),
    ]);

    return { data, total, page: opts.page || 1, pages: Math.ceil(total / take) };
  }

  async stats(tenantId: string) {
    const [pending, synced, failed] = await Promise.all([
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'SYNCED'  } }),
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'FAILED'  } }),
    ]);
    return { pending, synced, failed };
  }
}
