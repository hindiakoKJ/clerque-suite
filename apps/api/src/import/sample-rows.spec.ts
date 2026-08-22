import ExcelJS from 'exceljs';
import { ImportService } from './import.service';

/**
 * Every template ships realistic sample rows. A first-time owner who forgets
 * to delete them must NOT end up with 'Espresso Solo', 'Globe Telecom' or two
 * fake journal entries in their books. These tests generate each template
 * through the real *Template() method, feed it straight back into the real
 * parser, and assert that nothing from the sample block is written while a
 * genuine row appended underneath still imports.
 */

type AnyFn = jest.Mock<any, any>;

function model(overrides: Record<string, unknown> = {}) {
  return {
    findFirst:  jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    findMany:   jest.fn().mockResolvedValue([]),
    create:     jest.fn().mockResolvedValue({ id: 'new-id' }),
    update:     jest.fn().mockResolvedValue({ id: 'upd-id' }),
    upsert:     jest.fn().mockResolvedValue({ id: 'ups-id' }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    ...overrides,
  };
}

function makePrisma(businessType = 'COFFEE_SHOP') {
  const tx = {
    rawMaterialInventory: model(),
    rawMaterial:          model(),
    rawMaterialLot:       model(),
    bomItem:              model(),
    product:              model(),
    accountingEvent:      model(),
  };
  return {
    tenant:          model({ findUnique: jest.fn().mockResolvedValue({ businessType }) }),
    category:        model(),
    product:         model(),
    productLot:      model(),
    branch:          model({ findFirst: jest.fn().mockResolvedValue({ id: 'br-1', name: 'Main Branch' }) }),
    inventoryItem:   model(),
    account:         model(),
    journalEntry:    model(),
    customer:        model(),
    vendor:          model(),
    rawMaterial:     model(),
    rawMaterialLot:  model(),
    bomItem:         model(),
    $transaction:    jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    __tx:            tx,
  };
}

const asFile = (buffer: Buffer, name = 'template.xlsx') =>
  ({ originalname: name, buffer } as unknown as Express.Multer.File);

/** Append real (non-sample) rows under the template's sample block. */
async function appendRows(buffer: Buffer, rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Read the generated template back as plain string rows (what the parser sees). */
async function readRows(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const rows: string[][] = [];
  wb.worksheets[0].eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v))));
  });
  return rows;
}

const expectSamplesIgnored = (r: { imported: number; updated: number; skipped: number; errors: unknown[] }, sampleCount: number) => {
  expect(r.errors).toEqual([]);
  expect(r.imported).toBe(0);
  expect(r.updated).toBe(0);
  expect(r.skipped).toBe(sampleCount);
};

