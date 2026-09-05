import ExcelJS from 'exceljs';
import { ImportService } from './import.service';

/**
 * These tests exercise parsing, not the period lock, so every date is open.
 * importStockReceipts now REFUSES to run without a period service — failing
 * closed rather than silently skipping the lock — so the stub is required.
 */
const OPEN_PERIODS = { assertDateIsOpen: async () => undefined } as never;


/**
 * Go-live hardening for the importers (coffee-shop client, Friday cut-over):
 *  1. ExcelJS cell unwrapping (Date / richText / formula / hyperlink / error)
 *  2. Stock-receipt dates: real Excel Date, YYYY-MM-DD, DD/MM/YYYY, blank
 *  3. Recipes: flip to RECIPE_BASED only when ALL rows of a product imported;
 *     case-insensitive + whitespace-collapsed product / ingredient matching
 *  4. Thousands separators / peso prefixes through importProducts
 */

type AnyFn = (...args: any[]) => any;
const csvFile = (text: string, name = 'x.csv'): Express.Multer.File =>
  ({ originalname: name, buffer: Buffer.from(text, 'utf-8') } as Express.Multer.File);
const xlsxFile = async (fill: (ws: ExcelJS.Worksheet) => void): Promise<Express.Multer.File> => {
  const wb = new ExcelJS.Workbook();
  fill(wb.addWorksheet('Sheet1'));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { originalname: 'x.xlsx', buffer: buf } as Express.Multer.File;
};

