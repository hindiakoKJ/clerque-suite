import { BadRequestException } from '@nestjs/common';
import { SimpleEntriesService } from './simple-entries.service';
import { CreateSimpleEntryDto } from './dto/simple-entry.dto';

/**
 * Verifies the financial core: each plain-language entry type maps to the
 * correct, balanced debit/credit account codes. Account ids are mocked as
 * `acct-<code>` so we can assert the code that was posted.
 */
describe('SimpleEntriesService', () => {
  let svc: SimpleEntriesService;
  let captured: { lines: Array<{ accountId: string; debit?: number; credit?: number }>; reference?: string } | null;

  const accounts = {
    findByCode: jest.fn((_t: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })),
    getPLSummary: jest.fn(),
    seedDefaultAccounts: jest.fn(() => Promise.resolve()),
  };
  const journal = {
    create: jest.fn((_t: string, dto: any) => {
      captured = dto;
      return Promise.resolve({ id: 'je1', entryNumber: 'JE-1', date: new Date(dto.date), description: dto.description, status: 'POSTED' });
    }),
    reverse: jest.fn((_t: string, _id: string, _u: string) =>
      Promise.resolve({ id: 'rev1', entryNumber: 'JE-REV-1' })),
  };
  const prisma = {
    journalEntry: { findMany: jest.fn(), findFirst: jest.fn() },
    tenant: { findUnique: jest.fn() },
  };

  const TID = 'tenant-1';
  const UID = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    captured = null;
    svc = new SimpleEntriesService(prisma as any, accounts as any, journal as any);
  });

  const dr = () => captured!.lines.find((l) => l.debit != null)!.accountId;
  const cr = () => captured!.lines.find((l) => l.credit != null)!.accountId;
  const balanced = () => {
    const d = captured!.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const c = captured!.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    return Math.abs(d - c) < 0.001;
  };
  const run = (dto: Partial<CreateSimpleEntryDto>) =>
    svc.create(TID, UID, { amount: 1000, date: '2026-06-24', ...dto } as CreateSimpleEntryDto);

  it('EXPENSE (rent, from bank) → DR 6050 / CR 1020, balanced', async () => {
    await run({ type: 'EXPENSE', source: 'BANK', category: 'RENT', amount: 15000 });
    expect(dr()).toBe('acct-6050');
    expect(cr()).toBe('acct-1020');
    expect(balanced()).toBe(true);
  });

  it('EXPENSE with no category → misc 6140; default funding is CASH', async () => {
    await run({ type: 'EXPENSE' });
    expect(dr()).toBe('acct-6140');
    expect(cr()).toBe('acct-1010');
  });

  it('EXPENSE categories map to the right account', async () => {
    const map: Record<string, string> = {
      UTILITIES: '6060', SUPPLIES: '6140', REPAIRS: '6090', TRANSPORT: '6100', OTHER: '6140',
    };
    for (const [cat, code] of Object.entries(map)) {
      await run({ type: 'EXPENSE', category: cat as any, source: 'CASH' });
      expect(dr()).toBe(`acct-${code}`);
    }
  });

  it('OTHER_INCOME (cash) → DR 1010 / CR 4050', async () => {
    await run({ type: 'OTHER_INCOME', source: 'CASH' });
    expect(dr()).toBe('acct-1010');
    expect(cr()).toBe('acct-4050');
    expect(balanced()).toBe(true);
  });

  it('OWNER_CONTRIBUTION (bank) → DR 1020 / CR 3010', async () => {
    await run({ type: 'OWNER_CONTRIBUTION', source: 'BANK' });
    expect(dr()).toBe('acct-1020');
    expect(cr()).toBe('acct-3010');
  });

  it('OWNER_DRAWING (cash) → DR 3020 / CR 1010', async () => {
    await run({ type: 'OWNER_DRAWING', source: 'CASH' });
    expect(dr()).toBe('acct-3020');
    expect(cr()).toBe('acct-1010');
  });

  it('DEPOSIT_TO_BANK → DR 1020 / CR 1010', async () => {
    await run({ type: 'DEPOSIT_TO_BANK' });
    expect(dr()).toBe('acct-1020');
    expect(cr()).toBe('acct-1010');
    expect(balanced()).toBe(true);
  });

  it('WITHDRAW_TO_CASH → DR 1010 / CR 1020', async () => {
    await run({ type: 'WITHDRAW_TO_CASH' });
    expect(dr()).toBe('acct-1010');
    expect(cr()).toBe('acct-1020');
  });

  it('PAID_AHEAD (bank) → DR 1063 / CR 1020: money waits in the clearing account', async () => {
    await run({ type: 'PAID_AHEAD', source: 'BANK' });
    expect(dr()).toBe('acct-1063');
    expect(cr()).toBe('acct-1020');
    expect(balanced()).toBe(true);
  });

  it('PAID_AHEAD_REFUND (bank) → DR 1020 / CR 1063', async () => {
    await run({ type: 'PAID_AHEAD_REFUND', source: 'BANK' });
    expect(dr()).toBe('acct-1020');
    expect(cr()).toBe('acct-1063');
  });

  it('PAID_AHEAD_WRITE_OFF → DR 6140 / CR 1063: the parcel never came', async () => {
    await run({ type: 'PAID_AHEAD_WRITE_OFF' });
    expect(dr()).toBe('acct-6140');
    expect(cr()).toBe('acct-1063');
  });

  it('amount is posted on both legs and reference is stamped SE', async () => {
    await run({ type: 'EXPENSE', source: 'CASH', amount: 250.5 });
    const debit = captured!.lines.find((l) => l.debit != null)!.debit;
    const credit = captured!.lines.find((l) => l.credit != null)!.credit;
    expect(debit).toBe(250.5);
    expect(credit).toBe(250.5);
    expect(captured!.reference).toBe('SE');
  });

  it('posts with MANUAL source and the acting user', async () => {
    await run({ type: 'EXPENSE', source: 'CASH' });
    expect(journal.create).toHaveBeenCalledWith(TID, expect.anything(), UID, 'MANUAL');
  });

  it('throws a friendly error if an account is still missing after the back-fill', async () => {
    // Two lookups (before and after the back-fill) x two accounts.
    for (let i = 0; i < 4; i++) accounts.findByCode.mockResolvedValueOnce(null as any);
    await expect(run({ type: 'EXPENSE', source: 'CASH' })).rejects.toThrow(/not fully set up/i);
    expect(accounts.seedDefaultAccounts).toHaveBeenCalledWith(TID);
    expect(journal.create).not.toHaveBeenCalled();
  });

  it('an older shop missing a standard account gets it back-filled, then the entry posts', async () => {
    // First lookup: the wages account is not there yet. After the back-fill it is.
    accounts.findByCode.mockResolvedValueOnce(null as any);
    await run({ type: 'WAGES_PAID', paidFrom: 'CASH' });
    expect(accounts.seedDefaultAccounts).toHaveBeenCalledTimes(1);
    expect(dr()).toBe('acct-6010');
    expect(cr()).toBe('acct-1010');
  });

  it('does not touch the chart when every account is already there', async () => {
    await run({ type: 'WAGES_PAID', paidFrom: 'CASH' });
    expect(accounts.seedDefaultAccounts).not.toHaveBeenCalled();
  });

  // ── Equipment bought / wages paid ──────────────────────────────────────────

  it('EQUIPMENT_PURCHASE (cash) → DR 1075 Machinery & Equipment / CR 1010, balanced', async () => {
    await run({ type: 'EQUIPMENT_PURCHASE', paidFrom: 'CASH', assetName: 'Espresso machine', amount: 85000 });
    expect(dr()).toBe('acct-1075');
    expect(cr()).toBe('acct-1010');
    expect(balanced()).toBe(true);
    expect((captured as any).description).toBe('Equipment bought: Espresso machine');
  });

  it('EQUIPMENT_PURCHASE (bank) → CR 1020', async () => {
    await run({ type: 'EQUIPMENT_PURCHASE', paidFrom: 'BANK', assetName: 'Chest freezer' });
    expect(dr()).toBe('acct-1075');
    expect(cr()).toBe('acct-1020');
  });

  it("EQUIPMENT_PURCHASE (owner's own money) → CR 3010 Owner's Capital, and says so", async () => {
    await run({ type: 'EQUIPMENT_PURCHASE', paidFrom: 'OWNER', assetName: 'Grinder', note: 'from savings' });
    expect(dr()).toBe('acct-1075');
    expect(cr()).toBe('acct-3010');
    expect((captured as any).description).toBe('Equipment bought: Grinder (paid by the owner) — from savings');
  });

  it('EQUIPMENT_PURCHASE with no asset name still posts, with a plain description', async () => {
    await run({ type: 'EQUIPMENT_PURCHASE' });
    expect(dr()).toBe('acct-1075');
    expect(cr()).toBe('acct-1010'); // defaults to cash
    expect((captured as any).description).toBe('Equipment bought');
  });

  it('WAGES_PAID (cash) → DR 6010 Salaries and Wages / CR 1010, balanced', async () => {
    await run({ type: 'WAGES_PAID', paidFrom: 'CASH', amount: 3500, note: 'Ana, week of Sep 14' });
    expect(dr()).toBe('acct-6010');
    expect(cr()).toBe('acct-1010');
    expect(balanced()).toBe(true);
    expect((captured as any).description).toBe('Wages paid — Ana, week of Sep 14');
  });

  it('WAGES_PAID (bank) → CR 1020; (owner) → CR 3010', async () => {
    await run({ type: 'WAGES_PAID', paidFrom: 'BANK' });
    expect(cr()).toBe('acct-1020');
    await run({ type: 'WAGES_PAID', paidFrom: 'OWNER' });
    expect(cr()).toBe('acct-3010');
  });

  it('the new kinds also accept the older `source` field', async () => {
    await run({ type: 'WAGES_PAID', source: 'BANK' });
    expect(cr()).toBe('acct-1020');
  });

  it('the older kinds accept paidFrom CASH/BANK, but refuse OWNER in plain words', async () => {
    await run({ type: 'EXPENSE', category: 'RENT', paidFrom: 'BANK' });
    expect(cr()).toBe('acct-1020');
    await expect(run({ type: 'EXPENSE', paidFrom: 'OWNER' })).rejects.toThrow(/only applies to equipment and wages/i);
  });

  it('list: newest first with a stable order for same-day entries', async () => {
    prisma.journalEntry.findMany.mockResolvedValueOnce([]);
    await svc.list(TID);
    expect(prisma.journalEntry.findMany.mock.calls[0][0].orderBy).toEqual([
      { date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' },
    ]);
  });

  it('reverse: delegates to journal.reverse for a simple entry', async () => {
    prisma.journalEntry.findFirst.mockResolvedValueOnce({ id: 'je1' } as any);
    const out = await svc.reverse(TID, UID, 'je1');
    expect(journal.reverse).toHaveBeenCalledWith(TID, 'je1', UID);
    expect(out).toEqual({ id: 'rev1', entryNumber: 'JE-REV-1', reversalOf: 'je1' });
  });

  it('reverse: refuses to reverse a non-simple entry (e.g. a sale JE)', async () => {
    prisma.journalEntry.findFirst.mockResolvedValueOnce(null as any);
    await expect(svc.reverse(TID, UID, 'sale-je')).rejects.toThrow(/only reverse entries you recorded/i);
    expect(journal.reverse).not.toHaveBeenCalled();
  });

  // ── summary (money in / money out / profit) ────────────────────────────────

  /**
   * summary() delegates to AccountsService.getPLSummary (the real P&L query).
   * Mock it the way the real one behaves: revenue = credits − debits,
   * expense = debits − credits, per account, from the posted lines.
   */
  const plFromLines = (lines: { type: 'REVENUE' | 'EXPENSE'; debit: number; credit: number }[]) => {
    let totalRevenue = 0, totalExpenses = 0;
    for (const l of lines) {
      if (l.type === 'REVENUE') totalRevenue  += l.credit - l.debit;
      else                      totalExpenses += l.debit  - l.credit;
    }
    return { totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
  };

  it('summary: money in = revenue credits (net), money out = expense debits (net)', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({ currency: 'PHP', timezone: 'Asia/Manila' });
    accounts.getPLSummary.mockResolvedValueOnce(plFromLines([
      { type: 'REVENUE', debit: 0,    credit: 5000 },  // sale
      { type: 'REVENUE', debit: 500,  credit: 0    },  // refund
      { type: 'EXPENSE', debit: 1200, credit: 0    },  // rent
      { type: 'EXPENSE', debit: 0,    credit: 200  },  // reversed expense
    ]));
    const out = await svc.summary(TID, '2026-06-01', '2026-06-30');
    expect(accounts.getPLSummary).toHaveBeenCalledWith(TID, '2026-06-01', '2026-06-30');
    expect(out.moneyIn).toBe(4500);
    expect(out.moneyOut).toBe(1000);
    expect(out.from).toBe('2026-06-01');
    expect(out.to).toBe('2026-06-30');
  });

  it('summary: profit = money in − money out (2dp)', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({ currency: 'PHP', timezone: 'Asia/Manila' });
    accounts.getPLSummary.mockResolvedValueOnce(plFromLines([
      { type: 'REVENUE', debit: 0,      credit: 1000.10 },
      { type: 'EXPENSE', debit: 1200.35, credit: 0     },
    ]));
    const out = await svc.summary(TID, '2026-06-01', '2026-06-30');
    expect(out.profit).toBe(-200.25);
    expect(out.profit).toBeCloseTo(out.moneyIn - out.moneyOut, 2);
  });

  it('summary: from > to → BadRequestException', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({ currency: 'PHP', timezone: 'Asia/Manila' });
    await expect(svc.summary(TID, '2026-06-30', '2026-06-01')).rejects.toBeInstanceOf(BadRequestException);
    expect(accounts.getPLSummary).not.toHaveBeenCalled();
  });

  it('summary: malformed date → BadRequestException', async () => {
    await expect(svc.summary(TID, '2026-6-1', '2026-06-30')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.summary(TID, '2026-02-01', '2026-02-30')).rejects.toBeInstanceOf(BadRequestException);
    expect(accounts.getPLSummary).not.toHaveBeenCalled();
  });

  it('summary: currency comes from the tenant', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({ currency: 'USD', timezone: 'America/New_York' });
    accounts.getPLSummary.mockResolvedValueOnce(plFromLines([]));
    const out = await svc.summary(TID, '2026-06-01', '2026-06-30');
    expect(out.currency).toBe('USD');
  });

  it('summary: currency defaults to PHP when the tenant has none', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce(null);
    accounts.getPLSummary.mockResolvedValueOnce(plFromLines([]));
    const out = await svc.summary(TID, '2026-06-01', '2026-06-30');
    expect(out.currency).toBe('PHP');
    expect(out).toEqual({ from: '2026-06-01', to: '2026-06-30', moneyIn: 0, moneyOut: 0, profit: 0, currency: 'PHP' });
  });

  it('summary: defaults to the current calendar month when from/to are omitted', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({ currency: 'PHP', timezone: 'Asia/Manila' });
    accounts.getPLSummary.mockResolvedValueOnce(plFromLines([]));
    const out = await svc.summary(TID);
    expect(out.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(out.to).toMatch(/^\d{4}-\d{2}-(28|29|30|31)$/);
    expect(out.from.slice(0, 7)).toBe(out.to.slice(0, 7));
    expect(accounts.getPLSummary).toHaveBeenCalledWith(TID, out.from, out.to);
  });
});
