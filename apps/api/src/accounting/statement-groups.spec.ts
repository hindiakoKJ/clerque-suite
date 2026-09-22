/**
 * Balance Sheet sub-headings.
 *
 * Before: the page grouped by code bands that did not match the seeded chart
 * (1000–1099 = cash, 1100–1299 = receivables …), so every asset landed under
 * "Cash & Cash Equivalents" — the line read "Total Cash & Cash Equivalents
 * ₱147,680.23" while it was mostly inventory and actual cash was negative —
 * and every liability under "Trade Payables". Each row now carries its group
 * from the API, with a subtotal per group.
 */
import { AccountsService } from './accounts.service';
import { balanceSheetGroup, groupStatementRows, ASSET_GROUPS, LIABILITY_GROUPS } from './statement-groups';

describe('balanceSheetGroup', () => {
  it.each([
    ['ASSET', '1010', 'Cash & Cash Equivalents'],
    ['ASSET', '1025', 'Cash & Cash Equivalents'],
    ['ASSET', '1030', 'Receivables'],
    ['ASSET', '1031', 'Receivables'],
    ['ASSET', '1032', 'Receivables'],                 // allowance sits WITH the receivables it offsets
    ['ASSET', '1040', 'Tax Assets'],
    ['ASSET', '1045', 'Tax Assets'],
    ['ASSET', '1051', 'Inventory'],
    ['ASSET', '1054', 'Inventory'],
    ['ASSET', '1063', 'Prepayments & Other Current'],
    ['ASSET', '1075', 'Property & Equipment'],
    ['ASSET', '1076', 'Property & Equipment'],        // accumulated depreciation, with the asset it offsets
    ['ASSET', '1087', 'Property & Equipment'],
    ['ASSET', '1090', 'Intangible & Other Non-Current'],
    ['ASSET', '1099', 'Intangible & Other Non-Current'],
    ['LIABILITY', '2010', 'Trade Payables'],
    ['LIABILITY', '2012', 'Trade Payables'],
    ['LIABILITY', '2020', 'Tax & Government Payables'],
    ['LIABILITY', '2030', 'Tax & Government Payables'],
    ['LIABILITY', '2065', 'Tax & Government Payables'],
    ['LIABILITY', '2071', 'Loans, Deposits & Other Current'],
    ['LIABILITY', '2074', 'Loans, Deposits & Other Current'],
    ['LIABILITY', '2081', 'Accrued Liabilities'],
    ['LIABILITY', '2090', 'Long-term Liabilities'],
    ['LIABILITY', '2096', 'Long-term Liabilities'],
    // Older, wider numbering for a shop that built its own chart.
    ['ASSET', '1200', 'Receivables'],
    ['ASSET', '1350', 'Inventory'],
    ['ASSET', '1850', 'Property & Equipment'],
    ['LIABILITY', '2600', 'Long-term Liabilities'],
    ['EQUITY', '3010', 'Equity'],
  ])('%s %s → %s', (type, code, label) => {
    expect(balanceSheetGroup(type, code)).toBe(label);
  });

  it('never drops a code it does not recognise — it goes under "Other"', () => {
    expect(balanceSheetGroup('ASSET', '19999')).toBe('Other Assets');
    expect(balanceSheetGroup('ASSET', 'CASH-A')).toBe('Other Assets');
    expect(balanceSheetGroup('LIABILITY', '9')).toBe('Other Liabilities');
  });
});

