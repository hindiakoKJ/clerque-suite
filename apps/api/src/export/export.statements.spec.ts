/**
 * Cash Position and Balance Sheet .xlsx exports.
 *
 *  - Cash Position asked for `code startsWith '10'` — every asset in the
 *    seeded chart — so "TOTAL CASH" added up receivables, inventory,
 *    furniture and goodwill.
 *  - The Balance Sheet printed a flat list; it now carries the same
 *    sub-headings and subtotals as the screen (Cash & Cash Equivalents,
 *    Receivables, Inventory …).
 */
import ExcelJS from 'exceljs';
import { ExportService } from './export.service';

const none = {} as never;

describe('ExportService.exportCashPosition', () => {
  it('lists cash on hand and bank accounts only — never every account starting with 10', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      tenant:  { findUnique: jest.fn().mockResolvedValue({ name: 'Cafe Carolina' }) },
      account: { findMany },
    };
    const svc = new ExportService(
      prisma as never, none, none, none, none, none, none, none, none, none, none, none, none, none,
    );
    await svc.exportCashPosition('t1', '2026-09-30');

    const where = findMany.mock.calls[0][0].where;
    expect(where.code).toBeUndefined();                 // the old startsWith('10') is gone
    expect(where.type).toBe('ASSET');
    expect(where.OR).toEqual(expect.arrayContaining([
      { code: { gte: '1000', lt: '1030' } },
      { name: { contains: 'cash on hand', mode: 'insensitive' } },
      { name: { contains: 'cash in bank', mode: 'insensitive' } },
    ]));
  });
});