// ── 1. Cell unwrapping ─────────────────────────────────────────────────────
describe('ImportService — ExcelJS cell unwrapping', () => {
  const svc = new ImportService({} as any, OPEN_PERIODS);
  const cell = (v: unknown): string =>
    (svc as unknown as { cellToString(v: unknown): string }).cellToString(v);

  it('formats a Date as YYYY-MM-DD (UTC, as ExcelJS reads Excel dates)', () => {
    expect(cell(new Date(Date.UTC(2026, 7, 19)))).toBe('2026-08-19');
    expect(cell(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
  });

  it('joins rich text runs', () => {
    expect(cell({ richText: [{ text: 'Whole ' }, { text: 'Milk', font: { bold: true } }] })).toBe('Whole Milk');
  });

  it('uses a formula cell\'s cached result (recursively)', () => {
    expect(cell({ formula: 'A1*2', result: 1250.5 })).toBe('1250.5');
    expect(cell({ sharedFormula: 'A1', result: 'Latte' })).toBe('Latte');
    expect(cell({ formula: 'TODAY()', result: new Date(Date.UTC(2026, 7, 19)) })).toBe('2026-08-19');
    expect(cell({ formula: 'A1/0', result: { error: '#DIV/0!' } })).toBe('');
  });

  it('uses a hyperlink cell\'s text, drops error cells, stringifies numbers, blanks null/undefined', () => {
    expect(cell({ text: 'Espresso Beans', hyperlink: 'https://example.com' })).toBe('Espresso Beans');
    expect(cell({ error: '#N/A' })).toBe('');
    expect(cell(89500)).toBe('89500');
    expect(cell(true)).toBe('true');
    expect(cell(null)).toBe('');
    expect(cell(undefined)).toBe('');
  });

  it('round-trips a real xlsx: Date, rich text, formula and hyperlink cells come out as plain strings', async () => {
    const file = await xlsxFile((ws) => {
      ws.addRow(['Date*', 'Ingredient/Product Name*', 'Quantity*', 'Unit Cost*']);
      const r = ws.addRow([]);
      r.getCell(1).value = new Date(Date.UTC(2026, 7, 19));
      r.getCell(2).value = { richText: [{ text: 'Whole ' }, { text: 'Milk', font: { bold: true } }] };
      r.getCell(3).value = { formula: '10*2', result: 20 };
      r.getCell(4).value = { text: '89.5', hyperlink: 'https://example.com' };
    });
    const sheets = await (svc as unknown as {
      parseAllSheets(f: Express.Multer.File): Promise<Map<string, string[][]>>;
    }).parseAllSheets(file);
    const rows = sheets.get('Sheet1')!;
    expect(rows[1]).toEqual(['2026-08-19', 'Whole Milk', '20', '89.5']);
    expect(rows[1].some((c) => c.includes('[object'))).toBe(false);
  });
});

// ── 2. Stock receipts dates ────────────────────────────────────────────────
describe('ImportService — importStockReceipts dates', () => {
  const RM_ID = 'rm-milk';
  let lotCreates: any[];
  let prisma: any;

  beforeEach(() => {
    lotCreates = [];
    const tx = {
      rawMaterialInventory: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      rawMaterial:          { update: jest.fn().mockResolvedValue({}) },
      rawMaterialLot:       { create: jest.fn(async (args: any) => { lotCreates.push(args.data); return {}; }) },
      bomItem:              { findMany: jest.fn().mockResolvedValue([]) },
      product:              { update: jest.fn().mockResolvedValue({}) },
      accountingEvent:      { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      branch:         { findFirst: jest.fn().mockResolvedValue({ id: 'br-1', name: 'Main' }) },
      // The importer nets input VAT for a VAT-registered shop, exactly as
      // receiveRawMaterial does, so opening stock and later deliveries are
      // valued on the same basis. UNREGISTERED keeps these fixtures on the
      // gross figures they were written against.
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'UNREGISTERED' }) },
      rawMaterial:    { findFirst: jest.fn().mockResolvedValue({ id: RM_ID, name: 'Whole Milk', costPrice: 0 }) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction:   jest.fn(async (fn: AnyFn) => fn(tx)),
    };
  });

  const HEADER = 'Date*,Ingredient/Product Name*,Quantity*,Unit Cost*,Branch,Payment Method,Vendor,Reference #';
  const receivedYmd = (d: Date) => d.toISOString().slice(0, 10);

  it('accepts YYYY-MM-DD and unambiguous DD/MM/YYYY (also 06/06 where the order cannot matter)', async () => {
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importStockReceipts(csvFile([
      HEADER,
      '2026-08-19,Whole Milk,10,89.5',
      '19/08/2026,Whole Milk,10,89.5',
      '06/06/2026,Whole Milk,10,89.5',
    ].join('\n')), 't1', 'u1');
    expect(res.errors).toEqual([]);
    expect(res.imported).toBe(3);
    expect(lotCreates.map((l) => receivedYmd(l.receivedAt))).toEqual(['2026-08-19', '2026-08-19', '2026-06-06']);
    // noon PH time == 04:00Z, so the PH calendar day is stable
    expect(lotCreates[0].receivedAt.toISOString()).toBe('2026-08-19T04:00:00.000Z');
  });

  it('REJECTS an ambiguous slash date (05/06/2026) instead of silently guessing day- or month-first', async () => {
    // Windows en-PH / fil-PH and PH Excel default to M/d/yyyy, so a PH CSV export writes 6 May as
    // "5/6/2026". Guessing either way back-dates a real receipt + GL line with no visible error.
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importStockReceipts(csvFile([
      HEADER,
      '05/06/2026,Whole Milk,10,89.5',
      '5/6/2026,Whole Milk,10,89.5',
      '8/19/2026,Whole Milk,10,89.5',   // PH Excel CSV export of 19 Aug: impossible day-first, must not import
    ].join('\n')), 't1', 'u1');
    expect(res.imported).toBe(0);
    expect(lotCreates).toEqual([]);
    expect(res.errors).toHaveLength(3);
    expect(res.errors[0].message).toContain('Ambiguous date');
    expect(res.errors[0].message).toContain('2026-06-05');
    expect(res.errors[0].message).toContain('2026-05-06');
    expect(res.errors[1].message).toContain('Ambiguous date');
    expect(res.errors[2].message).toContain('read as DD/MM/YYYY');
  });

  it('blank date is a row-level "Date is required." error (never a throw), other rows still import', async () => {
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importStockReceipts(csvFile([
      HEADER,
      ',Whole Milk,10,89.5',
      '2026-08-19,Whole Milk,10,89.5',
    ].join('\n')), 't1', 'u1');
    expect(res.errors).toEqual([{ row: expect.any(Number), message: 'Date is required.' }]);
    expect(res.imported).toBe(1);
  });

  it('a short row (only Date + Name) does not throw on the missing cells', async () => {
    const svc = new ImportService(prisma, OPEN_PERIODS);
    // CSV parser keeps only 2 cells for this row -> qtyStr/costStr are undefined
    const res = await svc.importStockReceipts(csvFile([HEADER, '2026-08-19,Whole Milk'].join('\n')), 't1', 'u1');
    expect(res.imported).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/Invalid quantity/);
  });

  it('rejects an impossible DD/MM date and SAYS it was read day-first', async () => {
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importStockReceipts(csvFile([
      HEADER,
      '13/25/2026,Whole Milk,10,89.5',
      '31/02/2026,Whole Milk,10,89.5',
      'next tuesday,Whole Milk,10,89.5',
    ].join('\n')), 't1', 'u1');
    expect(res.imported).toBe(0);
    expect(res.errors).toHaveLength(3);
    expect(res.errors[0].message).toContain('read as DD/MM/YYYY');
    expect(res.errors[1].message).toContain('read as DD/MM/YYYY');
    expect(res.errors[2].message).toMatch(/Use YYYY-MM-DD or DD\/MM\/YYYY/);
  });

  it('accepts a real Excel Date cell (typed into Excel, stored as a Date)', async () => {
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const file = await xlsxFile((ws) => {
      ws.addRow(HEADER.split(','));
      ws.addRow([new Date(Date.UTC(2026, 7, 19)), 'Whole Milk', 10, 89.5]);
    });
    const res = await svc.importStockReceipts(file, 't1', 'u1');
    expect(res.errors).toEqual([]);
    expect(res.imported).toBe(1);
    expect(receivedYmd(lotCreates[0].receivedAt)).toBe('2026-08-19');
  });
});

