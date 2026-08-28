import * as fs from 'fs';
import * as path from 'path';
import { ImportService } from './import.service';

/**
 * TEMPORARY — a dry run of the Cafe Carolina price-upload sheet.
 *
 * Clerque has no import preview, and the ingredient importer matches on an
 * exact-case name (import.service.ts:2138) while the recipe importer matches
 * case-insensitively (:2540). A single letter of drift in the sheet therefore
 * does not fail loudly — it creates a SECOND ingredient, and the 400 live BOM
 * lines then bind to whichever row Postgres returns first.
 *
 * So before the owner uploads anything to a live shop, we replay the real
 * sheet through the real service against a stand-in for the real 53 rows and
 * assert the only thing that matters: nothing is created, and no unit moves.
 *
 * Delete once Carolina's costs are in.
 */
const FIXTURE = path.join(
  'C:', 'Users', 'user', 'AppData', 'Local', 'Temp', 'claude',
  'E--AI-Projects', '12414e15-462d-4a22-9b07-12611b929521', 'scratchpad',
  'upload-fixture.json',
);

type Live = { id: string; name: string; unit: string; costPrice: number };

const maybe = fs.existsSync(FIXTURE) ? describe : describe.skip;

maybe('Cafe Carolina — price upload dry run', () => {
  const TENANT = 'cmt1bvufw001bp501ci2zoqw2';
  let rows: string[][];
  let live: Live[];
  let intended: Record<string, string>;

  beforeAll(() => {
    const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    rows = f.rows;
    live = f.live;
    intended = f.intendedUnitChanges ?? {};
  });

  function build() {
    const created: any[] = [];
    const updated: Array<{ id: string; data: any }> = [];
    const byName = new Map(live.map((m) => [m.name, m]));

    const prisma: any = {
      rawMaterial: {
        // mirrors the service's exact-case lookup — no normalising here,
        // because normalising here is exactly the bug we are testing for
        findFirst: jest.fn(({ where }: any) => {
          const hit = byName.get(where.name);
          return Promise.resolve(hit ? { id: hit.id } : null);
        }),
        create: jest.fn(({ data }: any) => {
          created.push(data);
          return Promise.resolve({ id: 'new' });
        }),
        update: jest.fn(({ where, data }: any) => {
          updated.push({ id: where.id, data });
          return Promise.resolve({ id: where.id });
        }),
      },
    };
    const svc = new ImportService(prisma);
    const run = () =>
      (svc as unknown as {
        importIngredientsFromRows(r: string[][], t: string): Promise<any>;
      }).importIngredientsFromRows(rows, TENANT);
    return { run, created, updated };
  }

  it('updates every existing ingredient and creates none', async () => {
    const { run, created, updated } = build();
    const res = await run();

    expect(created).toHaveLength(0);           // a single new row = a split ingredient
    expect(updated).toHaveLength(live.length);
    expect(res.imported).toBe(0);
    expect(res.updated).toBe(live.length);
  });

  it('moves only the seven units we meant to move', async () => {
    // The whole danger of a re-import: `unit` is in the spread at :2156 and
    // quantities are never converted to match it. Seven pump-dispensed liquids
    // are deliberately moved g -> ml, which is only safe because stock is
    // empty. Every other unit must be untouched, and an unexpected move here
    // is precisely the silent 1000x error this test exists to catch.
    const { run, updated } = build();
    await run();

    const byId = new Map(live.map((m) => [m.id, m]));
    const moved: Record<string, string> = {};
    for (const u of updated) {
      const before = byId.get(u.id)!;
      if (before.unit !== u.data.unit) moved[before.name] = u.data.unit;
    }
    expect(moved).toEqual(intended);
  });

  it('reports no errors, so the upload will not look like it failed', async () => {
    const { run } = build();
    const res = await run();
    expect(res.errors).toEqual([]);
  });

  it('skips the unpriced rows rather than zeroing them', async () => {
    // A blank cost must not overwrite a price already entered in the app.
    const { run, updated } = build();
    const res = await run();

    const sheetPriced = rows.slice(1).filter((r) => String(r[2]).trim() !== '');
    const withCost = updated.filter((u) => u.data.costPrice !== undefined);

    expect(res.missingCost).toBe(rows.length - 1 - sheetPriced.length);
    expect(withCost).toHaveLength(sheetPriced.length);
    // and nothing that stayed blank got a zero written over it
    const byId = new Map(live.map((m) => [m.id, m]));
    const blanked = updated.filter(
      (u) => u.data.costPrice === undefined && byId.get(u.id)!.costPrice > 0);
    expect(blanked).toHaveLength(0);
  });

  it('would convert a kilo price into a per-gram cost when one is filled in', async () => {
    // Proves the sheet's contract: type the price of a whole kilo, get g.
    const { run, updated } = build();
    const i = rows.findIndex((r, n) => n > 0 && r[0] === 'Coffee Beans');
    if (i < 0) return;
    const original = [...rows[i]];
    rows[i] = ['Coffee Beans', 'kg', '1100', '', '', 'g', ''];
    await run();
    rows[i] = original;

    const row = updated.find((u) => u.id === live.find((m) => m.name === 'Coffee Beans')!.id)!;
    expect(row.data.unit).toBe('g');
    expect(Number(row.data.costPrice)).toBeCloseTo(1.1, 6);
  });
});
