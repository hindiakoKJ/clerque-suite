/**
 * Sprint 22 — RecurringInvoicesService.
 *
 * Manages RecurringInvoiceTemplate rows. Templates themselves never post a
 * journal entry — the @Cron materializer (recurring-invoices.scheduler.ts)
 * spawns DRAFT ARInvoice children on the schedule. Children are left DRAFT
 * intentionally so the owner reviews + posts each one (utility amounts vary
 * month to month).
 *
 * Status lifecycle:
 *   ACTIVE    — materializer will pick this up when nextRunAt <= now
 *   PAUSED    — materializer skips. resume() advances nextRunAt forward to
 *               now-or-later before reactivating, so a long pause doesn't
 *               trigger a flood of back-dated invoices.
 *   COMPLETED — terminal. Set automatically when next nextRunAt > endDate.
 *   CANCELLED — terminal. Owner-initiated.
 *
 * Roles handled at the controller layer (BUSINESS_OWNER, SUPER_ADMIN,
 * ACCOUNTANT, AR_ACCOUNTANT). Service trusts the caller's tenantId.
 */
import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma, RecurringTemplateStatus } from '@prisma/client';
import { computeNextRunAt } from '../common/recurrence';
import {
  CreateRecurringInvoiceDto, UpdateRecurringInvoiceDto,
} from './dto/recurring-invoice.dto';

@Injectable()
export class RecurringInvoicesService {
  constructor(
    private prisma:    PrismaService,
    private numbering: NumberingService,
  ) {}

  // ── Create ────────────────────────────────────────────────────────────────
  async create(tenantId: string, userId: string, dto: CreateRecurringInvoiceDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Recurring template must have at least one line.');
    }

    const customer = await this.prisma.customer.findFirst({
      where:  { id: dto.customerId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');

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

    const created = await this.prisma.$transaction(async (tx) => {
      const templateNumber = await this.numbering.next(tenantId, 'RECURRING_INVOICE', null, tx);

      return tx.recurringInvoiceTemplate.create({
        data: {
          tenantId,
          branchId:       dto.branchId ?? null,
          templateNumber,
          name:           dto.name,
          customerId:     dto.customerId,
          frequency:      dto.frequency,
          dayOfPeriod:    dto.dayOfPeriod,
          startDate,
          endDate,
          termsDays:      dto.termsDays ?? 0,
          // First run = startDate. Subsequent runs are computed by the
          // materializer after each successful child creation.
          nextRunAt:      startDate,
          subtotal:       new Prisma.Decimal(subtotal),
          vatAmount:      new Prisma.Decimal(vatAmount),
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
        include: { lines: true, customer: { select: { id: true, name: true } } },
      });
    });

    // Note: template creation does not write an AuditLog entry — templates
    // create DRAFT children only; each child gets the standard
    // AR_INVOICE_POSTED audit row when (if) it is later posted.

    return created;
  }

  // ── Update ────────────────────────────────────────────────────────────────
  async update(tenantId: string, id: string, userId: string, dto: UpdateRecurringInvoiceDto) {
    const tpl = await this.prisma.recurringInvoiceTemplate.findFirst({
      where: { id, tenantId }, include: { lines: true },
    });
    if (!tpl) throw new NotFoundException('Recurring template not found.');
    if (!['ACTIVE', 'PAUSED'].includes(tpl.status)) {
      throw new ForbiddenException(`Cannot update template in status ${tpl.status}.`);
    }

    // If lines change, recompute totals and revalidate accounts.
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
        await tx.recurringInvoiceTemplateLine.deleteMany({ where: { templateId: id } });
      }
      return tx.recurringInvoiceTemplate.update({
        where: { id },
        data: {
          name:        dto.name,
          branchId:    dto.branchId,
          frequency:   dto.frequency,
          dayOfPeriod: dto.dayOfPeriod,
          endDate,
          termsDays:   dto.termsDays,
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
        include: { lines: true, customer: { select: { id: true, name: true } } },
      });
    });
  }

  // ── Status transitions ────────────────────────────────────────────────────
  async pause(tenantId: string, id: string, userId: string) {
    return this.transition(tenantId, id, userId, 'ACTIVE', 'PAUSED');
  }

  async resume(tenantId: string, id: string, userId: string) {
    // Advance nextRunAt forward to now-or-later so we don't materialize a
    // flood of back-dated invoices for the paused window.
    const tpl = await this.prisma.recurringInvoiceTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!tpl) throw new NotFoundException('Recurring template not found.');
    if (tpl.status !== 'PAUSED') {
      throw new BadRequestException(`Cannot resume template in status ${tpl.status}.`);
    }

    const now = new Date();
    let next = tpl.nextRunAt;
    // Advance until next >= now.
    while (next.getTime() < now.getTime()) {
      next = computeNextRunAt(next, tpl.frequency, tpl.dayOfPeriod);
    }

    return this.prisma.recurringInvoiceTemplate.update({
      where: { id },
      data:  { status: 'ACTIVE', nextRunAt: next },
    });
  }

  async cancel(tenantId: string, id: string, userId: string) {
    const tpl = await this.prisma.recurringInvoiceTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!tpl) throw new NotFoundException('Recurring template not found.');
    if (['COMPLETED', 'CANCELLED'].includes(tpl.status)) {
      throw new BadRequestException(`Template already in terminal status ${tpl.status}.`);
    }
    return this.prisma.recurringInvoiceTemplate.update({
      where: { id }, data: { status: 'CANCELLED' },
    });
  }

  private async transition(
    tenantId: string, id: string, _userId: string,
    from: RecurringTemplateStatus, to: RecurringTemplateStatus,
  ) {
    const result = await this.prisma.recurringInvoiceTemplate.updateMany({
      where: { id, tenantId, status: from },
      data:  { status: to },
    });
    if (result.count === 0) {
      throw new BadRequestException(`Template not found or not in status ${from}.`);
    }
    return this.prisma.recurringInvoiceTemplate.findUnique({ where: { id } });
  }

  // ── Read ──────────────────────────────────────────────────────────────────
  async findAll(
    tenantId: string,
    opts: { page?: number; pageSize?: number; status?: RecurringTemplateStatus; customerId?: string },
  ) {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.RecurringInvoiceTemplateWhereInput = { tenantId };
    if (opts.status)     where.status     = opts.status;
    if (opts.customerId) where.customerId = opts.customerId;

    const [data, total] = await Promise.all([
      this.prisma.recurringInvoiceTemplate.findMany({
        where,
        orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          customer: { select: { id: true, name: true } },
          branch:   { select: { id: true, name: true } },
        },
      }),
      this.prisma.recurringInvoiceTemplate.count({ where }),
    ]);
    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(tenantId: string, id: string) {
    const tpl = await this.prisma.recurringInvoiceTemplate.findFirst({
      where: { id, tenantId },
      include: {
        lines:    { include: { account: { select: { code: true, name: true } } } },
        customer: true,
        branch:   { select: { id: true, name: true } },
        children: {
          orderBy: { invoiceDate: 'desc' },
          take:    5,
          select:  {
            id: true, invoiceNumber: true, invoiceDate: true,
            totalAmount: true, status: true,
          },
        },
      },
    });
    if (!tpl) throw new NotFoundException('Recurring template not found.');
    return tpl;
  }
}