// ── 3. Recipes partial-import flip + insensitive matching ──────────────────
describe('ImportService — importRecipes', () => {
  // As they read AFTER the flip: recostProduct asks for the mode by id.
  const products = [
    { id: 'p-latte', name: 'Latte',         inventoryMode: 'RECIPE_BASED' },
    { id: 'p-esp',   name: 'Espresso Solo', inventoryMode: 'RECIPE_BASED' },
  ];
  const rms      = [{ id: 'rm-milk', name: 'Whole Milk' }, { id: 'rm-beans', name: 'Beans' }];
  const byName = (list: { id: string; name: string }[]) => jest.fn(async (args: any) => {
    if (args.where.id) return list.find((x) => x.id === args.where.id) ?? null;
    const w = args.where.name;
    const wanted: string = typeof w === 'string' ? w : w.equals;
    const ci = typeof w !== 'string' && w.mode === 'insensitive';
    return list.find((x) => (ci ? x.name.toLowerCase() === wanted.toLowerCase() : x.name === wanted)) ?? null;
  });
  // Ingredients are looked up with findMany, because twins are a real hazard.
  const manyByName = (list: { id: string; name: string }[]) => jest.fn(async (args: any) => {
    const wanted: string = args.where.name.equals;
    return list.filter((x) => x.name.toLowerCase() === wanted.toLowerCase());
  });
  let prisma: any;
  beforeEach(() => {
    prisma = {
      product:     { findFirst: byName(products), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      rawMaterial: { findMany: manyByName(rms) },
      bomItem:     {
        // recostProduct reads the BOM after an import; empty = nothing to write
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create:    jest.fn().mockResolvedValue({}),
        update:    jest.fn().mockResolvedValue({}),
      },
    };
  });

  it('matches product + ingredient names case-insensitively with whitespace collapsed', async () => {
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importRecipes(csvFile([
      'Product Name*,Ingredient Name*,Quantity*',
      '  ESPRESSO   solo ,beans,18',
    ].join('\n')), 't1');
    expect(res.errors).toEqual([]);
    expect(res.imported).toBe(1);
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 't1', name: { equals: 'ESPRESSO solo', mode: 'insensitive' } },
    }));
    expect(prisma.rawMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 't1', name: { equals: 'beans', mode: 'insensitive' } },
    }));
    expect(prisma.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['p-esp'] } }),
      data:  { inventoryMode: 'RECIPE_BASED' },
    }));
  });

  it('flips ONLY products whose rows all imported; a product with an errored row is NOT flipped and gets a note', async () => {
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importRecipes(csvFile([
      'Product Name*,Ingredient Name*,Quantity*',
      'Latte,whole milk,200',      // ok
      'Latte,Unobtainium,5',       // ingredient missing -> Latte incomplete
      'Espresso Solo,Beans,18',    // ok -> flipped
    ].join('\n')), 't1');

    expect(res.imported).toBe(2);
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.product.updateMany.mock.calls[0][0];
    expect(call.where.id.in).toEqual(['p-esp']);           // Latte (p-latte) NOT flipped
    expect(call.data).toEqual({ inventoryMode: 'RECIPE_BASED' });

    const note = res.errors.find((e) => e.message.includes('partially imported — not activated'));
    expect(note).toBeDefined();
    expect(note!.message).toContain('Product "Latte"');
    expect(res.errors.some((e) => e.message.includes('Ingredient "Unobtainium" not found'))).toBe(true);
  });

  /*
    The live trap, on the plate side: the shop held "Chicken wings" at an old
    price AND "Chicken Wings" at the new one. Exact spelling wins; twins with
    no exact match are refused by name, never picked at random.
  */
  it('takes the ingredient spelled exactly as written over a case twin, and refuses twins otherwise', async () => {
    prisma.rawMaterial = { findMany: manyByName([
      ...rms, { id: 'rm-wings-new', name: 'Chicken Wings' }, { id: 'rm-wings-old', name: 'Chicken wings' },
    ]) };
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importRecipes(csvFile([
      'Product Name*,Ingredient Name*,Quantity*',
      'Espresso Solo,Chicken Wings,2',      // exact -> the new one
      'Latte,chicken WINGS,2',              // neither twin exactly -> refused
    ].join('\n')), 't1');
    expect(prisma.bomItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.bomItem.create.mock.calls[0][0].data.rawMaterialId).toBe('rm-wings-new');
    expect(res.errors.some((e) => /"chicken WINGS" matches more than one ingredient.*"Chicken Wings".*"Chicken wings"/.test(e.message))).toBe(true);
    expect(prisma.product.updateMany.mock.calls[0][0].where.id.in).toEqual(['p-esp']);
  });

  it('writes the derived cost onto a product whose recipe imported cleanly, and leaves a partial one alone', async () => {
    prisma.bomItem.findMany = jest.fn(async ({ where }: any) =>
      where.productId === 'p-esp'   ? [{ quantity: 18,  rawMaterial: { costPrice: 1.1 } }]
      : where.productId === 'p-latte' ? [{ quantity: 200, rawMaterial: { costPrice: 0.09 } }]
      : []);
    const svc = new ImportService(prisma, OPEN_PERIODS);
    await svc.importRecipes(csvFile([
      'Product Name*,Ingredient Name*,Quantity*',
      'Latte,whole milk,200',
      'Latte,Unobtainium,5',          // Latte stays partial -> its stored cost is NOT touched
      'Espresso Solo,Beans,18',
    ].join('\n')), 't1');
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    const call = prisma.product.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'p-esp' });
    expect(Number(call.data.costPrice)).toBeCloseTo(19.8, 4);
  });

  it('an invalid quantity on one row also blocks that product\'s flip', async () => {
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importRecipes(csvFile([
      'Product Name*,Ingredient Name*,Quantity*',
      'Latte,Whole Milk,200',
      'latte,Beans,abc',
    ].join('\n')), 't1');
    expect(res.imported).toBe(1);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(res.errors.filter((e) => e.message.includes('partially imported — not activated'))).toHaveLength(1);
  });
});

// ── 4. Thousands separators / peso prefix through importProducts ──────────
describe('ImportService — importProducts number parsing', () => {
  it('"1,250.50" -> 1250.5 and "P 89,500" -> 89500', async () => {
    const creates: any[] = [];
    const prisma: any = {
      category: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      product:  {
        findFirst: jest.fn().mockResolvedValue(null),
        create:    jest.fn(async (args: any) => { creates.push(args.data); return { id: 'p-1' }; }),
      },
    };
    const svc = new ImportService(prisma, OPEN_PERIODS);
    const res = await svc.importProducts(csvFile([
      'Name*,Category,Price*,Cost Price*,VAT (Y/N),Barcode,Description',
      'Espresso Machine,,"1,250.50","P 89,500",Y,,',
    ].join('\n')), 't1');
    expect(res.errors).toEqual([]);
    expect(res.imported).toBe(1);
    expect(creates[0].price).toBe(1250.5);
    expect(creates[0].costPrice).toBe(89500);
  });
});
