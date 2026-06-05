/**
 * Sprint 22 — RecurringBillsService. Mirror of RecurringInvoicesService for
 * AP. Defaults include WHT amount + ATC code so the recurring rent / utility
 * bill captures the standard 5% WI160 withholding.
 *
 * As with AR, the template never posts — the @Cron materializer spawns
 * DRAFT APBill children on the schedule, which the owner reviews + posts
 * (utility amounts vary). The materializer copies whtAmount + whtAtcCode
 * straight into each child.
 */
import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertBranchInTenant } from '../common/tenant-fk-guards';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma, RecurringTemplateStatus } from '@prisma/client';
import { computeNextRunAt } from '../common/recurrence';
import {
  CreateRecurringBillDto, UpdateRecurringBillDto,
} from './dto/recurring-bill.dto';

@Injectable()
export class RecurringBillsService {
  constructor(
    private prisma:    PrismaService,
    private numbering: NumberingService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateRecurringBillDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Recurring template must have at least one line.');
    }

    const vendor = await this.prisma.vendor.findFirst({
      where:  { id: dto.vendorId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');

    const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
    const validAccounts = await this.prisma.account.count({
      where: { id: { in: accountIds }, tenantId, isActive: true },
    });
    if (validAccounts !== accountIds.length) {
      throw new BadRequestException('One or more line accounts are invalid for this tenant.');
    }

    const startDate = new Date(dto.startDate);
    const endDate   = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && endDate.getTime() <= startDate.getTime()) {
      throw new BadRequestException('endDate must be after startDate.');
    }

    const subtotal  = dto.lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0);
    const vatAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
    const total     = dto.lines.reduce((s, l) => s + l.lineTotal, 0);


    // SecAudit 2026-05 T2 — assert dto.branchId belongs to this tenant.
    await assertBranchInTenant(this.prisma, tenantId, dto.branchId);

    return this.prisma.$transaction(async (tx) => {
      const templateNumber = await this.numbering.next(tenantId, 'RECURRING_BILL', null, tx);

      return tx.recurringBillTemplate.create({
        data: {
          tenantId,
          branchId:       dto.branchId ?? null,
          templateNumber,
          name:           dto.name,
          vendorId:       dto.vendorId,
          frequency:      dto.frequency,
          dayOfPeriod:    dto.dayOfPeriod,
          startDate,
          endDate,
          termsDays:      dto.termsDays ?? 0,
          nextRunAt:      startDate,
          subtotal:       new Prisma.Decimal(subtotal),
          vatAmount:      new Prisma.Decimal(vatAmount),
          whtAmount:      new Prisma.Decimal(dto.whtAmount ?? 0),
          whtAtcCode:     dto.whtAtcCode,
          totalAmount:    new Prisma.Decimal(total),
          status:         'ACTIVE',
          description:    dto.description,
          notes:          dto.notes,
          createdById:    userId,
          lines: {
            create: dto.lines.map((l) => ({
              accountId:   l.accountId,
              description: l.description,
              quantity:    new Prisma.Decimal(l.quantity ?? 1),
              unitPrice:   new Prisma.Decimal(l.unitPrice),
              taxAmount:   new Prisma.Decimal(l.taxAmount ?? 0),
              lineTotal:   new Prisma.Decimal(l.lineTotal),
            })),
          },
        },
        include: { lines: true, vendor: { select: { id: true, name: true } } },
      });
    });
  }

