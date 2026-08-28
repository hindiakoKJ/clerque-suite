import { ImportService } from './import.service';

/**
 * Exporting ingredients and uploading the file straight back must change
 * nothing.
 *
 * That property is the whole reason the export exists. A shop that has to
 * rebuild its ingredient list in a spreadsheet outside the app ends up with
 * names that drift from the ones Clerque holds — and because the importer
 * matches on an exact, case-sensitive name, drift does not fail loudly. It
 * creates a second ingredient and leaves the recipes pointing at the first.
 *
 * So these tests check the round trip rather than the file: same names, same
 * units, same costs, nothing created.
 */
describe('ImportService — ingredient export round-trips', () => {
  const TENANT = 't1';

  const LIVE = [
    { name: 'Coffee Beans',           unit: 'g',  costPrice: '1.1',   lowStockAlert: '2000' },
    { name: 'Emborg Fresh Milk',      unit: 'ml', costPrice: '0.09',  lowStockAlert: null   },
    { name: 'Strawless Lid ( Cold )', unit: 'pc', costPrice: '1.6429', lowStockAlert: null  },
    { name: 'Agave Syrup',            unit: 'g',  costPrice: null,    lowStockAlert: null   },
  ];

  function build(live = LIVE) {
    const created: any[] = [];
    const updated: Array<{ id: string; data: any }> = [];
    const byName = new Map(live.map((m) => [m.name, m]));

    const prisma: any = {
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue(live),
        // exact-case lookup, exactly as the service does it
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(byName.has(where.name) ? { id: 'id-' + where.name } : null)),
        create: jest.fn(({ data }: any) => { created.push(data); return Promise.resolve({ id: 'new' }); }),
        update: jest.fn(({ where, data }: any) => {
          updated.push({ id: where.id, data });
          return Promise.resolve({ id: where.id });
        }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ businessType: 'COFFEE_SHOP' }) },
    };
    const svc = new ImportService(prisma);
    return { svc, prisma, created, updated };
  }

  /** Read the generated workbook back into the rows the importer would see. */
  async function rowsFromBuffer(buf: Buffer): Promise<string[][]> {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet('Ingredients')!;
    const out: string[][] = [];
    ws.eachRow((row) => {
      const vals = row.values as unknown[];
      out.push(vals.slice(1).map((v) => (v == null ? '' : String(v))));
    });
    return out;
  }

  it('writes one row per ingredient, with the real names', async () => {
    const { svc } = build();
    const rows = await rowsFromBuffer(await svc.ingredientsExport(TENANT));

    const names = rows.map((r) => r[0]);
    for (const m of LIVE) expect(names).toContain(m.name);
  });

  it('never marks the rows as samples', async () => {
    // isSampleRow skips anything starting "Sample -", so a stamped export
    // would upload as zero rows and look like the file simply did nothing.
    const { svc } = build();
    const rows = await rowsFromBuffer(await svc.ingredientsExport(TENANT));

    const stamped = rows.filter((r) => /^\s*sample\s*[-–—:]/i.test(String(r[0] ?? '')));
    expect(stamped).toEqual([]);
  });

  it('re-importing the exported file updates everything and creates nothing', async () => {
    const { svc, created, updated } = build();
    const rows = await rowsFromBuffer(await svc.ingredientsExport(TENANT));

    const res = await (svc as unknown as {
      importIngredientsFromRows(r: string[][], t: string): Promise<any>;
    }).importIngredientsFromRows(rows, TENANT);

    expect(res.errors).toEqual([]);
    expect(created).toEqual([]);                 // one create = a split ingredient
    expect(updated).toHaveLength(LIVE.length);
  });

  it('brings back every unit and cost unchanged', async () => {
    const { svc, updated } = build();
    const rows = await rowsFromBuffer(await svc.ingredientsExport(TENANT));
    await (svc as unknown as {
      importIngredientsFromRows(r: string[][], t: string): Promise<any>;
    }).importIngredientsFromRows(rows, TENANT);

    for (const m of LIVE) {
      const row = updated.find((u) => u.id === 'id-' + m.name)!;
      expect(row).toBeDefined();
      expect(row.data.unit).toBe(m.unit);
      if (m.costPrice == null) {
        // blank stays blank rather than being written as a zero
        expect(row.data.costPrice).toBeUndefined();
      } else {
        expect(Number(row.data.costPrice)).toBeCloseTo(Number(m.costPrice), 6);
      }
    }
  });

  it('survives a name with the punctuation Clerque actually stores', async () => {
    // "Strawless Lid ( Cold )" has spaces inside the brackets. Matching is
    // exact, so a builder that trimmed or normalised that would silently
    // create a duplicate on every single export-import cycle.
    const { svc, created } = build();
    const rows = await rowsFromBuffer(await svc.ingredientsExport(TENANT));
    await (svc as unknown as {
      importIngredientsFromRows(r: string[][], t: string): Promise<any>;
    }).importIngredientsFromRows(rows, TENANT);

    expect(created).toEqual([]);
    expect(rows.map((r) => r[0])).toContain('Strawless Lid ( Cold )');
  });

  it('exports an empty ingredient list without throwing', async () => {
    const { svc } = build([]);
    const buf = await svc.ingredientsExport(TENANT);
    expect(buf.length).toBeGreaterThan(0);
  });
});
