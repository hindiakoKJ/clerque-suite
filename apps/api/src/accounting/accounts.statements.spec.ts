/**
 * Financial-statement TOTALS with contra accounts.
 *
 * The seeded COA has 19 contra accounts (own normalBalance opposite to type):
 * Accumulated Depreciation (ASSET/CREDIT), Allowance for Doubtful Accounts,
 * Treasury Shares + Owner's Drawing (EQUITY/DEBIT), Sales Returns/Discounts +
 * 4116 Refunds & Cancellations (REVENUE/DEBIT), Purchase Returns/Discounts
 * (EXPENSE/CREDIT). Row balances are shown in the account's OWN direction, but
 * section TOTALS must be direction-uniform so a contra account REDUCES its
 * section. The old code added own-direction balances, so a refund RAISED
 * revenue and an owner drawing RAISED equity — overstating profit and breaking
 * Assets = Liabilities + Equity. These pin the corrected math.
 */
import { AccountsService } from './accounts.service';

type Line = { debit: number; credit: number };
type Acct = { id: string; code: string; name: string; type: string; normalBalance: 'DEBIT' | 'CREDIT'; journalLines: Line[] };

const acct = (code: string, name: string, type: string, normalBalance: 'DEBIT' | 'CREDIT', lines: Line[]): Acct =>
  ({ id: `a-${code}`, code, name, type, normalBalance, journalLines: lines });
const dr = (n: number): Line => ({ debit: n, credit: 0 });
const cr = (n: number): Line => ({ debit: 0, credit: n });

const build = (accounts: Acct[]) => {
  const prisma: any = { account: { findMany: jest.fn().mockResolvedValue(accounts) } };
  return { svc: new AccountsService(prisma), prisma };
};

describe('AccountsService.getPLSummary — contra-revenue / contra-expense', () => {
  it('a refund (4116, REVENUE/DEBIT) REDUCES total revenue instead of inflating it', async () => {
    // ₱1,000 of sales, then a ₱100 magnet refund posted DR 4116.
    const { svc } = build([
      acct('4010', 'Sales Revenue',           'REVENUE', 'CREDIT', [cr(1000)]),
      acct('4116', 'Refunds & Cancellations', 'REVENUE', 'DEBIT',  [dr(100)]),
    ]);
    const pl = await svc.getPLSummary('t', '2026-08-01', '2026-08-31');
    expect(pl.totalRevenue).toBe(900);                       // was 1,100 before the fix
    // Row display keeps the account's own direction (accountants expect +100 on the refunds line).
    expect(pl.revenueAccounts.find((r) => r.code === '4116')?.balance).toBe(100);
    expect(pl.netIncome).toBe(900);
  });

  it('a purchase return (5040, EXPENSE/CREDIT) REDUCES total expenses', async () => {
    const { svc } = build([
      acct('5010', 'COGS',                         'EXPENSE', 'DEBIT',  [dr(400)]),
      acct('5040', 'Purchase Returns & Allowances', 'EXPENSE', 'CREDIT', [cr(50)]),
    ]);
    const pl = await svc.getPLSummary('t', '2026-08-01', '2026-08-31');
    expect(pl.totalExpenses).toBe(350);                      // was 450 before the fix
    expect(pl.expenseAccounts.find((r) => r.code === '5040')?.balance).toBe(50);
  });

  it('a normal-direction-only P&L is byte-identical to before (no regression)', async () => {
    const { svc } = build([
      acct('4010', 'Sales',     'REVENUE', 'CREDIT', [cr(500), cr(250)]),
      acct('6060', 'Utilities', 'EXPENSE', 'DEBIT',  [dr(120)]),
      acct('6050', 'Rent',      'EXPENSE', 'DEBIT',  [dr(200)]),
    ]);
    const pl = await svc.getPLSummary('t', '2026-08-01', '2026-08-31');
    expect(pl.totalRevenue).toBe(750);
    expect(pl.totalExpenses).toBe(320);
    expect(pl.netIncome).toBe(430);
  });

  it('includes the WHOLE `to` day (a same-day reversal stamped with a time is not dropped)', async () => {
    const { svc, prisma } = build([]);
    await svc.getPLSummary('t', '2026-08-01', '2026-08-31');
    const where = prisma.account.findMany.mock.calls[0][0].include.journalLines.where.journalEntry;
    const lte: Date = where.OR[0].postingDate.lte;
    expect(lte.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    expect(where.OR[0].postingDate.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('AccountsService.getBalanceSheet — contra-asset / contra-equity + the equation', () => {
  it("an owner drawing (3020, EQUITY/DEBIT) REDUCES equity and Assets = Liabilities + Equity holds", async () => {
    // Owner put in ₱1,000 cash, then took ₱200 out (what Simple Entry posts).
    // Cash 800 (DR 1000, CR 200). Capital CR 1000. Drawing DR 200.
    const { svc } = build([
      acct('1010', 'Cash on Hand',    'ASSET',  'DEBIT',  [dr(1000), cr(200)]),
      acct('3010', "Owner's Capital", 'EQUITY', 'CREDIT', [cr(1000)]),
      acct('3020', "Owner's Drawing", 'EQUITY', 'DEBIT',  [dr(200)]),
    ]);
    const bs: any = await svc.getBalanceSheet('t', '2026-08-31');
    expect(bs.totalAssets).toBe(800);
    expect(bs.totalEquity).toBe(800);                        // was 1,200 before the fix
    expect(bs.totalLiabilities).toBe(0);
    expect(Math.round((bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)) * 100)).toBe(0);
    // Row display keeps own direction: the drawing line shows +200.
    expect(bs.equity.find((r: any) => r.code === '3020')?.balance).toBe(200);
  });

  it('accumulated depreciation (1071, ASSET/CREDIT) REDUCES total assets', async () => {
    // Equipment 10,000 bought with capital; 1,000 depreciation expense booked.
    const { svc } = build([
      acct('1070', 'PP&E',                        'ASSET',   'DEBIT',  [dr(10000)]),
      acct('1071', 'Accumulated Depreciation',    'ASSET',   'CREDIT', [cr(1000)]),
      acct('3010', "Owner's Capital",             'EQUITY',  'CREDIT', [cr(10000)]),
      acct('6120', 'Depreciation Expense',        'EXPENSE', 'DEBIT',  [dr(1000)]),
    ]);
    const bs: any = await svc.getBalanceSheet('t', '2026-08-31');
    expect(bs.totalAssets).toBe(9000);                       // was 11,000 before the fix
    // Retained earnings = −1,000 (the expense), so equity = 10,000 − 1,000 = 9,000 → balances.
    expect(Math.round((bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)) * 100)).toBe(0);
  });

  it('a refund flows through retained earnings correctly on the balance sheet', async () => {
    // Sale 1,000 cash; refund 100 cash. Cash 900. Revenue 1,000; Refunds (contra) 100 → RE 900.
    const { svc } = build([
      acct('1010', 'Cash on Hand',            'ASSET',   'DEBIT',  [dr(1000), cr(100)]),
      acct('4010', 'Sales Revenue',           'REVENUE', 'CREDIT', [cr(1000)]),
      acct('4116', 'Refunds & Cancellations', 'REVENUE', 'DEBIT',  [dr(100)]),
    ]);
    const bs: any = await svc.getBalanceSheet('t', '2026-08-31');
    expect(bs.totalAssets).toBe(900);
    expect(bs.totalEquity).toBe(900);                        // retained earnings; was 1,100
    expect(Math.round((bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)) * 100)).toBe(0);
  });
});
