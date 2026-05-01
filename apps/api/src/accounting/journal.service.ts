import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { Prisma, JournalSource } from '@prisma/client';

type LineInput = { accountId: string; debit?: number; credit?: number; description?: string };

export interface CreateJournalDto {
  date:         string;           // Document Date — when the economic event occurred
  postingDate?: string;           // Posting Date — which period it lands in; defaults to date
  description:  string;
  reference?:   string;           // External ref: invoice #, OR #, voucher #
  lines:        LineInput[];
  saveDraft?:   boolean;          // if true → status DRAFT, else POSTED immediately
}

@Injectable()
export class JournalService {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
    private periods: AccountingPeriodsService,
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
        `Journal entry is out of balance: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`,
      );
    }
  }

  /**
   * Guard: check that no manually-entered line targets an AP/AR/SYSTEM-only account.
   * Pass source='SYSTEM' to bypass (used by the @Cron event processor).
   * Pass source='AP' / 'AR' to allow their respective sub-ledger accounts.
   */
  private async assertPostingControl(
    tenantId: string,
    lines: LineInput[],
    source: JournalSource = 'MANUAL',
  ) {
    const accountIds = lines.map((l) => l.accountId).filter(Boolean);
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, tenantId },
      select: { id: true, code: true, name: true, postingControl: true },
    });

    for (const acct of accounts) {
      const ctrl = acct.postingControl;
      if (ctrl === 'OPEN') continue;
      if (ctrl === 'SYSTEM_ONLY' && source === 'SYSTEM') continue;
      if (ctrl === 'AP_ONLY'     && source === 'AP')     continue;
      if (ctrl === 'AR_ONLY'     && source === 'AR')     continue;

      const who = ctrl === 'AP_ONLY'     ? 'the AP module (Phase 4)'
               : ctrl === 'AR_ONLY'     ? 'the AR module (Phase 5)'
               : 'the system event processor';

      throw new ForbiddenException(
        `Account ${acct.code} — ${acct.name} is restricted. Only ${who} may post to it. ` +
        `Remove it from this manual journal entry.`,
      );
    }
  }

  // ── Manual journal entry ────────────────────────────────────────────────────

  async create(
    tenantId: string,
    dto: CreateJournalDto,
    createdBy?: string,
    source: JournalSource = 'MANUAL',
  ) {
    this.validateLines(dto.lines);

    // 1. Posting control guard (skip for system/AP/AR sources)
    await this.assertPostingControl(tenantId, dto.lines, source);

    // 2. Period lock guard (skip for DRAFTs — they're not yet posted)
    //    Period lock uses postingDate; falls back to document date if not set.
    let status: 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' = dto.saveDraft ? 'DRAFT' : 'POSTED';
    const postingDate = new Date(dto.postingDate ?? dto.date);
    if (status === 'POSTED') {
      await this.periods.assertDateIsOpen(tenantId, postingDate);
    }

    // 3. JE approval threshold — only checked for MANUAL source attempting to
    //    POST directly. Drafts skip; system/AR/AP-sourced entries skip.
    if (status === 'POSTED' && source === 'MANUAL') {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { jeApprovalThreshold: true },
      });
      const threshold = Number(tenant?.jeApprovalThreshold ?? 0);
      if (threshold > 0) {
        const totalDebit = dto.lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
        if (totalDebit >= threshold) {
          status = 'PENDING_APPROVAL';
        }
      }
    }

    const entryNumber = await this.nextEntryNumber(tenantId);

    return this.prisma.journalEntry.create({
      data: {
        tenantId,
        entryNumber,
        date:        new Date(dto.date),
        postingDate,
        description: dto.description,
        reference:   dto.reference ?? null,
        status,
        source,
        createdBy:   createdBy ?? 'MANUAL',
        postedAt:    status === 'POSTED' ? new Date() : null,
        postedBy:    status === 'POSTED' ? (createdBy ?? null) : null,
        lines: {
          create: dto.lines.map((l) => ({
            accountId:   l.accountId,
            description: l.description,
            debit:       new Prisma.Decimal(l.debit  ?? 0),
            credit:      new Prisma.Decimal(l.credit ?? 0),
          })),
        },
      },
      include: {
        lines: { include: { account: { select: { code: true, name: true } } } },
      },
    });
  }

  // ── Post a DRAFT entry ──────────────────────────────────────────────────────

  async post(tenantId: string, id: string, postedBy: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== 'DRAFT') {
      throw new BadRequestException(`Entry is already ${entry.status.toLowerCase()} — only DRAFT entries can be posted`);
    }

    // Re-run guards at post time
    // Period lock checks postingDate; falls back to document date for old entries.
    const lineInputs = entry.lines.map((l) => ({
      accountId: l.accountId,
      debit:  Number(l.debit),
      credit: Number(l.credit),
    }));
    await this.assertPostingControl(tenantId, lineInputs, 'MANUAL');
    await this.periods.assertDateIsOpen(tenantId, entry.postingDate ?? entry.date);

    // HIGH-1 TOCTOU fix: updateMany with compound { id, tenantId, status: 'DRAFT' }
    // ensures the write is atomically scoped to this tenant and the correct draft state.
    // A plain update({ where: { id } }) would succeed even if tenantId changed between
    // the findFirst check above and the write here.
    await this.prisma.journalEntry.updateMany({
      where: { id, tenantId, status: 'DRAFT' },
      data:  { status: 'POSTED', postedBy, postedAt: new Date() },
    });

    // Re-fetch with full includes for the response (updateMany does not return rows)
    return this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      include: {
        lines: { include: { account: { select: { code: true, name: true } } } },
      },
    });
  }

  // ── Approve a PENDING_APPROVAL entry ────────────────────────────────────────
  /**
   * Move a JE from PENDING_APPROVAL → POSTED. Approver must be different
   * from the entry's creator (Segregation of Duties); enforced unless
   * the approver is BUSINESS_OWNER (tenant owner can self-approve their
   * own large entries — they're the final authority).
   */
  async approveEntry(tenantId: string, id: string, approverId: string, approverRole: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where:   { id, tenantId },
      select:  { id: true, status: true, createdBy: true, postingDate: true, date: true },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Entry is ${entry.status} — only PENDING_APPROVAL entries can be approved.`);
    }
    if (entry.createdBy === approverId && approverRole !== 'BUSINESS_OWNER' && approverRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Segregation of Duties — the approver cannot be the same person who created the entry. Have a different supervisor approve.',
      );
    }
    // Re-check period lock at approval time (could have closed since draft)
    await this.periods.assertDateIsOpen(tenantId, entry.postingDate ?? entry.date);

    await this.prisma.journalEntry.updateMany({
      where: { id, tenantId, status: 'PENDING_APPROVAL' },
      data:  {
        status:       'POSTED',
        approvedById: approverId,
        approvedAt:   new Date(),
        postedBy:     approverId,
        postedAt:     new Date(),
      },
    });
    return this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
  }

  /** Reject a PENDING_APPROVAL entry — moves it back to DRAFT with a reason. */
  async rejectEntry(tenantId: string, id: string, approverId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Rejection reason is required.');
    const entry = await this.prisma.journalEntry.findFirst({
      where:  { id, tenantId },
      select: { id: true, status: true },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Entry is ${entry.status} — only PENDING_APPROVAL entries can be rejected.`);
    }
    await this.prisma.journalEntry.updateMany({
      where: { id, tenantId, status: 'PENDING_APPROVAL' },
      data:  { status: 'DRAFT', rejectionReason: reason.trim(), approvedById: approverId, approvedAt: new Date() },
    });
    return this.prisma.journalEntry.findFirst({ where: { id, tenantId } });
  }

  // ── Reverse a POSTED entry ──────────────────────────────────────────────────

  async reverse(tenantId: string, id: string, reversedBy: string, reverseDate?: string) {
    const original = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      include: {
        lines:      { include: { account: { select: { code: true, name: true, postingControl: true } } } },
        reversedBy: true,
      },
    });
    if (!original) throw new NotFoundException('Journal entry not found');
    if (original.status !== 'POSTED') {
      throw new BadRequestException('Only POSTED entries can be reversed');
    }
    if (original.reversedBy) {
      throw new BadRequestException(
        `Entry ${original.entryNumber} has already been reversed by ${original.reversedBy.entryNumber}`,
      );
    }

    // Reversal posting date = reverseDate (user-chosen) or today
    const targetDate = reverseDate ? new Date(reverseDate) : new Date();
    await this.periods.assertDateIsOpen(tenantId, targetDate);

    const entryNumber = await this.nextEntryNumber(tenantId);
    const description = `Reversal of ${original.entryNumber}: ${original.description}`;

    const reversal = await this.prisma.journalEntry.create({
      data: {
        tenantId,
        entryNumber,
        date:        targetDate,   // document date = reversal date
        postingDate: targetDate,   // posting date = reversal date (same for reversals)
        description,
        status:      'POSTED',
        source:      original.source,
        createdBy:   reversedBy,
        postedBy:    reversedBy,
        postedAt:    new Date(),
        // Link back to original
        reversalOfId: original.id,
        lines: {
          create: original.lines.map((l) => ({
            accountId:   l.accountId,
            description: `Reversal: ${l.description ?? original.description}`,
            debit:       new Prisma.Decimal(Number(l.credit)), // flip
            credit:      new Prisma.Decimal(Number(l.debit)),  // flip
          })),
        },
      },
      include: {
        lines: { include: { account: { select: { code: true, name: true } } } },
      },
    });

    return reversal;
  }

  // ── Process a single AccountingEvent → Journal Entry ────────────────────────

  async processEvent(tenantId: string, eventId: string): Promise<{ skipped?: boolean; journalEntry?: unknown }> {
    const event = await this.prisma.accountingEvent.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!event) throw new NotFoundException('Accounting event not found');
    if (event.status === 'SYNCED') return { skipped: true };

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

        const digitalTotal   = payments.filter(p => p.method !== 'CASH').reduce((s, p) => s + Number(p.amount), 0);
        const digitalPortion = Math.min(digitalTotal, total);
        const cashPortion    = Math.round((total - digitalPortion) * 100) / 100;

        if (cashPortion > 0)    lines.push({ accountId: await getAccount('1010'), debit: cashPortion,    description: 'Cash sales' });
        if (digitalPortion > 0) lines.push({ accountId: await getAccount('1031'), debit: digitalPortion, description: 'Digital wallet sales' });

        lines.push({ accountId: await getAccount('4010'), credit: total - vatAmt, description: 'Sales revenue' });
        lines.push({ accountId: await getAccount('2020'), credit: vatAmt,         description: 'Output VAT 12%' });

      } else if (event.type === 'COGS') {
        const cogsLines = (payload['lines'] as Array<{ totalCost: number }>) ?? [];
        const totalCost = cogsLines.reduce((s, l) => s + Number(l.totalCost ?? 0), 0);
        if (totalCost === 0) return { skipped: true };

        description = `COGS ${payload['orderId'] ?? event.id}`;
        lines.push({ accountId: await getAccount('5010'), debit: totalCost,  description: 'Cost of goods sold' });
        lines.push({ accountId: await getAccount('1050'), credit: totalCost, description: 'Inventory deduction' });

      } else if (event.type === 'VOID') {
        const origSale = await this.prisma.accountingEvent.findFirst({
          where: { orderId: event.orderId ?? '', type: 'SALE', status: 'SYNCED', tenantId },
          include: { journalEntry: { include: { lines: { include: { account: true } } } } },
        });

        description = `Void reversal ${payload['orderId'] ?? event.id}`;

        if (origSale?.journalEntry) {
          for (const line of origSale.journalEntry.lines) {
            lines.push({
              accountId: line.accountId,
              debit:     Number(line.credit),
              credit:    Number(line.debit),
              description: `Reversal: ${line.description ?? ''}`,
            });
          }
        } else {
          const total  = Number(payload['totalAmount'] ?? 0);
          const vatAmt = Number(payload['vatAmount']   ?? 0);
          lines.push({ accountId: await getAccount('4010'), debit:  total - vatAmt, description: 'Void - reverse revenue' });
          lines.push({ accountId: await getAccount('2020'), debit:  vatAmt,         description: 'Void - reverse VAT' });
          lines.push({ accountId: await getAccount('1010'), credit: total,           description: 'Void - reverse cash' });
        }

      } else if (event.type === 'INVENTORY_ADJUSTMENT') {
        const totalValue     = Number(payload['totalValue']     ?? 0);
        const quantity       = Number(payload['quantity']       ?? 0);
        const adjustmentType = String(payload['adjustmentType'] ?? '');
        const productName    = String(payload['productName']    ?? 'Product');
        const reason         = payload['reason'] ? String(payload['reason']) : null;

        // Skip zero-value entries (no cost price set on product)
        if (totalValue === 0) {
          await this.prisma.accountingEvent.update({
            where: { id: eventId },
            data: { status: 'SYNCED', syncedAt: new Date() },
          });
          return { skipped: true };
        }

        description = `Inventory ${adjustmentType.toLowerCase().replace('_', ' ')}: ${productName}${reason ? ` — ${reason}` : ''}`;

        if (quantity > 0) {
          // Stock increase: DR Merchandise Inventory / CR Owner's Capital
          // (Owner's Capital is the default source for manual stock additions;
          //  for supplier purchases this will move to AP when AP module is built.)
          lines.push({ accountId: await getAccount('1050'), debit:  totalValue, description: `Stock received: ${productName}` });
          lines.push({ accountId: await getAccount('3010'), credit: totalValue, description: 'Owner equity — inventory funded' });
        } else {
          // Stock reduction / write-off: DR COGS / CR Merchandise Inventory
          const absValue = Math.abs(totalValue);
          lines.push({ accountId: await getAccount('5010'), debit:  absValue, description: `Inventory write-off: ${productName}` });
          lines.push({ accountId: await getAccount('1050'), credit: absValue, description: `Stock removed: ${productName}` });
        }

      } else {
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

      // Guard: system events must also respect period lock.
      // If the period is closed, mark the event FAILED — the cron will not retry it,
      // and the accountant must either reopen the period or write a manual adjustment.
      const eventDate = new Date(date);
      try {
        await this.periods.assertDateIsOpen(tenantId, eventDate);
      } catch (periodErr) {
        await this.prisma.accountingEvent.update({
          where: { id: eventId },
          data: {
            status:     'FAILED',
            retryCount: { increment: 1 },
            lastError:  periodErr instanceof Error ? periodErr.message : String(periodErr),
          },
        });
        throw periodErr; // propagate so caller knows
      }

      const je = await this.prisma.$transaction(async (tx) => {
        const entry = await tx.journalEntry.create({
          data: {
            tenantId,
            accountingEventId: eventId,
            entryNumber,
            date:        eventDate,
            postingDate: eventDate, // system events post to the period of the event
            description,
            status:      'POSTED',
            source:      'SYSTEM',
            createdBy:   'SYSTEM',
            postedBy:    'SYSTEM',
            postedAt:    new Date(),
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
          status:     'FAILED',
          retryCount: { increment: 1 },
          lastError:  err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  // ── Process all pending events for a tenant ─────────────────────────────────

  async processAllPending(tenantId: string) {
    let synced = 0, failed = 0, skipped = 0, processed = 0;
    const BATCH = 100;

    while (true) {
      const pending = await this.prisma.accountingEvent.findMany({
        where: { tenantId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });
      if (pending.length === 0) break;

      for (const evt of pending) {
        try {
          const result = await this.processEvent(tenantId, evt.id);
          if (result.skipped) skipped++; else synced++;
        } catch { failed++; }
        processed++;
      }

      if (pending.length < BATCH) break;
    }

    return { processed, synced, failed, skipped };
  }

  // ── List journal entries ─────────────────────────────────────────────────────

  async findAll(tenantId: string, opts: { page?: number; from?: string; to?: string; status?: string }) {
    const { page = 1, from, to, status } = opts;
    const take = 50;
    const skip = (page - 1) * take;

    // Date filter: prefer postingDate; fall back to document date for legacy entries.
    const dateRange = (from || to) ? {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    } : undefined;

    const where: Prisma.JournalEntryWhereInput = {
      tenantId,
      ...(status ? { status: status as any } : {}),
      ...(dateRange ? {
        OR: [
          { postingDate: dateRange },
          { postingDate: null, date: dateRange },
        ],
      } : {}),
    };

    const [total, entries] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          lines: {
            include: { account: { select: { code: true, name: true, type: true } } },
            orderBy: { debit: 'desc' },
          },
          accountingEvent: { select: { type: true, orderId: true } },
          reversalOf:  { select: { id: true, entryNumber: true } },
          reversedBy:  { select: { id: true, entryNumber: true } },
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
        reversalOf:  { select: { id: true, entryNumber: true } },
        reversedBy:  { select: { id: true, entryNumber: true } },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }
}
