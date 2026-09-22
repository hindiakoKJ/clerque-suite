/**
 * BIR book dates are Manila calendar days, whatever zone the server runs in.
 *
 * The API runs on UTC (Railway). The books pick rows by Manila month bounds but
 * printed each row with a bare toLocaleDateString, so a 7:30 AM sale on
 * 1 October sat in the October book dated 9/30 — every sale before 8 AM got
 * the previous day. And the quarter was built in the server's own zone, so on
 * a Manila machine the Q3 estimate read "2026-06-30 – 2026-09-30".
 */
import ExcelJS from 'exceljs';
import { BirService } from './bir.service';

/*
  Jest hands each test file its own copy of process.env, so setting TZ here
  does not move the clock's zone. Emulate a UTC server instead: a date
  formatted without an explicit timeZone comes out in UTC, as on Railway.
*/
const onUtcServer = () => {
  const orig = Date.prototype.toLocaleDateString;
  beforeAll(() => {
    jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, locales?: Intl.LocalesArgument, opts?: Intl.DateTimeFormatOptions) {
      return orig.call(this, locales, { timeZone: 'UTC', ...opts });
    });
  });
  afterAll(() => jest.restoreAllMocks());
};

/** The first data row's date: the first column-A cell that reads as a date. */
const firstRowDate = async (buf: Buffer): Promise<unknown> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.worksheets[0]!;
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(1).value;
    if (typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return v;
  }
  return undefined;
};

const OPENING_SALE = new Date('2026-10-01T07:30:00+08:00');   // 23:30 UTC on 30 September

function makeService(rows: { orders?: unknown[]; expenses?: unknown[]; lots?: unknown[] }) {
  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', isBirRegistered: false, name: 'Cafe Carolina', tinNumber: null, businessName: null }) },
    order:          { findMany: jest.fn().mockResolvedValue(rows.orders ?? []) },
    expenseEntry:   { findMany: jest.fn().mockResolvedValue(rows.expenses ?? []) },
    rawMaterialLot: { findMany: jest.fn().mockResolvedValue(rows.lots ?? []) },
    account:        { findMany: jest.fn().mockResolvedValue([]) },
  };
  return new BirService(prisma as never);
}

describe('BIR books on a UTC server', () => {
  onUtcServer();

  it('Sales Book: a 7:30 AM sale on 1 October is dated 10/1, by when it was paid', async () => {
    const svc = makeService({ orders: [{
      orderNumber: 'ORD-2026-000101', customerName: null, vatAmount: 0, totalAmount: 120, taxType: 'VAT_EXEMPT',
      isPwdScDiscount: false, paidAt: OPENING_SALE,
      // Rung up at 7:25, bumped by the bar at 7:50.
      createdAt: new Date('2026-10-01T07:25:00+08:00'), completedAt: new Date('2026-10-01T07:50:00+08:00'),
    }] });
    expect(await firstRowDate(await svc.exportSalesBook('t1', 2026, 10))).toBe('10/1/2026');
  });

  it('Purchase Book: a delivery at 7:30 AM on 1 October is dated 10/1', async () => {
    const svc = makeService({ lots: [{
      receivedAt: OPENING_SALE, referenceNumber: 'SI-1', paymentMethod: 'CASH', qtyReceived: 1000, unitCost: 0.09,
      rawMaterial: { name: 'Fresh Milk', unit: 'ml' },
    }] });
    expect(await firstRowDate(await svc.exportPurchaseBook('t1', 2026, 10))).toBe('10/1/2026');
  });

  it('Cash Disbursements Book: a payment at 7:30 AM on 1 October is dated 10/1', async () => {
    const svc = makeService({ expenses: [{
      paidAt: OPENING_SALE, paymentRef: 'GC-1', vendor: { name: 'Milk supplier', tin: null }, description: 'Milk',
      paidAmount: 90, netAmount: 90, whtAmount: 0, grossAmount: 90,
    }] });
    expect(await firstRowDate(await svc.exportCashDisbursements('t1', 2026, 10))).toBe('10/1/2026');
  });
});

describe('Tax estimate quarter label', () => {
  // Built in the server's own zone, this read "2026-06-30" on a Manila machine.
  it('Q3 reads 2026-07-01 – 2026-09-30 in any zone', async () => {
    const r = await makeService({}).get2551QData('t1', 2026, 3);
    expect(r.periodFrom).toBe('2026-07-01');
    expect(r.periodTo).toBe('2026-09-30');
  });
});

describe('1701Q account lines', () => {
  it('lists only accounts that moved this quarter; the totals are the same', async () => {
    const prisma = {
      tenant:  { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', isBirRegistered: false }) },
      account: { findMany: jest.fn().mockResolvedValue([
        { code: '4010', name: 'Sales Revenue',       type: 'REVENUE', normalBalance: 'CREDIT', journalLines: [{ debit: 0, credit: 1000 }] },
        { code: '4110', name: 'Court Rental Income', type: 'REVENUE', normalBalance: 'CREDIT', journalLines: [] },
        { code: '6010', name: 'Salaries and Wages',  type: 'EXPENSE', normalBalance: 'DEBIT',  journalLines: [{ debit: 800, credit: 0 }] },
        { code: '6050', name: 'Rent',                type: 'EXPENSE', normalBalance: 'DEBIT',  journalLines: [{ debit: 100, credit: 100 }] },
      ]) },
    };
    const r = await new BirService(prisma as never).get1701QData('t1', 2026, 3);
    expect(r.revenueLines.map((l) => l.code)).toEqual(['4010']);
    expect(r.expenseLines.map((l) => l.code)).toEqual(['6010']);
    expect(r).toMatchObject({ grossRevenue: 1000, totalExpenses: 800, netIncome: 200 });
  });
});
