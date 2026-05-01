/**
 * JournalTemplatesService — recurring + on-demand JE templates.
 *
 * Use cases:
 *   - Monthly accruals (rent, depreciation, salaries provision)
 *   - Quarterly accruals (insurance amortisation)
 *   - One-shot saved patterns ("month-end utilities allocation")
 *
 * Each template stores a JE skeleton (lines as JSON) with optional
 * frequency. The scheduler runs daily and instantiates due templates
 * automatically; users can also click "Run now" for any template.
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, JournalTemplateFrequency } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';

interface TemplateLine {
  accountId:    string;
  description?: string;
  debit?:       number;
  credit?:      number;
}

@Injectable()
export class JournalTemplatesService {
  constructor(
    private prisma: PrismaService,
    private journal: JournalService,
  ) {}

  /** Compute the next run date based on frequency, anchored to a base date. */
  private computeNextRun(frequency: JournalTemplateFrequency, base = new Date()): Date | null {
    const d = new Date(base);
    switch (frequency) {
      case 'DAILY':     d.setDate(d.getDate() + 1); return d;
      case 'WEEKLY':    d.setDate(d.getDate() + 7); return d;
      case 'MONTHLY':   d.setMonth(d.getMonth() + 1); return d;
      case 'QUARTERLY': d.setMonth(d.getMonth() + 3); return d;
      case 'YEARLY':    d.setFullYear(d.getFullYear() + 1); return d;
      case 'MANUAL':
      default:          return null;
    }
  }

  private validateLines(lines: unknown): asserts lines is TemplateLine[] {
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new BadRequestException('Template must have at least 2 lines.');
    }
    let totalDebit = 0, totalCredit = 0;
    for (const line of lines as TemplateLine[]) {
      if (!line.accountId) throw new BadRequestException('Each line needs an accountId.');
      const d = Number(line.debit  ?? 0);
      const c = Number(line.credit ?? 0);
      if (d > 0 && c > 0) throw new BadRequestException('A line cannot have both debit and credit.');
      if (d <= 0 && c <= 0) throw new BadRequestException('Each line needs a positive debit or credit.');
      totalDebit  += d;
      totalCredit += c;
    }
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new BadRequestException(`Template doesn't balance: ${totalDebit.toFixed(2)} debit vs ${totalCredit.toFixed(2)} credit.`);
    }
  }

  async list(tenantId: string) {
    return this.prisma.journalTemplate.findMany({
      where:   { tenantId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const t = await this.prisma.journalTemplate.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('Template not found.');
    return t;
  }

  async create(tenantId: string, userId: string, dto: {
    name:        string;
    description?: string;
    lines:       TemplateLine[];
    frequency?:  JournalTemplateFrequency;
    /** Initial nextRunAt — defaults to today if frequency != MANUAL */
    nextRunAt?:  string;
  }) {
    if (!dto.name?.trim()) throw new BadRequestException('Name is required.');
    this.validateLines(dto.lines);

    const frequency = dto.frequency ?? 'MANUAL';
    const nextRunAt = frequency === 'MANUAL'
      ? null
      : (dto.nextRunAt ? new Date(dto.nextRunAt) : new Date());

    return this.prisma.journalTemplate.create({
      data: {
        tenantId,
        name:        dto.name.trim(),
        description: dto.description?.trim() ?? null,
        lines:       (dto.lines as unknown) as Prisma.InputJsonValue,
        frequency,
        nextRunAt,
        createdById: userId,
      },
    });
  }

  async update(tenantId: string, id: string, dto: Partial<{
    name:        string;
    description: string | null;
    lines:       TemplateLine[];
    frequency:   JournalTemplateFrequency;
    isActive:    boolean;
    nextRunAt:   string | null;
  }>) {
    const existing = await this.findOne(tenantId, id);
    if (dto.lines) this.validateLines(dto.lines);

    return this.prisma.journalTemplate.update({
      where: { id },
      data: {
        ...(dto.name        !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
        ...(dto.lines       !== undefined ? { lines: (dto.lines as unknown) as Prisma.InputJsonValue } : {}),
        ...(dto.frequency   !== undefined ? { frequency: dto.frequency, nextRunAt: this.computeNextRun(dto.frequency, existing.lastRunAt ?? new Date()) } : {}),
        ...(dto.isActive    !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.nextRunAt   !== undefined ? { nextRunAt: dto.nextRunAt ? new Date(dto.nextRunAt) : null } : {}),
      },
    });
  }

  /**
   * Instantiate the template into a real JournalEntry. Used by both the
   * scheduler (auto-run) and the "Run now" button.
   *
   * Behaviour:
   *  - Posts directly (status=POSTED) — caller is the responsible user.
   *    If JE exceeds the tenant's approval threshold, the journal.create
   *    flow handles the PENDING_APPROVAL transition.
   *  - Updates lastRunAt + nextRunAt (if recurring).
   */
  async runNow(tenantId: string, id: string, userId: string, opts: { date?: string } = {}) {
    const t = await this.findOne(tenantId, id);
    if (!t.isActive) throw new BadRequestException('Template is disabled.');

    const lines = t.lines as unknown as TemplateLine[];
    this.validateLines(lines);

    const today = opts.date ? new Date(opts.date) : new Date();
    const isoDate = today.toISOString().slice(0, 10);

    // Post a JE via the existing journal service so all guards run
    // (period lock, posting control, approval threshold).
    const entry = await this.journal.create(
      tenantId,
      {
        date:        isoDate,
        postingDate: isoDate,
        description: `${t.name} (template ${t.id})`,
        reference:   `TPL:${t.id.slice(-8)}`,
        saveDraft:   false,
        lines: lines.map((l) => ({
          accountId:   l.accountId,
          description: l.description,
          debit:       l.debit  ?? 0,
          credit:      l.credit ?? 0,
        })),
      },
      userId,
      'MANUAL',
    );

    // Bump scheduling
    await this.prisma.journalTemplate.update({
      where: { id },
      data: {
        lastRunAt: today,
        nextRunAt: this.computeNextRun(t.frequency, today),
      },
    });

    return { template: t, entry };
  }

  async delete(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.journalTemplate.delete({ where: { id } });
  }

  /** Used by the scheduler — find every template whose nextRunAt is due. */
  async findDueTemplates(tenantId: string, asOf = new Date()) {
    return this.prisma.journalTemplate.findMany({
      where: {
        tenantId,
        isActive:  true,
        nextRunAt: { lte: asOf, not: null },
        frequency: { not: 'MANUAL' },
      },
    });
  }
}