describe('ImportService — sample rows are ignored on import', () => {
  describe('isSampleRow()', () => {
    const svc = new ImportService({} as any);
    const isSample = (r?: string[]) =>
      (svc as unknown as { isSampleRow(r?: string[]): boolean }).isSampleRow(r);

    it('detects the marker and its hand-edited variants, case-insensitively', () => {
      expect(isSample(['SAMPLE - Espresso Solo', 'Beverages'])).toBe(true);
      expect(isSample(['SAMPLE -Espresso Solo'])).toBe(true);
      expect(isSample(['SAMPLE — JE-2026-001'])).toBe(true);
      expect(isSample(['SAMPLE – 1023'])).toBe(true);
      expect(isSample(['Sample: Globe Telecom'])).toBe(true);
      expect(isSample(['sample - x'])).toBe(true);
      expect(isSample(['  SAMPLE - padded'])).toBe(true);
    });

    it('looks at the first NON-EMPTY cell', () => {
      expect(isSample(['', '', 'SAMPLE - JE-2026-001'])).toBe(true);
    });

    it('does not flag genuine rows', () => {
      expect(isSample(['Espresso Solo', 'Beverages'])).toBe(false);
      expect(isSample(['Sample Kit - 3pc', 'Retail'])).toBe(false);
      expect(isSample(['Sampler Box'])).toBe(false);
      expect(isSample(['Samples of coffee'])).toBe(false);
      expect(isSample([])).toBe(false);
      expect(isSample(undefined)).toBe(false);
      expect(isSample(['', ''])).toBe(false);
    });
  });

  describe('makeTemplate()', () => {
    it('stamps every sample row with "SAMPLE - " and carries the instruction line', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const rows = await readRows(await svc.productsTemplate('t1'));
      const headerIdx = rows.findIndex((r) => r[0] === 'Name*');
      expect(headerIdx).toBeGreaterThan(0);
      const instructionBlock = rows.slice(0, headerIdx).map((r) => r[0]);
      expect(instructionBlock).toContain(
        'Rows starting with "SAMPLE - " are examples. They are IGNORED on import. Delete them or leave them — either is safe. Add your real rows below them.',
      );
      const dataRows = rows.slice(headerIdx + 2); // skip header + column-hints row
      expect(dataRows.length).toBeGreaterThan(0);
      for (const r of dataRows) expect(r[0]).toMatch(/^SAMPLE - /);
      expect(dataRows[0][0]).toBe('SAMPLE - Espresso Solo');
    });

    it('styles sample rows light-grey italic', async () => {
      const svc = new ImportService(makePrisma() as any);
      const buf = await svc.vendorsTemplate();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as any);
      const ws = wb.worksheets[0];
      let sampleRow: ExcelJS.Row | undefined;
      ws.eachRow((row) => {
        if (!sampleRow && String(row.getCell(1).value ?? '').startsWith('SAMPLE - ')) sampleRow = row;
      });
      expect(sampleRow).toBeDefined();
      expect(sampleRow!.getCell(1).font?.italic).toBe(true);
      expect(sampleRow!.getCell(1).font?.color?.argb).toBe('FF9E9E9E');
    });

    it('Bottled Water sample in the coffee-shop template is VAT-able (Y)', async () => {
      const svc = new ImportService(makePrisma('COFFEE_SHOP') as any);
      const rows = await readRows(await svc.productsTemplate('t1'));
      const water = rows.find((r) => r[0] === 'SAMPLE - Bottled Water');
      expect(water).toBeDefined();
      expect(water![4]).toBe('Y');
    });
  });

  describe('products', () => {
    it('imports nothing from the coffee-shop template as shipped', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      const r = await svc.importProducts(asFile(await svc.productsTemplate('t1')), 't1');
      expectSamplesIgnored(r, 8);
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.category.create).not.toHaveBeenCalled();
    });

    it('imports nothing from the pharmacy template as shipped', async () => {
      const prisma = makePrisma('PHARMACY');
      const svc = new ImportService(prisma as any);
      const r = await svc.importProducts(asFile(await svc.productsTemplate('t1')), 't1');
      expectSamplesIgnored(r, 8);
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.productLot.upsert).not.toHaveBeenCalled();
    });

    it('still imports a real row added under the samples', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.productsTemplate('t1'), [
        ['Americano 12oz', 'Beverages', '110', '25', 'Y', '', 'Espresso + hot water'],
      ]);
      const r = await svc.importProducts(asFile(buf), 't1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(8);
      expect(r.imported).toBe(1);
      expect(prisma.product.create).toHaveBeenCalledTimes(1);
      expect((prisma.product.create as AnyFn).mock.calls[0][0].data.name).toBe('Americano 12oz');
    });
  });

  describe('inventory', () => {
    it('imports nothing from the template as shipped', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const r = await svc.importInventory(asFile(await svc.inventoryTemplate()), 't1', 'br-1');
      expectSamplesIgnored(r, 4);
      expect(prisma.product.findFirst).not.toHaveBeenCalled();
    });

    it('still imports a real row added under the samples', async () => {
      const prisma = makePrisma();
      prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.inventoryTemplate(), [['Americano 12oz', '25', '5']]);
      const r = await svc.importInventory(asFile(buf), 't1', 'br-1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(4);
      expect(r.imported).toBe(1);
      expect(prisma.inventoryItem.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('setup pack (Products + Customers + Vendors + Chart of Accounts)', () => {
    it('imports nothing from the pack as shipped', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      const r = await svc.importSetupPack(asFile(await svc.setupPackTemplate('t1'), 'pack.xlsx'), 't1', 'br-1');

      // Every bundled sheet is read...
      for (const key of ['products', 'customers', 'vendors', 'chartOfAccounts']) {
        expect(r[key].notIncluded).toBe(false);
      }
      // ...and every one of them imports nothing but sample rows.
      expectSamplesIgnored(r.products, 8);
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
    });

    it('bundles Ingredients + Recipes for a business that MAKES what it sells', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      const r = await svc.importSetupPack(asFile(await svc.setupPackTemplate('t1'), 'pack.xlsx'), 't1', 'br-1');
      expect(r.ingredients.notIncluded).toBe(false);
      expect(r.recipes.notIncluded).toBe(false);
      // Shipped untouched, they still import nothing.
      expect(prisma.rawMaterial.create).not.toHaveBeenCalled();
    });

    it('leaves Ingredients + Recipes out for a shop that buys everything finished', async () => {
      const prisma = makePrisma('RETAIL');
      const svc = new ImportService(prisma as any);
      const r = await svc.importSetupPack(asFile(await svc.setupPackTemplate('t1'), 'pack.xlsx'), 't1', 'br-1');
      expect(r.ingredients.notIncluded).toBe(true);
      expect(r.recipes.notIncluded).toBe(true);
      expect(r.products.notIncluded).toBe(false);
    });

    it('no longer ships an Inventory sheet — opening stock lives on Products', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      const r = await svc.importSetupPack(asFile(await svc.setupPackTemplate('t1'), 'pack.xlsx'), 't1', 'br-1');
      expect(r.inventory.notIncluded).toBe(true);
    });

    it('still honours an Inventory sheet in a previously downloaded pack', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      // Rebuild an older-style pack: the standalone Inventory template as a
      // sheet named "Inventory" alongside Products.
      const ExcelJS = (await import('exceljs')).default;
      const packWb = new ExcelJS.Workbook();
      await packWb.xlsx.load((await svc.setupPackTemplate('t1')) as any);
      const invWb = new ExcelJS.Workbook();
      await invWb.xlsx.load((await svc.inventoryTemplate()) as any);
      const src = invWb.worksheets[0];
      const dest = packWb.addWorksheet('Inventory');
      src.eachRow((row, i) => { dest.getRow(i).values = row.values as any; });
      const buf = Buffer.from(await packWb.xlsx.writeBuffer());

      const r = await svc.importSetupPack(asFile(buf, 'legacy-pack.xlsx'), 't1', 'br-1');
      expect(r.inventory.notIncluded).toBe(false);
      expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
    });
  });

  describe('chart of accounts', () => {
    it('imports nothing from the template as shipped', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const r = await svc.importChartOfAccounts(asFile(await svc.coaTemplate()), 't1');
      expectSamplesIgnored(r, 5);
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('still imports a real row added under the samples', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.coaTemplate(), [
        ['1025', 'Cash in Bank – BDO', 'ASSET', 'DEBIT', 'BDO checking', ''],
      ]);
      const r = await svc.importChartOfAccounts(asFile(buf), 't1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(5);
      expect(r.imported).toBe(1);
      expect((prisma.account.create as AnyFn).mock.calls[0][0].data.code).toBe('1025');
    });
  });

  describe('journal entries', () => {
    it('imports nothing from the template as shipped (both sample JEs are whole-sample groups)', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const r = await svc.importJournalEntries(asFile(await svc.journalTemplate()), 't1', 'u1');
      expectSamplesIgnored(r, 4);
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
      expect(prisma.account.findFirst).not.toHaveBeenCalled();
    });

    it('still posts a real balanced entry added under the samples', async () => {
      const prisma = makePrisma();
      prisma.account.findFirst.mockResolvedValue({ id: 'acct-1' });
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.journalTemplate(), [
        ['JE-2026-003', '2026-08-01', 'Opening cash', '1010', '25000', '', ''],
        ['JE-2026-003', '2026-08-01', 'Opening cash', '3010', '', '25000', ''],
      ]);
      const r = await svc.importJournalEntries(asFile(buf), 't1', 'u1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(4);
      expect(r.imported).toBe(1);
      expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);
      expect((prisma.journalEntry.create as AnyFn).mock.calls[0][0].data.reference).toBe('JE-2026-003');
    });
  });

  describe('customers', () => {
    it('imports nothing from the template as shipped', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const r = await svc.importCustomers(asFile(await svc.customersTemplate()), 't1');
      expectSamplesIgnored(r, 3);
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('still imports a real row added under the samples', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.customersTemplate(), [
        ['Davao City Hall Canteen', '', 'Davao City', '', '', '30', '20000', ''],
      ]);
      const r = await svc.importCustomers(asFile(buf), 't1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(3);
      expect(r.imported).toBe(1);
      expect((prisma.customer.create as AnyFn).mock.calls[0][0].data.name).toBe('Davao City Hall Canteen');
    });
  });

  describe('vendors', () => {
    it('imports nothing from the template as shipped (no fabricated TINs land in AP)', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const r = await svc.importVendors(asFile(await svc.vendorsTemplate()), 't1');
      expectSamplesIgnored(r, 3);
      expect(prisma.vendor.create).not.toHaveBeenCalled();
    });

    it('still imports a real row added under the samples', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.vendorsTemplate(), [
        ['Davao Coffee Beans', '', 'Davao City', '', '', 'WC158', '0.01', 'Green beans supplier'],
      ]);
      const r = await svc.importVendors(asFile(buf), 't1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(3);
      expect(r.imported).toBe(1);
      expect((prisma.vendor.create as AnyFn).mock.calls[0][0].data.name).toBe('Davao Coffee Beans');
    });
  });

  describe('ingredients', () => {
    it('imports nothing from the coffee-shop template as shipped', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      const r = await svc.importIngredients(asFile(await svc.ingredientsTemplate('t1')), 't1');
      expectSamplesIgnored(r, 10);
      expect(prisma.rawMaterial.create).not.toHaveBeenCalled();
    });

    it('still imports a real row added under the samples', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.ingredientsTemplate('t1'), [
        ['Oat Milk', 'ml', '0.20', '1000', ''],
      ]);
      const r = await svc.importIngredients(asFile(buf), 't1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(10);
      expect(r.imported).toBe(1);
      expect((prisma.rawMaterial.create as AnyFn).mock.calls[0][0].data.name).toBe('Oat Milk');
    });
  });

  describe('recipes', () => {
    it('imports nothing from the coffee-shop template as shipped', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      const svc = new ImportService(prisma as any);
      const r = await svc.importRecipes(asFile(await svc.recipesTemplate('t1')), 't1');
      expectSamplesIgnored(r, 15);
      expect(prisma.bomItem.create).not.toHaveBeenCalled();
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it('still imports a real row added under the samples', async () => {
      const prisma = makePrisma('COFFEE_SHOP');
      prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
      prisma.rawMaterial.findFirst.mockResolvedValue({ id: 'rm-1' });
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.recipesTemplate('t1'), [
        ['Americano 12oz', 'Espresso Beans (Single-Origin)', '18'],
      ]);
      const r = await svc.importRecipes(asFile(buf), 't1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(15);
      expect(r.imported).toBe(1);
      expect(prisma.bomItem.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('stock receipts', () => {
    it('imports nothing from the template as shipped', async () => {
      const prisma = makePrisma();
      const svc = new ImportService(prisma as any);
      const r = await svc.importStockReceipts(asFile(await svc.stockReceiptsTemplate()), 't1', 'u1');
      expectSamplesIgnored(r, 4);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.rawMaterial.findFirst).not.toHaveBeenCalled();
    });

    it('still imports a real row added under the samples', async () => {
      const prisma = makePrisma();
      prisma.rawMaterial.findFirst.mockResolvedValue({ id: 'rm-1', name: 'Oat Milk', costPrice: 0.2 });
      const svc = new ImportService(prisma as any);
      const buf = await appendRows(await svc.stockReceiptsTemplate(), [
        ['2026-08-18', 'Oat Milk', '2000', '0.20', '', 'CASH', '', 'DR-0001'],
      ]);
      const r = await svc.importStockReceipts(asFile(buf), 't1', 'u1');
      expect(r.errors).toEqual([]);
      expect(r.skipped).toBe(4);
      expect(r.imported).toBe(1);
      expect(prisma.__tx.rawMaterialLot.create).toHaveBeenCalledTimes(1);
    });
  });
});
