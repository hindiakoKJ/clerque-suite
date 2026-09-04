import { ImportService } from './import.service';

// The generator is a plain CommonJS script, shared with the CLI that writes
// the workbook, so the spec and the CLI can never drift apart.
const generator = require('../../scripts/gen-recipe-costing-sheet');

/**
 * The recipe-costing workbook has to survive being uploaded back.
 *
 * scripts/gen-recipe-costing-sheet.js builds a sheet a shop fills in by hand,
 * and the whole point of naming that sheet "Ingredients" and giving it the
 * importer's own header and hint rows is that the file which comes back can be
 * uploaded rather than retyped. That coupling is invisible: the generator lives
 * in scripts/, the importer lives here, and nothing but this spec notices if
 * somebody rewords a header.
 *
 * The failure would be silent and expensive. findHeaderRow searches for 'Name*'
 * in the FIRST cell; miss it and headerIdx is -1, dataStart falls back to 1 and
 * the importer starts parsing the title and instruction rows as ingredients.
 * The hint row is dropped only because its first cell contains the word
 * "required"; reword it and "Required. Unique within tenant." is created as a
 * raw material.
 */
describe('the recipe-costing workbook still fits the Ingredients importer', () => {
  function svc() {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ businessType: 'COFFEE_SHOP' }) },
    };
    return new ImportService(prisma) as any;
  }

  async function templateRows(buf: Buffer): Promise<string[][]> {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet('Ingredients')!;
    const rows: string[][] = [];
    ws.eachRow((r) => rows.push(
      (r.values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v)))));
    return rows;
  }

  it('writes the header row the importer actually searches for', async () => {
    const rows = await templateRows(await svc().ingredientsTemplate('t1'));
    const shipped = rows.find((r) => r[0] === 'Name*');

    expect(shipped).toBeDefined();
    expect(generator.IMPORTER_HEADERS).toEqual(shipped);
    // The one column the workbook adds sits PAST Category, where the importer
    // never reads: cols 1-7 are destructured positionally and Category is found
    // by header, so nothing after it can shift a value into the wrong field.
    expect(generator.IMPORTER_HEADERS).toHaveLength(8);
    expect(generator.EXTRA_HEADER).toBeTruthy();
  });

  it('writes the hint row the importer knows to skip', async () => {
    const rows = await templateRows(await svc().ingredientsTemplate('t1'));
    const hdr = rows.findIndex((r) => r[0] === 'Name*');
    const shipped = rows[hdr + 1];

    expect(generator.IMPORTER_HINTS).toEqual(shipped);
    // importIngredientsFromRows drops this row on exactly this test.
    expect(generator.IMPORTER_HINTS[0].toLowerCase()).toContain('required');
  });

  it('offers no buy unit the conversion table cannot resolve', () => {
    // Every unit in the dropdown is either convertible outright or a container
    // the sheet then asks a Pack Size for. A unit in neither camp would produce
    // a row the importer rejects with no way for the shop to fix it.
    const known = new Set(generator.UNIT_TABLE.map((u: any[]) => u[0]));
    const containers = ['pc', 'pack', 'bottle', 'can', 'box', 'sachet', 'tray'];
    for (const u of generator.BUY_UNITS) {
      expect(known.has(String(u).toLowerCase()) || containers.includes(u)).toBe(true);
    }
  });
});

/**
 * The four answers the workbook collects, run through the importer for real.
 *
 * These are the exact shapes a cook produces on that sheet: a kilo price
 * against an ingredient held in grams, a bottle with a pack size, a litre price
 * against something held by weight. Each one is a branch of resolveBuyUnit, and
 * each is a way the shop's costing silently goes wrong if it lands differently
 * than the sheet promised.
 */
describe('what the filled-in workbook does when it is uploaded', () => {
  const HEADERS = generator.IMPORTER_HEADERS as string[];
  const HINTS = generator.IMPORTER_HINTS as string[];

  function run(rows: string[][], existingUnit = 'g') {
    const updated: any[] = [];
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve({ id: 'rm-' + where.name, name: where.name, unit: existingUnit, category: 'INGREDIENT' })),
        update: jest.fn().mockImplementation((args: any) => { updated.push(args.data); return Promise.resolve(args.data); }),
        create: jest.fn().mockImplementation((args: any) => { updated.push(args.data); return Promise.resolve(args.data); }),
      },
      bomItem: { count: jest.fn().mockResolvedValue(0) },
      variantBomItem: { count: jest.fn().mockResolvedValue(0) },
      subRecipeItem: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new ImportService(prisma) as any;
    return service.importIngredientsFromRows([HEADERS, HINTS, ...rows], 't1')
      .then((res: any) => ({ res, updated }));
  }

  it('turns a kilo price into a per-gram cost', async () => {
    // "Salt | kg | 85" against Salt held in grams. P0.085 a gram, and the
    // stored unit stays grams so the stock already counted still means what it
    // meant this morning.
    const { res, updated } = await run([['Salt', 'kg', '85', '', '', 'g', '', '']]);
    expect(res.errors).toEqual([]);
    expect(Number(updated[0].costPrice)).toBeCloseTo(0.085, 10);
    expect(updated[0].unit).toBe('g');
  });

  it('divides a container price by its pack size', async () => {
    const { res, updated } = await run([['Sriracha', 'bottle', '120', '', '', 'g', '340', '']]);
    expect(res.errors).toEqual([]);
    expect(Number(updated[0].costPrice)).toBeCloseTo(120 / 340, 10);
    expect(updated[0].unit).toBe('g');
  });

  it('refuses a pack size on a pair that already converts', async () => {
    // Arithmetically the shop is right — 1000 ml in a litre — but the importer
    // will not silently pick one of the two numbers, so the sheet must not
    // encourage both. Its cost column says "Leave Pack Size blank" here.
    const { res } = await run([['Soy sauce', 'L', '62', '', '', 'ml', '1000', '']], 'ml');
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toContain('Pack Size must be blank');
  });

  it('will not invent a density to get from litres to grams', async () => {
    const { res } = await run([['Oil', 'L', '175', '', '', 'g', '', '']]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toContain('Cannot get from');
  });

  it('keeps the stored unit when Recipe Unit is prefilled, which is why it is', async () => {
    /*
      The hazard the prefill exists for.

      Butter is held in grams. A row that names a kilo price and leaves Recipe
      Unit BLANK writes unit: 'kg' straight onto the ingredient — and nothing
      rescales the quantity already on the shelf, so 4,000 g of butter becomes
      4,000 kg without a single error. The generator writes the current unit
      into that cell and locks it, making this branch unreachable from the
      workbook; this test pins down what it is protecting against.
    */
    const blank = await run([['Butter', 'kg', '320', '', '', '', '', '']]);
    expect(blank.updated[0].unit).toBe('kg');
    expect(Number(blank.updated[0].costPrice)).toBe(320);

    const prefilled = await run([['Butter', 'kg', '320', '', '', 'g', '', '']]);
    expect(prefilled.updated[0].unit).toBe('g');
    expect(Number(prefilled.updated[0].costPrice)).toBeCloseTo(0.32, 10);
  });
});
