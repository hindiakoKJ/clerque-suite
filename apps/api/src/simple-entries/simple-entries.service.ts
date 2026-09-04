import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounting/accounts.service';
import { JournalService } from '../accounting/journal.service';
import {
  CreateSimpleEntryDto, SimpleEntryType, ExpenseCategory,
} from './dto/simple-entry.dto';

/**
 * SIMPLE-tier operational bookkeeping. Translates a plain-language entry into a
 * fixed, balanced 2-line journal entry and posts it to the real books through
 * the existing JournalService (which enforces balance, period-lock, posting
 * control and atomic numbering). No new tables; every entry is a real posted
 * JournalEntry tagged with reference 'SE'.
 *
 * Account codes are all postingControl='OPEN' (verified in accounts.service.ts),
 * so MANUAL-source posting is permitted. The SYSTEM_ONLY 1031 (digital wallet)
 * is intentionally NOT used — GCash/Maya are logged as Bank for v1.
 */

const FUNDING: Record<'CASH' | 'BANK', string> = { CASH: '1010', BANK: '1020' };
const CASH = '1010';
const BANK = '1020';
const OWNER_CAPITAL = '3010';
const OWNER_DRAWING = '3020';
const OTHER_INCOME = '4050';

const EXPENSE_ACCOUNT: Record<ExpenseCategory, string> = {
  RENT:      '6050',
  UTILITIES: '6060',
  /*
    6140, not 6070. Office Supplies Expense (6070) became SYSTEM_ONLY when the
    supplies categories on ingredients started posting to it, and a MANUAL
    entry against a SYSTEM_ONLY account is refused -- so every "Supplies"
    entry from this screen, and every receipt line classed as supplies, has
    failed since. Miscellaneous is the OPEN expense account; the entry's
    description still says "Supplies", which is what the person will search
    for.
  */
  SUPPLIES:  '6140',
  REPAIRS:   '6090',
  TRANSPORT: '6100',
  OTHER:     '6140',
};

const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  RENT:      'Rent',
  UTILITIES: 'Utilities',
  SUPPLIES:  'Supplies',
  REPAIRS:   'Repairs',
  TRANSPORT: 'Transportation',
  OTHER:     'Other',
};

/** Reference marker stamped on every simple entry so we can list them back. */
const SE_REFERENCE = 'SE';

interface Posting {
  drCode: string;
  crCode: string;
  description: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 400 unless `value` is a real YYYY-MM-DD calendar date. */
function assertIsoDate(value: string, field: 'from' | 'to'): void {
  const ok = ISO_DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!ok) throw new BadRequestException(`"${field}" must be a date in YYYY-MM-DD format.`);
}

