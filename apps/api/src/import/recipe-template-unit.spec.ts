import { ImportService } from './import.service';

/**
 * The recipes template must ship the Unit column it documents.
 *
 * importRecipesFromRows finds that column by matching /^unit/i against the
 * HEADER row. The template shipped three headers — Product Name*, Ingredient
 * Name*, Quantity* — so the search returned -1 and the unit was never read.
 *
 * Meanwhile the template's own instructions promised "write the unit your
 * recipe actually uses (200 + ml) … Clerque converts it", and its sample rows
 * already wrote 'g' / 'ml' / 'pc' into a fourth column that had no header.
 *
 * So anyone who followed the instructions and wrote 200 ml against milk stored
 * in litres got 200 LITRES in one drink. Nothing errored. That is the exact
 * failure the comment above convertRecipeQuantity exists to prevent, and it
 * was live in the template that teaches people how to avoid it.
 */
describe('ImportService — the recipes template carries its Unit column', () => {
  function svc() {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ businessType: 'COFFEE_SHOP' }) },
    };
    return new ImportService(prisma) as any;
  }

  async function sheet(buf: Buffer) {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet('Recipes')!;
    const rows: string[][] = [];
    ws.eachRow((r) => rows.push(
      (r.values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v)))));
    return rows;
  }

  it('puts Unit in the header, where the importer looks for it', async () => {
    const rows = await sheet(await svc().recipesTemplate('t1'));
    const header = rows.find((r) => r.includes('Product Name*'))!;

    expect(header).toEqual(['Product Name*', 'Ingredient Name*', 'Quantity*', 'Unit']);
    // the importer's own search, run against the shipped header
    expect(header.findIndex((h) => /^unit/i.test(h.trim()))).toBe(3);
  });

  it('never ships a sample row whose unit would be ignored', async () => {
    // Sample rows carrying a 4th value under a 3-wide header was the tell.
    const rows = await sheet(await svc().recipesTemplate('t1'));
    const hdrIdx = rows.findIndex((r) => r.includes('Product Name*'));
    // the hints row sits under the header; the importer skips it the same way
    const data = rows.slice(hdrIdx + 1)
      .filter((r) => (r[0] ?? '').trim() !== '')
      .filter((r) => !(r[0] ?? '').toLowerCase().includes('required'));

    expect(data.length).toBeGreaterThan(0);
    for (const r of data) {
      expect(r[3]).toBeTruthy();          // every sample states its unit
      expect(['g', 'ml', 'pc']).toContain(r[3]);
    }
  });

  it('measures cups and lids in pieces, not grams', async () => {
    // A cup counted in grams is the same class of error the column prevents,
    // and a template teaches by example before anyone reads the instructions.
    const rows = await sheet(await svc().recipesTemplate('t1'));
    const hdrIdx = rows.findIndex((r) => r.includes('Product Name*'));

    for (const r of rows.slice(hdrIdx + 1)
           .filter((r) => !(r[0] ?? '').toLowerCase().includes('required'))) {
      if (/cup|lid|stirrer/i.test(r[1] ?? '')) expect(r[2 + 1]).toBe('pc');
      if (/milk/i.test(r[1] ?? ''))            expect(r[2 + 1]).toBe('ml');
    }
  });

  it('still reads a file that has no Unit column at all', async () => {
    // Optional, not required — every recipe sheet built before today must
    // keep importing, with the quantity taken in the ingredient's own unit.
    const created: any[] = [];
    const prisma: any = {
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', name: 'Latte' }),
        update:    jest.fn().mockResolvedValue({ id: 'p1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([{ id: 'rm1', name: 'the ingredient', unit: 'g' }]),
      },
      bomItem: {
        findFirst:  jest.fn().mockResolvedValue(null),
        findMany:   jest.fn().mockResolvedValue([]),
        create:     jest.fn(({ data }: any) => { created.push(data); return Promise.resolve(data); }),
        upsert:     jest.fn(({ create }: any) => { created.push(create); return Promise.resolve(create); }),
        update:     jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const s = new ImportService(prisma) as any;
    const res = await s.importRecipesFromRows([
      ['Product Name*', 'Ingredient Name*', 'Quantity*'],
      ['Latte', 'Coffee Beans', '18'],
    ], 't1');

    expect(res.errors).toEqual([]);
    expect(Number(created[0].quantity)).toBeCloseTo(18, 6);
  });
});
