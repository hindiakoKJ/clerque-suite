import { ImportService } from './import.service';

/**
 * A stock-receipt spreadsheet must respect the period lock.
 *
 * The single-receipt path checks it before any write
 * (inventory.service.ts:1256). This bulk path did not — ImportService injected
 * only PrismaService and reimplemented the receive with a direct
 * rawMaterialInventory.upsert and rawMaterialLot.create. So a spreadsheet
 * could post stock into a month that was already closed and reconciled, and
 * the only sign would be last month's numbers quietly moving.
 *
 * Checked PER ROW rather than once per file, because a receipt sheet routinely
 * spans a close boundary: only the locked rows should be refused.
 */
describe('ImportService — stock receipts honour the period lock', () => {
  const TENANT = 't1';

  const HEADER = ['Date* (YYYY-MM-DD)', 'Ingredient/Product Name*', 'Quantity*',
                  'Unit Cost*', 'Branch', 'Payment Method', 'Vendor', 'Reference Number'];

  function build(opts: { closedBefore?: string; noPeriods?: boolean } = {}) {
    const lots: any[] = [];
    const prisma: any = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', name: 'Main Branch' }) },
      rawMaterial: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve({ id: 'rm-' + where.name, name: where.name, unit: 'g', costPrice: '1' })),
        update:   jest.fn(() => Promise.resolve({})),   // WAC blend
        findMany: jest.fn(() => Promise.resolve([])),
      },
      bomItem:  { findMany: jest.fn(() => Promise.resolve([])) },   // recost ripple
      product:   { findFirst: jest.fn().mockResolvedValue(null) },
      vendor:    { findFirst: jest.fn().mockResolvedValue(null) },
      rawMaterialLot: {
        findFirst: jest.fn().mockResolvedValue(null),
        create:    jest.fn((a: any) => { lots.push(a.data); return Promise.resolve(a.data); }),
      },
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert:     jest.fn(() => Promise.resolve({})),
      },
      accountingEvent: { create: jest.fn(() => Promise.resolve({})) },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };

    const periods: any = {
      assertDateIsOpen: jest.fn((_t: string, date: Date) => {
        if (opts.closedBefore && date < new Date(opts.closedBefore)) {
          return Promise.reject(new Error(
            `Accounting period covering ${date.toISOString().slice(0, 10)} is closed.`));
        }
        return Promise.resolve();
      }),
    };

    const svc = new ImportService(prisma, opts.noPeriods ? undefined : periods) as any;
    const run = (rows: string[][]) => svc.importStockReceiptsFromRows
      ? svc.importStockReceiptsFromRows([HEADER, ...rows], TENANT, 'u1')
      : svc.importStockReceipts(
          { buffer: Buffer.from(''), originalname: 'x.csv' } as never, TENANT, 'u1');
    return { svc, prisma, periods, lots, run };
  }

  /** Drive the real method through a CSV buffer, which is how it is reached. */
  function csv(rows: string[][]) {
    return {
      originalname: 'receipts.csv',
      buffer: Buffer.from([HEADER, ...rows].map((r) => r.join(',')).join('\n'), 'utf-8'),
    } as never;
  }

  it('checks the period for every row, not once for the file', async () => {
    const { svc, periods } = build();
    await svc.importStockReceipts(csv([
      ['2026-08-20', 'Coffee Beans', '5', '1100', '', 'CASH', '', ''],
      ['2026-08-21', 'Fresh Milk',   '3', '88',   '', 'CASH', '', ''],
    ]), TENANT, 'u1');

    expect(periods.assertDateIsOpen).toHaveBeenCalledTimes(2);
  });

  it('refuses a row dated into a closed month, and says which row', async () => {
    const { svc } = build({ closedBefore: '2026-08-01' });
    const res = await svc.importStockReceipts(csv([
      ['2026-07-15', 'Coffee Beans', '5', '1100', '', 'CASH', '', ''],
    ]), TENANT, 'u1');

    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/closed/i);
    expect(res.imported).toBe(0);
  });

  it('lets the open rows through when a sheet spans the close boundary', async () => {
    // The realistic case: someone keys July and August receipts together.
    const { svc } = build({ closedBefore: '2026-08-01' });
    const res = await svc.importStockReceipts(csv([
      ['2026-07-28', 'Coffee Beans', '5', '1100', '', 'CASH', '', ''],
      ['2026-08-02', 'Fresh Milk',   '3', '88',   '', 'CASH', '', ''],
    ]), TENANT, 'u1');

    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].row).toBe(3);      // the July line (rowNum = dataStart + i + 2)
    expect(res.imported).toBe(1);           // the August line still landed
  });

  it('writes nothing for a locked row', async () => {
    const { svc, prisma } = build({ closedBefore: '2026-08-01' });
    await svc.importStockReceipts(csv([
      ['2026-07-15', 'Coffee Beans', '5', '1100', '', 'CASH', '', ''],
    ]), TENANT, 'u1');

    expect(prisma.rawMaterialLot.create).not.toHaveBeenCalled();
    expect(prisma.rawMaterialInventory.upsert).not.toHaveBeenCalled();
  });

  it('refuses outright rather than skipping the lock when unwired', async () => {
    // Fail closed. A bypass nobody can see is worse than a missing feature.
    const { svc } = build({ noPeriods: true });
    await expect(
      svc.importStockReceipts(csv([
        ['2026-08-20', 'Coffee Beans', '5', '1100', '', 'CASH', '', ''],
      ]), TENANT, 'u1'),
    ).rejects.toThrow(/accounting-period service is not wired/i);
  });
});
