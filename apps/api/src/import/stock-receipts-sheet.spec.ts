import * as ExcelJS from 'exceljs';
import { ImportService } from './import.service';

/**
 * The Stock Receipts importer must take the sheet named Stock Receipts.
 *
 * It used to call parseFile(file) with no preferred name, which falls back to
 * the FIRST sheet — the exact trap parseFile's own comment describes for every
 * other importer. A workbook that leads with a review tab (an opening-stock
 * file where someone checks the mapping before uploading, say) therefore had
 * its review tab parsed as receipts, and failed with row errors pointing at
 * cells the owner had never been asked to fill in.
 */
describe('ImportService — stock receipts read their own sheet', () => {
  async function workbook(sheets: Array<[string, unknown[][]]>): Promise<any> {
    const wb = new ExcelJS.Workbook();
    for (const [name, rows] of sheets) {
      const ws = wb.addWorksheet(name);
      rows.forEach((r) => ws.addRow(r));
    }
    const buffer = await wb.xlsx.writeBuffer();
    return { originalname: 'x.xlsx', buffer: Buffer.from(buffer) };
  }

  const RECEIPTS: unknown[][] = [
    ['Opening stock — ready to import'],
    [],
    [],
    ['Date* (YYYY-MM-DD)', 'Ingredient/Product Name*', 'Quantity*', 'Unit Cost*',
     'Branch', 'Payment Method', 'Vendor', 'Reference Number'],
    ['2026-08-24', 'Coffee Beans', 12815, 1.1, '', 'OWNER_FUNDED', '', 'OPENING-20260824'],
  ];
  const REVIEW: unknown[][] = [
    ['Opening stock — mapped to your ingredients'],
    [],
    [],
    ['Ingredient', 'Unit', 'Counted on the bar sheet as', 'Sheet figure', 'Loading', 'Status', 'Why'],
    ['Coffee Beans', 'g', 'Coffee Beans 1kg/Pack', 12815, 12815, 'ok', ''],
  ];

  function build() {
    const lots: any[] = [];
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn(({ where }: any) => {
          const raw = typeof where?.name === 'string' ? where.name : where?.name?.equals;
          return String(raw) === 'Coffee Beans'
            ? Promise.resolve({ id: 'rm1', name: 'Coffee Beans', unit: 'g', costPrice: 0 })
            : Promise.resolve(null);
        }),
      },
      product:        { findFirst: jest.fn().mockResolvedValue(null) },
      branch:         { findFirst: jest.fn().mockResolvedValue({ id: 'b1', name: 'Main', isActive: true }) },
      // The importer nets input VAT for a VAT-registered shop, exactly as
      // receiveRawMaterial does, so opening stock and later deliveries are
      // valued on the same basis. UNREGISTERED keeps these fixtures on the
      // gross figures they were written against.
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'UNREGISTERED' }) },
      vendor:         { findFirst: jest.fn().mockResolvedValue(null) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: any) => fn({
        rawMaterialInventory: {
          findUnique: jest.fn().mockResolvedValue({ quantity: 0 }),
          upsert:     jest.fn().mockResolvedValue({}),
          update:     jest.fn().mockResolvedValue({}),
        },
        rawMaterial:     { update: jest.fn().mockResolvedValue({}) },
        rawMaterialLot:  { create: jest.fn(({ data }: any) => { lots.push(data); return Promise.resolve({}); }) },
        accountingEvent: { create: jest.fn().mockResolvedValue({}) },
        product:         { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
        bomItem:         { findMany: jest.fn().mockResolvedValue([]) },
        aPBill:          { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      })),
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    return { svc: new ImportService(prisma, periods) as any, lots };
  }

  it('finds its sheet even when another one comes first', async () => {
    const { svc, lots } = build();
    const file = await workbook([['Mapping', REVIEW], ['Stock Receipts', RECEIPTS]]);
    const res = await svc.importStockReceipts(file, 't1', 'u1');

    expect(res.errors).toEqual([]);
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].qtyReceived)).toBe(12815);
  });

  it('still works when it is the only sheet', async () => {
    const { svc, lots } = build();
    const file = await workbook([['Stock Receipts', RECEIPTS]]);
    const res = await svc.importStockReceipts(file, 't1', 'u1');

    expect(res.errors).toEqual([]);
    expect(lots).toHaveLength(1);
  });

  it('falls back to the first sheet when nothing is named for it', async () => {
    // A plain one-tab file saved from the downloaded template keeps working,
    // whatever the person renamed the tab to.
    const { svc, lots } = build();
    const file = await workbook([['Sheet1', RECEIPTS]]);
    const res = await svc.importStockReceipts(file, 't1', 'u1');

    expect(res.errors).toEqual([]);
    expect(lots).toHaveLength(1);
  });
});
