import * as fs from 'fs';
import * as path from 'path';
import { ImportService } from './import.service';

/**
 * TEMPORARY — dry run of Cafe Carolina's 7 kitchen recipes.
 *
 * The two sheets have to be uploaded in order: 35 of the 36 ingredients the
 * recipes call for do not exist yet, and the recipe importer will not create
 * one it has never seen — it fails the line with "ingredient not found".
 *
 * So this replays both, in order, through the real service: create the
 * ingredients, then attach the recipes, and assert every line lands. It also
 * pins the thing the draft got wrong — "Butter" and "butter" as two rows,
 * which the case-SENSITIVE ingredient importer would have made two
 * ingredients while the case-INSENSITIVE recipe importer bound to whichever
 * came back first.
 *
 * Delete once the kitchen recipes are in.
 */
const FIXTURE = path.join(
  'C:', 'Users', 'user', 'AppData', 'Local', 'Temp', 'claude',
  'E--AI-Projects', '12414e15-462d-4a22-9b07-12611b929521', 'scratchpad',
  'kitchen-recipes-fixture.json',
);

const maybe = fs.existsSync(FIXTURE) ? describe : describe.skip;

maybe('Cafe Carolina — kitchen recipes dry run', () => {
  const TENANT = 'cmt1bvufw001bp501ci2zoqw2';
  let ingRows: string[][];
  let recRows: string[][];
  let products: string[];
  let liveMaterials: string[];

  beforeAll(() => {
    const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    ingRows       = f.ingredientRows;
    recRows       = f.recipeRows;
    products      = f.products;
    liveMaterials = f.liveMaterials;
  });

  /** A prisma stand-in that behaves like the real matching rules. */
  function build() {
    const materials = new Map<string, { id: string; name: string; unit: string }>();
    for (const n of liveMaterials) materials.set(n, { id: 'live-' + n, name: n, unit: 'ml' });
    const bom: Array<{ productId: string; rawMaterialId: string; quantity: number }> = [];
    const modes: Record<string, string> = {};

    const prisma: any = {
      rawMaterial: {
        // EXACT-case, as importIngredientsFromRows does
        findFirst: jest.fn(({ where }: any) => {
          if (where.name?.equals !== undefined) {
            // recipe path — case-INSENSITIVE
            const target = String(where.name.equals).toLowerCase();
            for (const [k, v] of materials) {
              if (k.toLowerCase() === target) return Promise.resolve(v);
            }
            return Promise.resolve(null);
          }
          return Promise.resolve(materials.get(where.name) ?? null);
        }),
        create: jest.fn(({ data }: any) => {
          const row = { id: 'new-' + data.name, name: data.name, unit: data.unit };
          materials.set(data.name, row);
          return Promise.resolve(row);
        }),
        update: jest.fn(({ where }: any) => Promise.resolve({ id: where.id })),
      },
      product: {
        findFirst: jest.fn(({ where }: any) => {
          const target = String(where.name?.equals ?? where.name ?? '').toLowerCase();
          const hit = products.find((p) => p.toLowerCase() === target);
          return Promise.resolve(hit ? { id: 'prod-' + hit, name: hit } : null);
        }),
        update: jest.fn(({ where, data }: any) => {
          if (data?.inventoryMode) modes[where.id] = data.inventoryMode;
          return Promise.resolve({ id: where.id });
        }),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      bomItem: {
        findFirst:  jest.fn(() => Promise.resolve(null)),
        findMany:   jest.fn(() => Promise.resolve([])),
        create:     jest.fn(({ data }: any) => { bom.push(data); return Promise.resolve(data); }),
        update:     jest.fn(({ data }: any) => Promise.resolve(data)),
        upsert:     jest.fn(({ create }: any) => { bom.push(create); return Promise.resolve(create); }),
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    };
    const svc = new ImportService(prisma) as unknown as {
      importIngredientsFromRows(r: string[][], t: string): Promise<any>;
      importRecipesFromRows(r: string[][], t: string): Promise<any>;
    };
    return { svc, materials, bom, modes };
  }

  it('creates every ingredient the recipes need, with no duplicates', async () => {
    const { svc, materials } = build();
    const before = materials.size;
    const res = await svc.importIngredientsFromRows(ingRows, TENANT);

    expect(res.errors).toEqual([]);
    // one row in, one ingredient out — a case-duplicate would show up as two
    const dataRows = ingRows.slice(ingRows.findIndex((r) => r.includes('Name*')) + 1)
      .filter((r) => String(r[0] ?? '').trim() !== '');
    expect(materials.size - before).toBe(dataRows.length);
  });

  it('never ships the same ingredient under two spellings', async () => {
    // "Butter"/"butter" and "Siracha"/"Sriracha" were both in the draft.
    const names = ingRows.map((r) => String(r[0] ?? '').trim()).filter(Boolean);
    const lowered = names.map((n) => n.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it('attaches all 51 recipe lines once the ingredients exist', async () => {
    const { svc, bom } = build();
    await svc.importIngredientsFromRows(ingRows, TENANT);
    const res = await svc.importRecipesFromRows(recRows, TENANT);

    if (res.errors.length) console.error(res.errors.slice(0, 8));
    expect(res.errors).toEqual([]);
    const lines = recRows.slice(recRows.findIndex((r) => r.includes('Product Name*')) + 1)
      .filter((r) => String(r[0] ?? '').trim() !== '');
    expect(bom).toHaveLength(lines.length);
  });

  it('fails loudly if the recipes are uploaded first', async () => {
    // The whole reason the sheets are numbered. Without the ingredients this
    // must error rather than silently create empty recipes.
    const { svc, bom } = build();
    const res = await svc.importRecipesFromRows(recRows, TENANT);

    expect(res.errors.length).toBeGreaterThan(0);
    expect(String(res.errors[0].message)).toMatch(/not found/i);
    expect(bom.length).toBeLessThan(10);
  });

  it('binds every line to a product that really exists', async () => {
    const { svc, bom } = build();
    await svc.importIngredientsFromRows(ingRows, TENANT);
    await svc.importRecipesFromRows(recRows, TENANT);

    for (const line of bom) {
      expect(String(line.productId)).toMatch(/^prod-/);
    }
  });
});
