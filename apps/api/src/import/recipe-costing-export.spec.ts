import { ImportService } from './import.service';

/**
 * The costing export has two jobs that pull in opposite directions.
 *
 * It has to be pivot-ready -- headers on row 1, one row per fact, no merged
 * cells, each sheet a real Excel table -- and it has to remain a file the
 * Recipes importer takes back unchanged. Those constraints meet in the first
 * four columns, which are the importer's own, and in everything after them,
 * which the importer must never read.
 *
 * The failure this guards is silent in both directions. Add a column before
 * Unit and every recipe line imports its quantity from the wrong cell. Name a
 * later column "Unit cost" and findIndex(/^unit/i) could resolve the unit from
 * it. Put a selling price on the line-grain sheet and a pivot reports Buffalo
 * Wings at eleven times its price, with no error anywhere.
 */
describe('recipeCostingExport — pivot-ready, and still importable', () => {
  /** Two dishes: one fully priced, one with an ingredient that has no cost. */
  function svc() {
    const prisma: any = {
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            name: 'Americano ( Hot )', price: 80,
            category: { name: 'Black and White - Hot' },
            bomItems: [
              { quantity: 17, rawMaterial: { name: 'Coffee Beans', unit: 'g', costPrice: 1.1, subRecipeItems: [] } },
              { quantity: 1,  rawMaterial: { name: 'Hot Cup 12oz', unit: 'pc', costPrice: 5, subRecipeItems: [] } },
            ],
          },
          {
            name: 'Buffalo Wings', price: 150,
            category: { name: 'Wings & Chicken' },
            bomItems: [
              { quantity: 15, rawMaterial: { name: 'Sriracha', unit: 'g', costPrice: 0, subRecipeItems: [] } },
              { quantity: 30, rawMaterial: { name: 'Teriyaki Sauce', unit: 'ml', costPrice: 0.05, subRecipeItems: [{ id: 'sr1' }] } },
            ],
          },
        ]),
      },
    };
    return new ImportService(prisma) as any;
  }

  async function sheets(buf: Buffer) {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const read = (name: string) => {
      const ws = wb.getWorksheet(name)!;
      const rows: any[][] = [];
      ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
      return rows;
    };
    return { wb, read };
  }

  it('puts the headers on row 1, where a PivotTable expects them', async () => {
    const { read } = await sheets(await svc().recipeCostingExport('t1'));
    const rows = read('Recipes');
    // Not row 12 under a title and a block of instructions, which is what
    // makeTemplate produces and what makes Insert > PivotTable a chore.
    expect(rows[0][0]).toBe('Product Name*');
  });

  it('keeps the importer\'s four columns first, in its order', async () => {
    const { read } = await sheets(await svc().recipeCostingExport('t1'));
    const header = read('Recipes')[0];
    expect(header.slice(0, 4)).toEqual(['Product Name*', 'Ingredient Name*', 'Quantity*', 'Unit']);
  });

  it('adds no later column that could be mistaken for the Unit column', async () => {
    // importRecipesFromRows resolves Unit with findIndex(/^unit/i) over the
    // header row. A column called "Unit cost" would be a coin toss.
    const { read } = await sheets(await svc().recipeCostingExport('t1'));
    const header = read('Recipes')[0] as string[];
    for (const h of header.slice(4)) {
      expect(/^unit/i.test(String(h).trim())).toBe(false);
    }
  });

  it('wraps both data sheets in named tables, so the pivot source fills itself in', async () => {
    const { wb } = await sheets(await svc().recipeCostingExport('t1'));
    expect(wb.getWorksheet('Recipes')!.getTables().length).toBe(1);
    expect(wb.getWorksheet('Dish Costs')!.getTables().length).toBe(1);
  });

  it('keeps every dish-grain number off the line-grain sheet', async () => {
    /*
      The whole reason there are two sheets. A selling price on a line-grain
      row is summed once per ingredient, so a pivot of Buffalo Wings by
      category reports P150 x 11 and nobody can tell by looking.
    */
    const { read } = await sheets(await svc().recipeCostingExport('t1'));
    const header = (read('Recipes')[0] as string[]).map((h) => String(h).toLowerCase());
    for (const banned of ['sells for', 'margin', 'cost to make']) {
      expect(header.some((h) => h.includes(banned))).toBe(false);
    }
  });

  it('never claims a margin for a dish it cannot fully cost', async () => {
    const { read } = await sheets(await svc().recipeCostingExport('t1'));
    const rows = read('Dish Costs');
    const header = rows[0] as string[];
    const iName = header.indexOf('Product Name');
    const iPct  = header.indexOf('Margin %');
    const iDone = header.indexOf('Costing Complete?');

    const wings = rows.slice(1).find((r) => r[iName] === 'Buffalo Wings')!;
    /*
      The cached value is what a reader that does not calculate shows, so it is
      the one that has to be honest -- and for a dish carrying an unpriced
      ingredient the honest answer is nothing at all, not a percentage computed
      as though the missing ingredient were free.

      A formula returning "" caches as an empty string, which exceljs writes
      correctly (<v></v> with t="str") but does not hand back as `result` when
      the file is read in again. So the assertion is that it is NOT a number,
      which is the property that actually matters.
    */
    expect(typeof (wings[iPct] as any).result).not.toBe('number');
    expect((wings[iDone] as any).result).toBe('No');

    const americano = rows.slice(1).find((r) => r[iName] === 'Americano ( Hot )')!;
    expect((americano[iDone] as any).result).toBe('Yes');
    expect((americano[iPct] as any).result).toBeCloseTo((80 - (17 * 1.1 + 5)) / 80, 6);
  });

  it('marks an ingredient that is itself a recipe as made in-house', async () => {
    const { read } = await sheets(await svc().recipeCostingExport('t1'));
    const rows = read('Recipes');
    const header = rows[0] as string[];
    const iIng  = header.indexOf('Ingredient Name*');
    const iMade = header.indexOf('Made or Bought');
    const sauce = rows.slice(1).find((r) => r[iIng] === 'Teriyaki Sauce')!;
    const beans = rows.slice(1).find((r) => r[iIng] === 'Coffee Beans')!;
    expect(sauce[iMade]).toBe('Made in-house');
    expect(beans[iMade]).toBe('Bought');
  });

  it('carries a cached value on every formula, so a pivot has something to add', async () => {
    // exceljs writes <f> with no <v> unless a result is supplied, and a pivot
    // over never-calculated cells aggregates nothing.
    const { read } = await sheets(await svc().recipeCostingExport('t1'));
    const header = read('Recipes')[0] as string[];
    const iLine  = header.indexOf('Line Cost (₱)');
    const iPrice = header.indexOf('Priced?');
    let priced = 0;
    for (const row of read('Recipes').slice(1)) {
      const cell: any = row[iLine];
      expect(cell).toHaveProperty('formula');
      if (row[iPrice] === 'Yes') {
        // The money columns are what a pivot adds up, so these must arrive
        // already carrying a number.
        expect(typeof cell.result).toBe('number');
        priced++;
      } else {
        // An unpriced line caches an empty string on purpose: blank, so a
        // pivot leaves it out rather than counting the ingredient as free.
        expect(typeof cell.result).not.toBe('number');
      }
    }
    expect(priced).toBeGreaterThan(0);
  });

  it('goes back in through the real Recipes importer, quantities intact', async () => {
    const { read } = await sheets(await svc().recipeCostingExport('t1'));
    const rows = read('Recipes').map((r) => r.map((v: any) =>
      // parseAllSheets flattens each cell the same way: a formula cell becomes
      // its cached result. Mirrored here so the round trip is the real one.
      (v && typeof v === 'object' && 'result' in v) ? String(v.result) : String(v ?? '')));

    const written: any[] = [];
    const prisma: any = {
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rawMaterial: {
        // Each ingredient answers with its OWN unit. A single stubbed unit
        // would make the cup and the sauce fail conversion for a reason that
        // has nothing to do with the export.
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const name = String(where.name?.equals ?? '');
          const unit = /cup/i.test(name) ? 'pc' : /sauce/i.test(name) ? 'ml' : 'g';
          return Promise.resolve({ id: 'rm-' + name, unit, category: 'INGREDIENT' });
        }),
      },
      bomItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn().mockImplementation((a: any) => { written.push(a.data); return Promise.resolve(a.data); }),
      },
    };
    const importer = new ImportService(prisma) as any;
    const res = await importer.importRecipesFromRows(rows, 't1');

    expect(res.errors).toEqual([]);
    expect(written).toHaveLength(4);
    // 17 g of beans stays 17 -- the added costing columns shifted nothing.
    expect(written.map((w) => Number(w.quantity))).toEqual([17, 1, 15, 30]);
  });
});