  async update(tenantId: string, id: string, _userId: string, dto: UpdateRecurringBillDto) {
    const tpl = await this.prisma.recurringBillTemplate.findFirst({
      where: { id, tenantId }, include: { lines: true },
    });
    if (!tpl) throw new NotFoundException('Recurring template not found.');
    if (!['ACTIVE', 'PAUSED'].includes(tpl.status)) {
      throw new ForbiddenException(`Cannot update template in status ${tpl.status}.`);
    }

    let totals: { subtotal: number; vatAmount: number; total: number } | null = null;
    if (dto.lines) {
      const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
      const valid = await this.prisma.account.count({
        where: { id: { in: accountIds }, tenantId, isActive: true },
      });
      if (valid !== accountIds.length) {
        throw new BadRequestException('One or more line accounts are invalid for this tenant.');
      }
      totals = {
        subtotal:  dto.lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0),
        vatAmount: dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0),
        total:     dto.lines.reduce((s, l) => s + l.lineTotal, 0),
      };
    }

    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    if (endDate && endDate.getTime() <= tpl.startDate.getTime()) {
      throw new BadRequestException('endDate must be after startDate.');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        await tx.recurringBillTemplateLine.deleteMany({ where: { templateId: id } });
      }
      return tx.recurringBillTemplate.update({
        where: { id },
        data: {
          name:        dto.name,
          branchId:    dto.branchId,
          frequency:   dto.frequency,
          dayOfPeriod: dto.dayOfPeriod,
          endDate,
          termsDays:   dto.termsDays,
          whtAmount:   dto.whtAmount  !== undefined ? new Prisma.Decimal(dto.whtAmount) : undefined,
          whtAtcCode:  dto.whtAtcCode,
          description: dto.description,
          notes:       dto.notes,
          ...(totals ? {
            subtotal:    new Prisma.Decimal(totals.subtotal),
            vatAmount:   new Prisma.Decimal(totals.vatAmount),
            totalAmount: new Prisma.Decimal(totals.total),
          } : {}),
          ...(dto.lines ? {
            lines: {
              create: dto.lines.map((l) => ({
                accountId:   l.accountId,
                description: l.description,
                quantity:    new Prisma.Decimal(l.quantity ?? 1),
                unitPrice:   new Prisma.Decimal(l.unitPrice),
                taxAmount:   new Prisma.Decimal(l.taxAmount ?? 0),
                lineTotal:   new Prisma.Decimal(l.lineTotal),
              })),
            },
          } : {}),
        },
        include: { lines: true, vendor: { select: { id: true, name: true } } },
      });
    });
  }

  async pause(tenantId: string, id: string, _userId: string) {
    return this.transition(tenantId, id, 'ACTIVE', 'PAUSED');
  }

  async resume(tenantId: string, id: string, _userId: string) {
    const tpl = await this.prisma.recurringBillTemplate.findFirst({ where: { id, tenantId } });
    if (!tpl) throw new NotFoundException('Recurring template not found.');
    if (tpl.status !== 'PAUSED') {
      throw new BadRequestException(`Cannot resume template in status ${tpl.status}.`);
    }
    const now = new Date();
    let next = tpl.nextRunAt;
    while (next.getTime() < now.getTime()) {
      next = computeNextRunAt(next, tpl.frequency, tpl.dayOfPeriod);
    }
    return this.prisma.recurringBillTemplate.update({
      where: { id }, data: { status: 'ACTIVE', nextRunAt: next },
    });
  }

  async cancel(tenantId: string, id: string, _userId: string) {
    const tpl = await this.prisma.recurringBillTemplate.findFirst({ where: { id, tenantId } });
    if (!tpl) throw new NotFoundException('Recurring template not found.');
    if (['COMPLETED', 'CANCELLED'].includes(tpl.status)) {
      throw new BadRequestException(`Template already in terminal status ${tpl.status}.`);
    }
    return this.prisma.recurringBillTemplate.update({
      where: { id }, data: { status: 'CANCELLED' },
    });
  }

  private async transition(
    tenantId: string, id: string,
    from: RecurringTemplateStatus, to: RecurringTemplateStatus,
  ) {
    const result = await this.prisma.recurringBillTemplate.updateMany({
      where: { id, tenantId, status: from }, data: { status: to },
    });
    if (result.count === 0) {
      throw new BadRequestException(`Template not found or not in status ${from}.`);
    }
    return this.prisma.recurringBillTemplate.findUnique({ where: { id } });
  }

  async findAll(
    tenantId: string,
    opts: { page?: number; pageSize?: number; status?: RecurringTemplateStatus; vendorId?: string },
  ) {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.RecurringBillTemplateWhereInput = { tenantId };
    if (opts.status)   where.status   = opts.status;
    if (opts.vendorId) where.vendorId = opts.vendorId;

    const [data, total] = await Promise.all([
      this.prisma.recurringBillTemplate.findMany({
        where,
        orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize,
        include: {
          vendor: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.recurringBillTemplate.count({ where }),
    ]);
    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, id: string) {
    const tpl = await this.prisma.recurringBillTemplate.findFirst({
      where: { id, tenantId },
      include: {
        lines:  { include: { account: { select: { code: true, name: true } } } },
        vendor: true,
        branch: { select: { id: true, name: true } },
        children: {
          orderBy: { billDate: 'desc' },
          take:    5,
          select:  {
            id: true, billNumber: true, billDate: true,
            totalAmount: true, status: true,
          },
        },
      },
    });
    if (!tpl) throw new NotFoundException('Recurring template not found.');
    return tpl;
  }
}
