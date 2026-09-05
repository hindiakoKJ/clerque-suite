import * as ExcelJS from 'exceljs';
import { ImportService } from './import.service';

/**
 * What comes OUT of Clerque as "Made in batches" must go back IN unchanged.
 *
 * The owner's whole loop is: download what the system holds, fix a number,
 * upload it. If the export wrote a column the importer reads differently —
 * a yield on every row, a unit the converter rejects, a hint row it does not
 * skip — the loop would silently corrupt the very recipes it was meant to
 * correct. So the export is fed straight into the real importer here.
 */
describe('Made in batches — export, then import, without loss', () => {
  const TENANT = 't1';

  const HELD = [
    {
      name: 'Marinated Chicken Wings', unit: 'pc', batchYield: 86,
      subRecipeItems: [
        { quantity: 86, rawMaterial: { name: 'Breading',      unit: 'portion' } },
        { quantity: 86, rawMaterial: { name: 'Chicken Wings', unit: 'pc' } },
      ],
    },
    {
      name: 'Breading', unit: 'portion', batchYield: 100,
      subRecipeItems: [
        { quantity: 1000, rawMaterial: { name: 'All Purpose Flour', unit: 'g' } },
        { quantity: 15,   rawMaterial: { name: 'Salt',              unit: 'g' } },
      ],
    },
  ];

  const SHELF: Record<string, { id: string; unit: string; costPrice: number }> = {
    'chicken wings':     { id: 'rm-wings', unit: 'pc', costPrice: 29.0698 },
    'all purpose flour': { id: 'rm-flour', unit: 'g',  costPrice: 0.0915 },
    'salt':              { id: 'rm-salt',  unit: 'g',  costPrice: 0.1364 },
  };

  async function rowsOf(buf: Buffer): Promise<string[][]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v)));
      rows.push(vals);
    });
    return rows;
  }

  it('re-imports every prep with the same yield, unit and lines', async () => {
    // ── the shop as it stands ──────────────────────────────────────────────
    const exporter = new ImportService({
      rawMaterial: { findMany: jest.fn().mockResolvedValue(HELD) },
    } as any);
    const buf  = await exporter.prepsExport(TENANT);
    const rows = await rowsOf(buf);

    // The sheet the owner sees: a header, a hint, and one row per line.
    const header = rows.find((r) => r[0] === 'Prep Name*');
    expect(header).toBeTruthy();
    const body = rows.slice(rows.indexOf(header!) + 1).filter((r) => r[0] && !/required/i.test(r[0]));
    expect(body.map((r) => r.slice(0, 5))).toEqual([
      ['Breading',                '100', 'portion', 'All Purpose Flour', '1000'],
      ['Breading',                '',    '',        'Salt',              '15'],
      ['Marinated Chicken Wings', '86',  'pc',      'Breading',          '86'],
      ['Marinated Chicken Wings', '',    '',        'Chicken Wings',     '86'],
    ]);

    // ── straight back in ───────────────────────────────────────────────────
    const recipes: Array<{ id: string; makes: number; lines: any[] }> = [];
    const preps = new Map<string, { id: string; name: string; unit: string; costPrice: number | null }>();
    let seq = 0;
    const prisma: any = {
      rawMaterial: {
        findMany: jest.fn(({ where }: any) => {
          const key = String(where.name?.equals ?? '').toLowerCase();
          const out: any[] = [];
          for (const [k, p] of preps) if (k === key) out.push({ ...p, category: 'INGREDIENT' });
          const s = SHELF[key];
          if (s) out.push({ id: s.id, name: key, unit: s.unit, costPrice: s.costPrice, category: 'INGREDIENT' });
          return Promise.resolve(out);
        }),
        findFirst: jest.fn(({ where }: any) => {
          const p = preps.get(String(where.name).toLowerCase());
          return Promise.resolve(p ? { id: p.id, unit: p.unit, costPrice: p.costPrice } : null);
        }),
        create: jest.fn(({ data }: any) => {
          const id = `prep-${++seq}`;
          preps.set(String(data.name).toLowerCase(), { id, name: data.name, unit: data.unit, costPrice: null });
          return Promise.resolve({ id, unit: data.unit, costPrice: null });
        }),
        update: jest.fn(({ where, data }: any) => {
          for (const p of preps.values()) if (p.id === where.id && data.costPrice != null) p.costPrice = Number(data.costPrice);
          return Promise.resolve({});
        }),
      },
      rawMaterialLot: { count: jest.fn().mockResolvedValue(0) },
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      product: { update: jest.fn() },
    };
    const subRecipes: any = { setRecipe: jest.fn((_t: string, id: string, makes: number, lines: any[]) => { recipes.push({ id, makes, lines }); return Promise.resolve({}); }) };
    const importer = new ImportService(prisma, undefined, subRecipes);

    const res = await importer.importPrepsFromRows(rows, TENANT);

    expect(res.errors).toEqual([]);
    expect(res.imported).toBe(2);
    // Breading first (the wings use it), then the wings, each with its lines intact.
    expect(recipes).toEqual([
      { id: 'prep-1', makes: 100, lines: [{ rawMaterialId: 'rm-flour', quantity: 1000 }, { rawMaterialId: 'rm-salt', quantity: 15 }] },
      { id: 'prep-2', makes: 86,  lines: [{ rawMaterialId: 'prep-1',  quantity: 86 },   { rawMaterialId: 'rm-wings', quantity: 86 }] },
    ]);
    // ...and the cost rolled up through the chain.
    expect(preps.get('breading')!.costPrice).toBeCloseTo((1000 * 0.0915 + 15 * 0.1364) / 100, 4);
    expect(preps.get('marinated chicken wings')!.costPrice).toBeCloseTo((86 * 0.9355 + 86 * 29.0698) / 86, 2);
  });
});
