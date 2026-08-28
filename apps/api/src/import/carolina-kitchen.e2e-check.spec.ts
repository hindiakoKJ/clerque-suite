import * as fs from 'fs';
import * as path from 'path';
import { ImportService } from './import.service';

/**
 * TEMPORARY — dry run of the Cafe Carolina kitchen ingredient sheet.
 *
 * 283 ingredients none of which exist yet, in the two-unit format the first
 * attempt was missing. That omission is what made Chicken Wings land as kg at
 * ₱250 against a recipe written in pieces — a plate of Buffalo Wings would
 * have consumed two kilos of chicken.
 *
 * There is no import preview endpoint, so this replays the real sheet through
 * the real service and asserts the file is clean BEFORE it touches a live
 * shop: no errors, no ingredient silently stored in its buying unit, and the
 * kilo prices converted to the per-gram costs the recipes will consume.
 *
 * Delete once the kitchen import is done.
 */
const FIXTURE = path.join(
  'C:', 'Users', 'user', 'AppData', 'Local', 'Temp', 'claude',
  'E--AI-Projects', '12414e15-462d-4a22-9b07-12611b929521', 'scratchpad',
  'master-fixture.json',
);

const maybe = fs.existsSync(FIXTURE) ? describe : describe.skip;

maybe('Cafe Carolina — ingredient master, import sheet dry run', () => {
  const TENANT = 'cmt1bvufw001bp501ci2zoqw2';
  let rows: string[][];
  let dataRows: string[][];
  let headerIdx: number;
  let LIVE: Set<string>;
  let LIVE_ROWS: Array<{ id: string; name: string; unit: string }>;

  beforeAll(() => {
    rows = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).rows;
    headerIdx = rows.findIndex((r) => r.includes('Name*'));
    dataRows  = rows.slice(headerIdx + 1).filter((r) => String(r[0] ?? '').trim() !== '');
    const live = path.join(path.dirname(FIXTURE), 'upload-fixture.json');
    LIVE_ROWS = JSON.parse(fs.readFileSync(live, 'utf8')).live;
    LIVE = new Set<string>(LIVE_ROWS.map((m: any) => m.name));
  });

  function build() {
    const created: any[] = [];
    const updated: Array<{ id: string; data: any }> = [];
    const prisma: any = {
      rawMaterial: {
        // the 53 bar rows already exist and must UPDATE; the kitchen rows are
        // new and must CREATE. A bar row that creates means the name drifted.
        findFirst: jest.fn(({ where }: any) => {
          const hit = LIVE_ROWS.find((m) => m.name === where.name);
          return Promise.resolve(hit ? { id: hit.id } : null);
        }),
        create: jest.fn(({ data }: any) => {
          created.push(data);
          return Promise.resolve({ id: 'rm-' + created.length });
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

  it('imports without a single error', async () => {
    const { run } = build();
    const res = await run();
    // print them rather than just failing — the message names the fix
    if (res.errors.length) {
      console.error(res.errors.slice(0, 10));
    }
    expect(res.errors).toEqual([]);
  });

  it('updates the ingredients already in Clerque instead of duplicating them', async () => {
    const { run, created } = build();
    const res = await run();

    const dupes = created.filter((c) => LIVE.has(c.name));
    expect(dupes.map((c) => c.name)).toEqual([]);   // a dupe = a split ingredient
    expect(res.updated).toBe(LIVE.size);
    expect(created).toHaveLength(dataRows.length - LIVE.size);
  });

  it('never stores an ingredient in its buying unit', async () => {
    // The whole point of the two-unit format. If any row lands in kg or L, a
    // recipe quantity written in grams becomes a thousand-fold error.
    const { run, created } = build();
    await run();
    const wrong = created.filter((c) => ['kg', 'l'].includes(String(c.unit).toLowerCase()));
    expect(wrong.map((c) => `${c.name}: ${c.unit}`)).toEqual([]);
  });

  it('converts a kilo price into a per-gram cost', async () => {
    // The whole point of the two-unit columns: the sheet says what a KILO
    // costs, and Clerque stores the per-gram figure a recipe consumes. Ice is
    // the case in this file — ₱1.50/kg has to land as ₱0.0015/g, not ₱1.50.
    const { run, updated } = build();
    await run();

    const byId = new Map(LIVE_ROWS.map((m) => [m.id, m]));
    const ice = updated.find((u) => byId.get(u.id)?.name === 'Ice');
    expect(ice).toBeDefined();
    expect(ice!.data.unit).toBe('g');
    expect(Number(ice!.data.costPrice)).toBeCloseTo(0.0015, 8);
  });

  it('leaves the rows we flagged without a price rather than importing a zero', async () => {
    const { run, created } = build();
    const res = await run();

    const blank = dataRows.filter((r) => String(r[2]).trim() === '').length;
    expect(res.missingCost).toBe(blank);
    // a flagged row still lands, so a recipe can reference it — it simply
    // carries no cost until someone supplies one
    expect(created.length + res.updated).toBe(dataRows.length);
  });
});
