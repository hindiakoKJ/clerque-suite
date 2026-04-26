import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePeriodDto } from './dto/create-period.dto';
export { CreatePeriodDto };

@Injectable()
export class AccountingPeriodsService {
  constructor(
    private prisma: PrismaService,
    private audit:  AuditService,
  ) {}

  async list(tenantId: string) {
    const periods = await this.prisma.accountingPeriod.findMany({
      where: { tenantId },
      orderBy: { startDate: 'desc' },
    });

    // Enrich closedById with the user's display name (no Prisma relation defined)
    const closerIds = [...new Set(periods.map((p) => p.closedById).filter(Boolean))] as string[];
    const closers = closerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: closerIds } },
          select: { id: true, name: true },
        })
      : [];
    const closerMap = Object.fromEntries(
      closers.map((u) => [u.id, u.name]),
    );

    return periods.map((p) => ({
      ...p,
      closedBy: p.closedById ? (closerMap[p.closedById] ?? 'Unknown') : null,
    }));
  }

  async create(tenantId: string, dto: CreatePeriodDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (end <= start) {
      throw new BadRequestException('End date must be after start date');
    }

    // Check for overlap with existing periods
    const overlap = await this.prisma.accountingPeriod.findFirst({
      where: {
        tenantId,
        OR: [
          { startDate: { lte: end }, endDate: { gte: start } },
        ],
      },
    });
    if (overlap) {
      throw new BadRequestException(
        `Period overlaps with existing period "${overlap.name}"`,
      );
    }

    return this.prisma.accountingPeriod.create({
      data: {
        tenantId,
        name: dto.name,
        startDate: start,
        endDate: end,
        notes: dto.notes,
        status: 'OPEN',
      },
    });
  }

  /** Close a period — prevents any new journal entries from being posted into it. */
  async closePeriod(tenantId: string, periodId: string, closedById: string, ipAddress?: string) {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, tenantId },
    });
    if (!period) throw new NotFoundException('Accounting period not found');
    if (period.status === 'CLOSED') {
      throw new BadRequestException('Period is already closed');
    }

    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'CLOSED', closedById, closedAt: new Date() },
    });

    // Immutable audit record — fire-and-forget
    void this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'AccountingPeriod',
      entityId:    periodId,
      before:      { status: 'OPEN' },
      after:       { status: 'CLOSED', closedById, closedAt: updated.closedAt },
      description: `Accounting period "${period.name}" closed`,
      performedBy: closedById,
      ipAddress,
    });

    return updated;
  }

  /**
   * Reopen a closed accounting period.
   *
   * Mirrors SAP OB52 behaviour:
   *   - A written reason is mandatory (regulatory requirement).
   *   - Close metadata (closedById, closedAt) is PRESERVED — it is a historical fact
   *     that the period was closed and must remain visible to auditors.
   *   - Reopen metadata (reopenedById, reopenedAt, reopenReason) is written alongside.
   *   - reopenCount is incremented so auditors can immediately see how many times
   *     this period has been opened and closed.
   *   - The action is recorded in the immutable AuditLog.
   */
  async reopenPeriod(
    tenantId:    string,
    periodId:    string,
    reopenedById: string,
    reason:      string,
    ipAddress?:  string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException(
        'A written reason is required to reopen an accounting period.',
      );
    }

    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, tenantId },
    });
    if (!period) throw new NotFoundException('Accounting period not found');
    if (period.status === 'OPEN') {
      throw new BadRequestException('Period is already open');
    }

    const now = new Date();
    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: {
        status:       'OPEN',
        // ── close metadata preserved — do NOT null these out ──────────────
        // closedById and closedAt intentionally left untouched; they are facts.
        // ── reopen metadata ───────────────────────────────────────────────
        reopenedById,
        reopenedAt:   now,
        reopenReason: reason.trim(),
        reopenCount:  { increment: 1 },
      },
    });

    // Immutable audit record — fire-and-forget
    void this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'AccountingPeriod',
      entityId:    periodId,
      before:      { status: 'CLOSED', closedById: period.closedById, closedAt: period.closedAt },
      after:       { status: 'OPEN', reopenedById, reopenedAt: now, reopenReason: reason.trim(),
                     reopenCount: updated.reopenCount },
      description: `Accounting period "${period.name}" reopened. Reason: ${reason.trim()}`,
      performedBy: reopenedById,
      ipAddress,
    });

    return updated;
  }

  /**
   * Check if a given date falls inside a closed period.
   * Used by the journal service before posting any entry.
   */
  async assertDateIsOpen(tenantId: string, date: Date) {
    const closedPeriod = await this.prisma.accountingPeriod.findFirst({
      where: {
        tenantId,
        status: 'CLOSED',
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
    if (closedPeriod) {
      throw new ForbiddenException(
        `Cannot post to a closed accounting period: "${closedPeriod.name}". ` +
        `Ask your Business Owner to reopen it if this was an error.`,
      );
    }
  }
}
