/**
 * Cash Flow Statement — which section an account's movement belongs in.
 *
 * The old rule sent 1030–1799 to Operating, so buying an espresso machine
 * (1075 Machinery & Equipment) showed as a working-capital change instead of
 * an investment; and every liability under 2500 to Operating, so a bank loan
 * (2071 / 2090) looked like money the shop earned from trading.
 */
import { AccountsService, cashFlowSection } from './accounts.service';

describe('cashFlowSection', () => {
  it.each([
    // Real cash and bank: opening / ending balance, not a section.
    [1010, 'CASH'], [1011, 'CASH'], [1020, 'CASH'], [1025, 'CASH'],
    // Working capital (seeded chart).
    [1030, 'OPERATING'], [1031, 'OPERATING'], [1040, 'OPERATING'], [1051, 'OPERATING'], [1063, 'OPERATING'],
    // Equipment and other long-term assets are INVESTING.
    [1070, 'INVESTING'], [1075, 'INVESTING'], [1077, 'INVESTING'], [1081, 'INVESTING'],
    [1090, 'INVESTING'], [1097, 'INVESTING'], [1099, 'INVESTING'],
    // Payables, taxes, accruals, customer deposits: operating.
    [2010, 'OPERATING'], [2020, 'OPERATING'], [2030, 'OPERATING'], [2065, 'OPERATING'],
    [2074, 'OPERATING'], [2075, 'OPERATING'], [2080, 'OPERATING'], [2081, 'OPERATING'],
    // Loans, lease liabilities, dividends: financing.
    [2070, 'FINANCING'], [2071, 'FINANCING'], [2072, 'FINANCING'], [2073, 'FINANCING'], [2076, 'FINANCING'],
    [2090, 'FINANCING'], [2091, 'FINANCING'], [2093, 'FINANCING'],
    // Owner's money in and out.
    [3010, 'FINANCING'], [3020, 'FINANCING'],
    // P&L and retained earnings arrive through Net Income.
    [3900, 'SKIP'], [4010, 'SKIP'], [5010, 'SKIP'], [6010, 'SKIP'],
    // Older, wider numbering for a shop that built its own chart.
    [1200, 'OPERATING'], [1850, 'INVESTING'], [2600, 'FINANCING'],
  ] as Array<[number, string]>)('%s → %s', (code, section) => {
    expect(cashFlowSection(code)).toBe(section);
  });

  it('skips a code it cannot read rather than guessing', () => {
    expect(cashFlowSection(Number.NaN)).toBe('SKIP');
  });

  // Accumulated depreciation / amortisation is the credit-normal contra in the
  // PP&E and intangible band. Its growth is the month's depreciation — a
  // non-cash charge that belongs back in Operating, not an investing inflow.
  it.each([1071, 1074, 1076, 1078, 1080, 1082, 1084, 1087, 1091, 1093, 1095])(
    'contra %s (CREDIT-normal) → OPERATING',
    (code) => {
      expect(cashFlowSection(code, 'CREDIT')).toBe('OPERATING');
    },
  );

  it('the debit-normal asset in the same band stays INVESTING', () => {
    expect(cashFlowSection(1075, 'DEBIT')).toBe('INVESTING');
    expect(cashFlowSection(1090, 'DEBIT')).toBe('INVESTING');
  });
});

describe('getCashFlow — monthly depreciation', () => {
  type Line = { debit: number; credit: number; journalEntry: { date: Date; postingDate: Date } };
  const L = (d: string, debit: number, credit: number): Line =>
    ({ debit, credit, journalEntry: { date: new Date(d + 'T10:00:00'), postingDate: new Date(d + 'T10:00:00') } });
  const acct = (code: string, name: string, type: string, normalBalance: 'DEBIT' | 'CREDIT', lines: Line[]) =>
    ({ id: `a-${code}`, code, name, type, normalBalance, isActive: true, journalLines: lines });

  it('adds depreciation back under Operating; Investing shows no phantom inflow', async () => {
    // September: owner puts in ₱100,000 and buys the espresso machine for ₱85,000.
    // October: ₱5,000 cash sales, ₱1,000 depreciation (Dr 6080 / Cr 1076).
    const prisma: any = {
      account: {
        findMany: jest.fn().mockResolvedValue([
          acct('1010', 'Cash on Hand', 'ASSET', 'DEBIT', [L('2026-09-01', 100000, 0), L('2026-09-05', 0, 85000), L('2026-10-15', 5000, 0)]),
          acct('1075', 'Machinery & Equipment', 'ASSET', 'DEBIT', [L('2026-09-05', 85000, 0)]),
          acct('1076', 'Accumulated Depreciation – Machinery', 'ASSET', 'CREDIT', [L('2026-10-31', 0, 1000)]),
          acct('3010', "Owner's Capital", 'EQUITY', 'CREDIT', [L('2026-09-01', 0, 100000)]),
          acct('4010', 'Sales', 'REVENUE', 'CREDIT', [L('2026-10-15', 0, 5000)]),
          acct('6080', 'Depreciation Expense', 'EXPENSE', 'DEBIT', [L('2026-10-31', 1000, 0)]),
        ]),
      },
    };
    const svc = new AccountsService(prisma);
    jest.spyOn(svc as any, 'getPLSummary').mockResolvedValue({ netIncome: 4000 });
    const cf: any = await svc.getCashFlow('t', '2026-10-01', '2026-10-31');

    expect(cf.operatingTotal).toBe(5000);
    expect(cf.operating).toEqual([
      expect.objectContaining({ code: '1076', effectOnCash: 1000, label: 'Depreciation / amortisation (non-cash)' }),
    ]);
    expect(cf.investing).toEqual([]);
    expect(cf.investingTotal).toBe(0);
    expect(cf.netChange).toBe(5000);
    expect(cf.reconciles).toBe(true);
  });
});