/** First and last day (YYYY-MM-DD) of the current month in `timeZone`; UTC if the zone is unknown. */
function currentMonthRange(timeZone: string): { first: string; last: string } {
  let ymd: string;
  try {
    // en-CA formats as YYYY-MM-DD.
    ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date());
  } catch {
    ymd = new Date().toISOString().slice(0, 10);
  }
  const [y, m] = ymd.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { first: `${y}-${mm}-01`, last: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class SimpleEntriesService {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
    private journal: JournalService,
  ) {}

  /** Map a plain-language entry to its debit/credit account codes + a label. */
  private plan(dto: CreateSimpleEntryDto): Posting {
    const note = dto.note?.trim() ? ` — ${dto.note.trim()}` : '';
    const fund = FUNDING[dto.source ?? 'CASH'];

    const requireFunding = (): string => {
      if (!dto.source) {
        // Default to CASH if omitted for the money-in/out types.
        return FUNDING.CASH;
      }
      return fund;
    };

    switch (dto.type) {
      case 'EXPENSE': {
        const cat: ExpenseCategory = dto.category ?? 'OTHER';
        return {
          drCode: EXPENSE_ACCOUNT[cat],
          crCode: requireFunding(),
          description: `${EXPENSE_LABEL[cat]} expense${note}`,
        };
      }
      case 'OTHER_INCOME':
        return { drCode: requireFunding(), crCode: OTHER_INCOME, description: `Other income${note}` };
      case 'OWNER_CONTRIBUTION':
        return { drCode: requireFunding(), crCode: OWNER_CAPITAL, description: `Owner contribution${note}` };
      case 'OWNER_DRAWING':
        return { drCode: OWNER_DRAWING, crCode: requireFunding(), description: `Owner drawing${note}` };
      case 'DEPOSIT_TO_BANK':
        return { drCode: BANK, crCode: CASH, description: `Cash deposited to bank${note}` };
      case 'WITHDRAW_TO_CASH':
        return { drCode: CASH, crCode: BANK, description: `Cash withdrawn from bank${note}` };
      default: {
        // Exhaustiveness guard — DTO validation should prevent reaching here.
        const _never: never = dto.type;
        throw new BadRequestException(`Unknown entry type: ${String(_never)}`);
      }
    }
  }

  async create(tenantId: string, userId: string, dto: CreateSimpleEntryDto) {
    const posting = this.plan(dto);
    const [drAcct, crAcct] = await Promise.all([
      this.accounts.findByCode(tenantId, posting.drCode),
      this.accounts.findByCode(tenantId, posting.crCode),
    ]);
    if (!drAcct || !crAcct) {
      throw new BadRequestException(
        'Your bookkeeping accounts are not fully set up yet. Please contact support.',
      );
    }

    const amount = Math.round(dto.amount * 100) / 100;

    const je = await this.journal.create(
      tenantId,
      {
        date: dto.date,
        description: posting.description,
        reference: SE_REFERENCE,
        lines: [
          { accountId: drAcct.id, debit: amount, description: posting.description },
          { accountId: crAcct.id, credit: amount, description: posting.description },
        ],
      },
      userId,
      'MANUAL',
    );

    return {
      id:          je.id,
      entryNumber: je.entryNumber,
      date:        je.date,
      description: je.description,
      amount,
      status:      je.status, // POSTED, or PENDING_APPROVAL if a JE threshold is set
      type:        dto.type as SimpleEntryType,
    };
  }

  /**
   * Plain-English profit summary for a date range (inclusive, by posting date).
   * Reuses AccountsService.getPLSummary — the same numbers the full P&L shows —
   * so a SIMPLE tenant (who cannot reach the advancedAccounting reports) still
   * sees their profit. moneyIn = revenue-type accounts, moneyOut = expense-type
   * accounts (COGS is an EXPENSE-type account here), profit = in − out.
   *
   * from/to default to the current calendar month in the tenant's timezone.
   */
  async summary(tenantId: string, from?: string, to?: string) {
    if (from !== undefined) assertIsoDate(from, 'from');
    if (to   !== undefined) assertIsoDate(to,   'to');

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { currency: true, timezone: true },
    });
    const currency = tenant?.currency ?? 'PHP';

    if (from === undefined || to === undefined) {
      const { first, last } = currentMonthRange(tenant?.timezone ?? 'UTC');
      from ??= first;
      to   ??= last;
    }
    if (from > to) {
      throw new BadRequestException('"from" date must be on or before "to" date.');
    }

    const pl = await this.accounts.getPLSummary(tenantId, from, to);
    const moneyIn  = round2(pl.totalRevenue);
    const moneyOut = round2(pl.totalExpenses);
    return { from, to, moneyIn, moneyOut, profit: round2(moneyIn - moneyOut), currency };
  }

  /** Recent simple entries for this tenant (newest first). */
  async list(tenantId: string) {
    const rows = await this.prisma.journalEntry.findMany({
      where:   { tenantId, reference: SE_REFERENCE, status: 'POSTED' },
      orderBy: { date: 'desc' },
      take:    50,
      include: { lines: true, reversedBy: { select: { entryNumber: true } } },
    });
    return rows.map((r) => ({
      id:               r.id,
      entryNumber:      r.entryNumber,
      date:             r.date,
      description:      r.description,
      amount:           r.lines.reduce((s, l) => s + Number(l.debit), 0),
      reversed:         !!r.reversedBy,
      reversedByNumber: r.reversedBy?.entryNumber ?? null,
    }));
  }

  /**
   * Reverse a simple entry the owner recorded by mistake. Posts a balanced
   * offsetting entry (debit/credit flipped) and links it to the original —
   * the original is kept for the audit trail (proper accounting: reverse,
   * don't delete).
   *
   * SECURITY: only entries this feature created (reference 'SE') may be
   * reversed here — never a system-generated SALE/COGS/settlement JE, which
   * would corrupt the books. journal.reverse() adds POSTED-only + already-
   * reversed guards and tenant scoping on top.
   */
  async reverse(tenantId: string, userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where:  { id, tenantId, reference: SE_REFERENCE },
      select: { id: true },
    });
    if (!entry) {
      throw new BadRequestException('You can only reverse entries you recorded here.');
    }
    const reversal = await this.journal.reverse(tenantId, id, userId);
    return {
      id:          reversal.id,
      entryNumber: reversal.entryNumber,
      reversalOf:  id,
    };
  }
}
