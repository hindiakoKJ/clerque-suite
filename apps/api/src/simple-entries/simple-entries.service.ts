import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounting/accounts.service';
import { JournalService } from '../accounting/journal.service';
import {
  CreateSimpleEntryDto, SimpleEntryType, ExpenseCategory, PaidFrom,
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
/** Money paid for goods not yet here. Cleared when they arrive, refunded, or written off. */
const PAID_AHEAD = '1063';
const MISC_EXPENSE = '6140';
/**
 * 1075 Machinery & Equipment -- the seeded, OPEN fixed-asset account an
 * espresso machine, fridge or grinder belongs in. (1070 is the PP&E header,
 * 1077 is furniture, 1081 is computers.)
 */
const EQUIPMENT = '1075';
/** 6010 Salaries and Wages -- seeded, OPEN; the same account Payroll debits. */
const WAGES = '6010';

/** Where the money came from, for EQUIPMENT_PURCHASE and WAGES_PAID. */
const PAID_FROM_ACCOUNT: Record<PaidFrom, string> = {
  CASH:  CASH,
  BANK:  BANK,
  OWNER: OWNER_CAPITAL,
};

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
  /*
    Shipping on an online order and the trucker's fee on a supplier delivery
    are the cost of getting the goods here, not of getting people around --
    they belong in gross margin, next to the goods. Transportation (6100)
    stays for parking, fares and fuel.
  */
  FREIGHT:   '5030',
  OTHER:     '6140',
};

const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  RENT:      'Rent',
  UTILITIES: 'Utilities',
  SUPPLIES:  'Supplies',
  REPAIRS:   'Repairs',
  TRANSPORT: 'Transportation',
  FREIGHT:   'Freight / shipping',
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

    // The older kinds move the shop's own money: Cash or Bank only. `source`
    // is their field; `paidFrom` CASH/BANK is accepted too so one form control
    // can drive every kind. Defaults to CASH when neither is sent.
    const requireFunding = (): string => {
      if (dto.source) return FUNDING[dto.source];
      if (dto.paidFrom === 'OWNER') {
        throw new BadRequestException(
          '"Paid by the owner" only applies to equipment and wages. Choose Cash or Bank.',
        );
      }
      return FUNDING[dto.paidFrom ?? 'CASH'];
    };

    // Equipment and wages can also be paid out of the owner's own pocket.
    const paidFrom: PaidFrom = dto.paidFrom ?? dto.source ?? 'CASH';
    const byOwner = paidFrom === 'OWNER' ? ' (paid by the owner)' : '';

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
      case 'PAID_AHEAD':
        return { drCode: PAID_AHEAD, crCode: requireFunding(), description: `Paid ahead for goods${note}` };
      case 'PAID_AHEAD_REFUND':
        return { drCode: requireFunding(), crCode: PAID_AHEAD, description: `Refund of goods paid ahead${note}` };
      case 'PAID_AHEAD_WRITE_OFF':
        return { drCode: MISC_EXPENSE, crCode: PAID_AHEAD, description: `Paid ahead, never received${note}` };
      case 'EQUIPMENT_PURCHASE': {
        const asset = dto.assetName?.trim();
        return {
          drCode: EQUIPMENT,
          crCode: PAID_FROM_ACCOUNT[paidFrom],
          description: `Equipment bought${asset ? `: ${asset}` : ''}${byOwner}${note}`,
        };
      }
      case 'WAGES_PAID':
        return {
          drCode: WAGES,
          crCode: PAID_FROM_ACCOUNT[paidFrom],
          description: `Wages paid${byOwner}${note}`,
        };
      default: {
        // Exhaustiveness guard — DTO validation should prevent reaching here.
        const _never: never = dto.type;
        throw new BadRequestException(`Unknown entry type: ${String(_never)}`);
      }
    }
  }

  async create(tenantId: string, userId: string, dto: CreateSimpleEntryDto) {
    const posting = this.plan(dto);
    const lookup = () => Promise.all([
      this.accounts.findByCode(tenantId, posting.drCode),
      this.accounts.findByCode(tenantId, posting.crCode),
    ]);
    let [drAcct, crAcct] = await lookup();
    if (!drAcct || !crAcct) {
      // A shop set up before an account joined the standard chart (equipment,
      // wages) does not have it yet. Back-fill the missing standard accounts
      // -- it never touches existing ones -- and look again.
      await this.accounts.seedDefaultAccounts(tenantId);
      [drAcct, crAcct] = await lookup();
    }
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
      // The entry date has no time part, so same-day rows tied and came back in
      // arbitrary order -- the entry just saved was not reliably on top, and an
      // owner reversed the wrong one. createdAt (then id) makes the order stable.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
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