describe('ExportService.exportBalanceSheet', () => {
  it('prints the sub-headings with their own subtotals, then the section total', async () => {
    const cash = { id: 'a1', code: '1010', name: 'Cash on Hand',            balance: 800,   group: 'Cash & Cash Equivalents' };
    const inv  = { id: 'a2', code: '1051', name: 'Raw Materials Inventory', balance: 500,   group: 'Inventory' };
    const ap   = { id: 'l1', code: '2010', name: 'Accounts Payable – Trade', balance: 300,  group: 'Trade Payables' };
    const cap  = { id: 'e1', code: '3010', name: "Owner's Capital",         balance: 1000,  group: 'Equity' };
    const accounts = {
      getBalanceSheet: jest.fn().mockResolvedValue({
        asOf: '2026-09-30',
        assets: [cash, inv], liabilities: [ap], equity: [cap],
        assetGroups: [
          { label: 'Cash & Cash Equivalents', rows: [cash], total: 800 },
          { label: 'Inventory',               rows: [inv],  total: 500 },
        ],
        liabilityGroups: [{ label: 'Trade Payables', rows: [ap], total: 300 }],
        totalAssets: 1300, totalLiabilities: 300, totalEquity: 1000,
        totalLiabilitiesAndEquity: 1300, retainedEarnings: 0, balanced: true,
      }),
    };
    const prisma = { tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Cafe Carolina' }) } };
    const svc = new ExportService(
      prisma as never, accounts as never, none, none, none, none, none, none, none, none, none, none, none, none,
    );

    const buf = await svc.exportBalanceSheet('t1', '2026-09-30');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Balance Sheet')!;

    const lines: Array<[string, unknown]> = [];
    ws.eachRow((row, n) => { if (n >= 5) lines.push([String(row.getCell(2).value ?? ''), row.getCell(3).value]); });
    const names = lines.map(([name]) => name);

    // Order: section, group heading, rows, group subtotal, next group …, section total.
    const at = (label: string) => names.indexOf(label);
    expect(at('ASSETS')).toBeGreaterThanOrEqual(0);
    expect(at('Cash & Cash Equivalents')).toBeGreaterThan(at('ASSETS'));
    expect(at('Cash on Hand')).toBeGreaterThan(at('Cash & Cash Equivalents'));
    expect(at('Total Cash & Cash Equivalents')).toBeGreaterThan(at('Cash on Hand'));
    expect(at('Inventory')).toBeGreaterThan(at('Total Cash & Cash Equivalents'));
    expect(at('Total Inventory')).toBeGreaterThan(at('Raw Materials Inventory'));
    expect(at('Total Assets')).toBeGreaterThan(at('Total Inventory'));
    expect(at('Total Trade Payables')).toBeGreaterThan(at('LIABILITIES'));

    expect(lines[at('Total Cash & Cash Equivalents')][1]).toBe(800);
    expect(lines[at('Total Inventory')][1]).toBe(500);
    expect(lines[at('Total Assets')][1]).toBe(1300);
    expect(lines[at('Total Trade Payables')][1]).toBe(300);
    // Equity has no sub-headings.
    expect(names).not.toContain('Total Equity Equity');
    expect(lines[at('Total Equity')][1]).toBe(1000);
  });
});

describe('Statement exports leave out ₱0.00 accounts', () => {
  const prisma = { tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Cafe Carolina' }) } };

  async function sheetNames(buf: Buffer, sheet: string): Promise<string[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const names: string[] = [];
    wb.getWorksheet(sheet)!.eachRow((row, n) => { if (n >= 5) names.push(String(row.getCell(2).value ?? '')); });
    return names;
  }

  it('Balance Sheet: zero accounts and all-zero groups are not printed; totals unchanged', async () => {
    const cash  = { id: 'a1', code: '1010', name: 'Cash on Hand',       balance: 800, group: 'Cash & Cash Equivalents' };
    const bank  = { id: 'a2', code: '1021', name: 'Cash in Bank – Savings', balance: 0, group: 'Cash & Cash Equivalents' };
    const goodw = { id: 'a3', code: '1091', name: 'Goodwill',            balance: 0,   group: 'Intangible & Other Non-Current' };
    const loan  = { id: 'l1', code: '2070', name: 'Loans Payable',       balance: 0,   group: 'Loans, Deposits & Other Current' };
    const cap   = { id: 'e1', code: '3010', name: "Owner's Capital",     balance: 800, group: 'Equity' };
    const drw   = { id: 'e2', code: '3020', name: "Owner's Drawings",    balance: 0,   group: 'Equity' };
    const accounts = {
      getBalanceSheet: jest.fn().mockResolvedValue({
        asOf: '2026-09-30',
        assets: [cash, bank, goodw], liabilities: [loan], equity: [cap, drw],
        assetGroups: [
          { label: 'Cash & Cash Equivalents',        rows: [cash, bank], total: 800 },
          { label: 'Intangible & Other Non-Current', rows: [goodw],      total: 0 },
        ],
        liabilityGroups: [{ label: 'Loans, Deposits & Other Current', rows: [loan], total: 0 }],
        totalAssets: 800, totalLiabilities: 0, totalEquity: 800,
        totalLiabilitiesAndEquity: 800, retainedEarnings: 0, balanced: true,
      }),
    };
    const svc = new ExportService(
      prisma as never, accounts as never, none, none, none, none, none, none, none, none, none, none, none, none,
    );
    const names = await sheetNames(await svc.exportBalanceSheet('t1', '2026-09-30'), 'Balance Sheet');

    expect(names).toContain('Cash on Hand');
    expect(names).toContain("Owner's Capital");
    expect(names).not.toContain('Cash in Bank – Savings');
    expect(names).not.toContain('Goodwill');
    expect(names).not.toContain('Intangible & Other Non-Current');
    expect(names).not.toContain('Loans Payable');
    expect(names).not.toContain('Loans, Deposits & Other Current');
    expect(names).not.toContain("Owner's Drawings");
    expect(names).toContain('Total Assets');
    expect(names).toContain('Total Liabilities');
  });

  it('P&L: court-rental income and other empty accounts are not printed', async () => {
    const accounts = {
      getPLSummary: jest.fn().mockResolvedValue({
        revenueAccounts: [
          { code: '4010', name: 'Sales Revenue',        balance: 1296 },
          { code: '4110', name: 'Court Rental Income',  balance: 0 },
          { code: '4116', name: 'Refunds & Cancellations', balance: 0.001 },
        ],
        expenseAccounts: [
          { code: '5010', name: 'Cost of Goods Sold', balance: 400 },
          { code: '6050', name: 'Rent Expense',       balance: 0 },
        ],
        totalRevenue: 1296, totalExpenses: 400, netIncome: 896,
      }),
    };
    const svc = new ExportService(
      prisma as never, accounts as never, none, none, none, none, none, none, none, none, none, none, none, none,
    );
    const names = await sheetNames(await svc.exportPLSummary('t1', '2026-09-01', '2026-09-30'), 'P&L Summary');

    expect(names).toEqual(expect.arrayContaining(['Sales Revenue', 'Cost of Goods Sold', 'Total Revenue', 'Total Expenses']));
    expect(names).not.toContain('Court Rental Income');
    expect(names).not.toContain('Refunds & Cancellations');
    expect(names).not.toContain('Rent Expense');
  });
});
