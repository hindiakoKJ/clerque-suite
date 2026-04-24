import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { Prisma } from '@prisma/client';

type LineInput = { accountId: string; debit?: number; credit?: number; description?: string };

export interface CreateJournalDto {
  date: string;
  description: string;
  lines: LineInput[];
}

@Injectable()
export class JournalService {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
  ) {}

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async nextEntryNumber(tenantId: string): Promise<string> {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const count = await this.prisma.journalEntry.count({
      where: { tenantId, date: { gte: new Date(new Date().toISOString().split('T')[0]) } },
    });
    return `JE-${today}-${String(count + 1).padStart(4, '0')}`;
  }

  private validateLines(lines: LineInput[]) {
    if (lines.length < 2) throw new BadRequestException('Journal entry requires at least 2 lines');
    const totalDebit  = lines.reduce((s, l) => s + (l.debit  ?? 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException(
        `Journal entry is out of balance: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`
      );
    }
  }

  // ── Manual journal entry ────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateJournalDto, createdBy?: string) {
    this.validateLines(dto.lines);
    const entryNumber = await this.nextEntryNumber(tenantId);

    return this.prisma.journalEntry.create({
      data: {
        tenantId,
        entryNumber,
        date: new Date(dto.date),
        description: dto.description,
        status: 'POSTED',
        createdBy: createdBy ?? 'MANUAL',
        lines: {
          create: dto.lines.map((l) => ({
            accountId: l.accountId,
            description: l.description,
            debit:  new Prisma.Decimal(l.debit  ?? 0),
            credit: new Prisma.Decimal(l.credit ?? 0),
          })),
        },
      },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
  }

  // ── Process a single AccountingEvent → Journal Entry ────────────────────────

  async processEvent(tenantId: string, eventId: string): Promise<{ skipped?: boolean; journalEntry?: unknown }> {
    const event = await this.prisma.accountingEvent.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!event) throw new NotFoundException('Accounting event not found');
    if (event.status === 'SYNCED') return { skipped: true };

    // Resolve system accounts (lazy-seeded)
    await this.accounts.seedDefaultAccounts(tenantId);

    const getAccount = async (code: string) => {
      const acct = await this.accounts.findByCode(tenantId, code);
      if (!acct) throw new BadRequestException(`System account ${code} not found — please seed chart of accounts`);
      return acct.id;
    };

    const payload = event.payload as Record<string, unknown>;
    const lines: LineInput[] = [];
    let description = '';
    const date = (event.createdAt ?? new Date()).toISOString().split('T')[0];

    try {
      if (event.type === 'SALE') {
        const total    = Number(payload['totalAmount']    ?? 0);
        const vatAmt   = Number(payload['vatAmount']      ?? 0);
        const payments = (payload['payments'] as Array<{ method: string; amount: number }>) ?? [];

        description = `Sale ${payload['orderNumber'] ?? event.id}`;

        // Bug 3 fix: debit side must equal totalAmount, not the raw tendered amounts.
        // Raw cash payment can exceed totalAmount (includes change given back).
        // Compute the cash/digital split from totalAmount proportionally.
        const digitalTotal   = payments.filter(p => p.method !== 'CASH').reduce((s, p) => s + Number(p.amount), 0);
        const digitalPortion = Math.min(digitalTotal, total);          // digital can't exceed total
        const cashPortion    = Math.round((total - digitalPortion) * 100) / 100;  // remainder is cash

        if (cashPortion > 0)    lines.push({ accountId: await getAccount('1010'), debit: cashPortion,    description: 'Cash sales' });
        if (digitalPortion > 0) lines.push({ accountId: await getAccount('1031'), debit: digitalPortion, description: 'Digital wallet sales' });

        lines.push({ accountId: await getAccount('4010'), credit: total - vatAmt, description: 'Sales revenue' });
        lines.push({ accountId: await getAccount('2020'), credit: vatAmt, description: 'Output VAT 12%' });

      } else if (event.type === 'COGS') {
        const cogsLines = (payload['lines'] as Array<{ totalCost: number }>) ?? [];
        const totalCost = cogsLines.reduce((s, l) => s + Number(l.totalCost ?? 0), 0);
        if (totalCost === 0) return { skipped: true };

        description = `COGS ${payload['orderId'] ?? event.id}`;
        lines.push({ accountId: await getAccount('5010'), debit: totalCost,  description: 'Cost of goods sold' });
        lines.push({ accountId: await getAccount('1050'), credit: totalCost, description: 'Inventory deduction' });

      } else if (event.type === 'VOID') {
        // Reversal: fetch original SALE event for the same order
        const origSale = await this.prisma.accountingEvent.findFirst({
          where: { orderId: event.orderId ?? '', type: 'SALE', status: 'SYNCED', tenantId },
          include: { journalEntry: { include: { lines: { include: { account: true } } } } },
        });

        description = `Void reversal ${payload['orderId'] ?? event.id}`;

        if (origSale?.journalEntry) {
          // Mirror original lines with debit/credit swapped
          for (const line of origSale.journalEntry.lines) {
            lines.push({
              accountId: line.accountId,
              debit:  Number(line.credit),
              credit: Number(line.debit),
              description: `Reversal: ${line.description ?? ''}`,
            });
          }
        } else {
          // Fallback: use payload data from this VOID event
          const total  = Number(payload['totalAmount'] ?? 0);
          const vatAmt = Number(payload['vatAmount']   ?? 0);
          lines.push({ accountId: await getAccount('4010'), debit:  total - vatAmt, description: 'Void - reverse revenue' });
          lines.push({ accountId: await getAccount('2020'), debit:  vatAmt,         description: 'Void - reverse VAT' });
          lines.push({ accountId: await getAccount('1010'), credit: total,           description: 'Void - reverse cash' });
        }

      } else {
        // INVENTORY_ADJUSTMENT, SETTLEMENT, etc. — mark as skipped for now
        await this.prisma.accountingEvent.update({
          where: { id: eventId },
          data: { status: 'SYNCED', syncedAt: new Date() },
        });
        return { skipped: true };
      }

      if (lines.length < 2) {
        await this.prisma.accountingEvent.update({
          where: { id: eventId },
          data: { status: 'SYNCED', syncedAt: new Date() },
        });
        return { skipped: true };
      }

      this.validateLines(lines);
      const entryNumber = await this.nextEntryNumber(tenantId);

      const je = await this.prisma.$transaction(async (tx) => {
        const entry = await tx.journalEntry.create({
          data: {
            tenantId,
            accountingEventId: eventId,
            entryNumber,
            date: new Date(date),
            description,
            status: 'POSTED',
            createdBy: 'SYSTEM',
            lines: {
              create: lines.map((l) => ({
                accountId:   l.accountId,
                description: l.description,
                debit:       new Prisma.Decimal(l.debit  ?? 0),
                credit:      new Prisma.Decimal(l.credit ?? 0),
              })),
            },
          },
          include: { lines: { include: { account: { select: { code: true, name: true } } } } },
        });

        await tx.accountingEvent.update({
          where: { id: eventId },
          data: { status: 'SYNCED', syncedAt: new Date() },
        });

        return entry;
      });

      return { journalEntry: je };

    } catch (err) {
      await this.prisma.accountingEvent.update({
        where: { id: eventId },
        data: {
          status: 'FAILED',
          retryCount: { increment: 1 },
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  // ── Process all pending events for a tenant ─────────────────────────────────

  async processAllPending(tenantId: string) {
    const pending = await this.prisma.accountingEvent.findMany({
      where: { tenantId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    let synced = 0, failed = 0, skipped = 0;
    for (const evt of pending) {
      try {
        const result = await this.processEvent(tenantId, evt.id);
        if (result.skipped) skipped++; else synced++;
      } catch { failed++; }
    }
    return { processed: pending.length, synced, failed, skipped };
  }

  // ── List journal entries ─────────────────────────────────────────────────────

  async findAll(tenantId: string, opts: { page?: number; from?: string; to?: string }) {
    const { page = 1, from, to } = opts;
    const take = 50;
    const skip = (page - 1) * take;

    const where: Prisma.JournalEntryWhereInput = {
      tenantId,
      ...(from || to ? {
        date: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to)   } : {}),
        },
      } : {}),
    };

    const [total, entries] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        include: {
          lines: {
            include: { account: { select: { code: true, name: true, type: true } } },
            orderBy: { debit: 'desc' },
          },
          accountingEvent: { select: { type: true, orderId: true } },
        },
      }),
    ]);

    return { data: entries, total, page, pages: Math.ceil(total / take) };
  }

  async findOne(tenantId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      include: {
        lines: {
          include: { account: { select: { code: true, name: true, type: true } } },
          orderBy: { debit: 'desc' },
        },
        accountingEvent: { select: { type: true, orderId: true, payload: true } },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }
}