describe('groupStatementRows', () => {
  const row = (code: string, group: string, amount: number) => ({ id: code, code, group, amount });

  it('keeps chart order, leaves out empty groups, and puts "Other" last', () => {
    const groups = groupStatementRows(
      [
        row('1075', 'Property & Equipment', 10000),
        row('1010', 'Cash & Cash Equivalents', 800),
        row('X1',   'Other Assets', 5),
        row('1051', 'Inventory', 500),
      ],
      ASSET_GROUPS,
      (r) => r.amount,
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Cash & Cash Equivalents', 'Inventory', 'Property & Equipment', 'Other Assets',
    ]);
    expect(groups.map((g) => g.total)).toEqual([800, 500, 10000, 5]);
  });

  it('a contra account REDUCES its group (the caller passes direction-uniform amounts)', () => {
    const groups = groupStatementRows(
      [row('1075', 'Property & Equipment', 10000), row('1076', 'Property & Equipment', -1000)],
      ASSET_GROUPS,
      (r) => r.amount,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(9000);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('works for liabilities too', () => {
    const groups = groupStatementRows(
      [row('2090', 'Long-term Liabilities', 50000), row('2010', 'Trade Payables', 300)],
      LIABILITY_GROUPS,
      (r) => r.amount,
    );
    expect(groups.map((g) => g.label)).toEqual(['Trade Payables', 'Long-term Liabilities']);
  });
});

describe('AccountsService.getBalanceSheet — rows carry their group, groups carry a subtotal', () => {
  type Line = { debit: number; credit: number };
  const acct = (code: string, name: string, type: string, normalBalance: 'DEBIT' | 'CREDIT', lines: Line[]) =>
    ({ id: `a-${code}`, code, name, type, normalBalance, journalLines: lines });
  const dr = (n: number): Line => ({ debit: n, credit: 0 });
  const cr = (n: number): Line => ({ debit: 0, credit: n });

  it('inventory is Inventory, cash is Cash, a loan is a loan — nothing is all "Cash & Cash Equivalents"', async () => {
    const prisma: any = {
      account: {
        findMany: jest.fn().mockResolvedValue([
          acct('1010', 'Cash on Hand',                 'ASSET',     'DEBIT',  [dr(800)]),
          acct('1031', 'Digital Wallet Receivable',    'ASSET',     'DEBIT',  [dr(1628)]),
          acct('1051', 'Raw Materials Inventory',      'ASSET',     'DEBIT',  [dr(500)]),
          acct('1075', 'Machinery & Equipment',        'ASSET',     'DEBIT',  [dr(10000)]),
          acct('1076', 'Accumulated Depreciation – Machinery', 'ASSET', 'CREDIT', [cr(1000)]),
          acct('2010', 'Accounts Payable – Trade',     'LIABILITY', 'CREDIT', [cr(300)]),
          acct('2071', 'Bank Loans – Short-term',      'LIABILITY', 'CREDIT', [cr(5000)]),
          acct('3010', "Owner's Capital",              'EQUITY',    'CREDIT', [cr(6628)]),
        ]),
      },
    };
    const bs: any = await new AccountsService(prisma).getBalanceSheet('t', '2026-09-30');

    const groupOf = (code: string) => [...bs.assets, ...bs.liabilities, ...bs.equity].find((r: any) => r.code === code).group;
    expect(groupOf('1010')).toBe('Cash & Cash Equivalents');
    expect(groupOf('1031')).toBe('Receivables');
    expect(groupOf('1051')).toBe('Inventory');
    expect(groupOf('1075')).toBe('Property & Equipment');
    expect(groupOf('2010')).toBe('Trade Payables');
    expect(groupOf('2071')).toBe('Loans, Deposits & Other Current');
    expect(groupOf('3010')).toBe('Equity');

    expect(bs.assetGroups.map((g: any) => [g.label, g.total])).toEqual([
      ['Cash & Cash Equivalents', 800],
      ['Receivables',             1628],
      ['Inventory',               500],
      ['Property & Equipment',    9000],   // 10,000 less 1,000 accumulated depreciation
    ]);
    expect(bs.liabilityGroups.map((g: any) => [g.label, g.total])).toEqual([
      ['Trade Payables',                  300],
      ['Loans, Deposits & Other Current', 5000],
    ]);
    // The group subtotals add up to the section total, and the equation still holds.
    const sumAssets = bs.assetGroups.reduce((s: number, g: any) => s + g.total, 0);
    expect(sumAssets).toBe(bs.totalAssets);
    expect(bs.totalAssets).toBe(11928);
    expect(bs.balanced).toBe(true);
    // The own-direction row balance is unchanged (the contra line shows +1,000 on its own row).
    expect(bs.assets.find((r: any) => r.code === '1076').balance).toBe(1000);
  });
});
