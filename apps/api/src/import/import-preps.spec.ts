import { ImportService } from './import.service';

/**
 * "Made in batches" — the things a kitchen makes ahead.
 *
 * The owner's costing spreadsheet failed on exactly this: a breading batch
 * that covers a hundred pieces, wings marinated eighty-six at a time, a plate
 * that is two of those. Batch totals were hand-copied between sheets, blank
 * rows costed at PHP 1 a gram, and "pcs", "g" and "portion" were mixed until
 * nobody could say what a plate cost.
 *
 * Pinned here: the rows become a prep with a recipe and a yield through the
 * app's own setRecipe; a prep of a prep is written after the prep it uses,
 * so the cost rolls up; the cost per unit is worked out from the recipe on
 * the spot — unless a real batch exists, in which case the measured average
 * is left alone.
 */
describe('ImportService — made in batches', () => {
  const TENANT = 't1';
  const HEADER = ['Prep Name*', 'One batch makes*', 'Counted in*', 'Ingredient*', 'Quantity per batch*', 'Unit', 'Notes'];
  const HINT   = ['Required on every row.', 'Required on the first row.', 'Required.', 'Required.', 'Required.', 'Optional.', 'Optional.'];

  // What the shop already has on the shelf, from the Ingredients sheet.
  // Twins: rows whose names differ only in case from a shelf row.
  const TWINS: Record<string, Array<{ id: string; name: string; unit: string; costPrice: number | null; category: string }>> = {};
  const SHELF: Record<string, { id: string; name?: string; unit: string; costPrice: number | null; category?: string }> = {
    'all purpose flour': { id: 'rm-flour',   unit: 'g',  costPrice: 0.0915 },
    'cornstarch':        { id: 'rm-starch',  unit: 'g',  costPrice: 0.068 },
    'salt':              { id: 'rm-salt',    unit: 'g',  costPrice: 0.1364 },
    'chicken wings':     { id: 'rm-wings',   name: 'Chicken Wings', unit: 'pc', costPrice: 29.0698 },
    'uncooked rice':     { id: 'rm-rice',    unit: 'g',  costPrice: 0.056 },
    'bleach':            { id: 'rm-bleach',  unit: 'ml', costPrice: 0.062, category: 'KITCHEN_SUPPLY' },
  };

  function build(opts: { batched?: string[]; plates?: Array<{ id: string; mode: string }> } = {}) {
    const created: any[] = [];
    const deleted: string[] = [];
    const updated: Array<{ id: string; data: any }> = [];
    const recipes: Array<{ id: string; makes: number; lines: any[] }> = [];
    const preps = new Map<string, { id: string; name: string; unit: string; costPrice: number | null }>();   // lowercased name
    let seq = 0;

    const prisma: any = {
      rawMaterial: {
        // Components are looked up with findMany (twins are a real hazard);
        // the prep itself with findFirst by exact name.
        findMany: jest.fn(({ where }: any) => {
          const key = String(where.name?.equals ?? '').toLowerCase();
          const out: any[] = [];
          for (const [k, p] of preps) if (k === key) out.push({ id: p.id, name: p.name, unit: p.unit, costPrice: p.costPrice, category: 'INGREDIENT' });
          const s = SHELF[key];
          if (s) out.push({ id: s.id, name: s.name ?? key, unit: s.unit, costPrice: s.costPrice, category: s.category ?? 'INGREDIENT' });
          for (const tw of (TWINS[key] ?? [])) out.push(tw);
          return Promise.resolve(out);
        }),
        findFirst: jest.fn(({ where }: any) => {
          const name: string = typeof where.name === 'string' ? where.name : where.name?.equals;
          const key = String(name).toLowerCase();
          // Preps made earlier in this run are findable, like a real table.
          const p = preps.get(key);
          if (p) return Promise.resolve({ id: p.id, unit: p.unit, costPrice: p.costPrice, category: 'INGREDIENT' });
          const s = SHELF[key];
          return Promise.resolve(s ? { id: s.id, unit: s.unit, costPrice: s.costPrice, category: s.category ?? 'INGREDIENT' } : null);
        }),
        create: jest.fn(({ data }: any) => {
          const id = `prep-${++seq}`;
          preps.set(String(data.name).toLowerCase(), { id, name: String(data.name), unit: data.unit, costPrice: null });
          created.push({ id, ...data });
          return Promise.resolve({ id, unit: data.unit, costPrice: null });
        }),
        update: jest.fn(({ where, data }: any) => {
          updated.push({ id: where.id, data });
          for (const p of preps.values()) if (p.id === where.id && data.costPrice != null) p.costPrice = Number(data.costPrice);
          return Promise.resolve({});
        }),
        delete: jest.fn(({ where }: any) => {
          for (const [k, p] of preps) if (p.id === where.id) preps.delete(k);
          deleted.push(where.id);
          return Promise.resolve({});
        }),
      },
      rawMaterialLot: {
        count: jest.fn(({ where }: any) => Promise.resolve((opts.batched ?? []).includes(where.rawMaterialId) ? 2 : 0)),
      },
      bomItem: {
        // Asked two ways: "which plates use this prep" (by rawMaterialId), and
        // "what is on this plate" (by productId) when a plate is re-costed.
        findMany: jest.fn(({ where }: any) => {
          if (where.rawMaterialId) return Promise.resolve((opts.plates ?? []).map((pl) => ({ productId: pl.id })));
          const prep = [...preps.values()].find((p) => p.costPrice != null);
          return Promise.resolve(prep ? [{ quantity: 2, rawMaterial: { costPrice: prep.costPrice } }] : []);
        }),
      },
      product: {
        update: jest.fn(),
        findFirst: jest.fn(({ where }: any) => {
          const pl = (opts.plates ?? []).find((x) => x.id === where.id);
          return Promise.resolve(pl ? { inventoryMode: pl.mode } : null);
        }),
      },
    };
    const subRecipes: any = {
      setRecipe: jest.fn((_t: string, id: string, makes: number, lines: any[]) => {
        recipes.push({ id, makes, lines });
        return Promise.resolve({});
      }),
    };
    const svc = new ImportService(prisma, undefined, subRecipes);
    const run = (rows: string[][]) => svc.importPrepsFromRows([HEADER, HINT, ...rows], TENANT);
    return { run, created, updated, deleted, recipes, prisma, subRecipes, preps };
  }

  const cost = (updated: Array<{ id: string; data: any }>, id: string) =>
    Number(updated.filter((u) => u.id === id && u.data.costPrice != null).pop()?.data.costPrice);

  it('turns the rows into a prep with a recipe, a yield, and a cost per unit', async () => {
    const { run, created, recipes, updated } = build();
    const res = await run([
      ['Breading', '100', 'portion', 'All Purpose Flour', '1000', '', ''],
      ['Breading', '',    '',        'Cornstarch',        '1000', '', ''],
      ['Breading', '',    '',        'Salt',              '15',   '', ''],
    ]);

    expect(res.errors).toEqual([]);
    expect(res.imported).toBe(1);
    expect(created[0]).toMatchObject({ name: 'Breading', unit: 'portion', category: 'INGREDIENT' });
    expect(Number(created[0].batchYield)).toBe(100);

    expect(recipes).toHaveLength(1);
    expect(recipes[0].makes).toBe(100);
    expect(recipes[0].lines).toEqual([
      { rawMaterialId: 'rm-flour',  quantity: 1000 },
      { rawMaterialId: 'rm-starch', quantity: 1000 },
      { rawMaterialId: 'rm-salt',   quantity: 15 },
    ]);
    // 91.50 + 68.00 + 2.046 = 161.546 for the batch, over 100 portions.
    expect(cost(updated, 'prep-1')).toBeCloseTo(1.6155, 3);
    expect(res.costed).toBe(1);
  });

  it('writes the breading before the wings that use it, so the cost rolls up', async () => {
    // Listed in the wrong order on purpose.
    const { run, recipes, updated, preps } = build();
    const res = await run([
      ['Marinated Wings', '86',  'pc',      'Chicken Wings',     '86',   '', ''],
      ['Marinated Wings', '',    '',        'Breading',          '86',   '', ''],
      ['Breading',        '100', 'portion', 'All Purpose Flour', '1000', '', ''],
      ['Breading',        '',    '',        'Salt',              '15',   '', ''],
    ]);

    expect(res.errors).toEqual([]);
    expect(recipes.map((r) => r.id)).toEqual(['prep-1', 'prep-2']);           // breading first
    const breadingId = preps.get('breading')!.id;
    const wingsId    = preps.get('marinated wings')!.id;
    expect(breadingId).toBe('prep-1');
    // Breading: (91.50 + 2.046) / 100 = 0.93546 per portion.
    expect(cost(updated, breadingId)).toBeCloseTo(0.9355, 3);
    // Wings: 86 x 29.0698 + 86 x 0.9355 = 2500 + 80.45 over 86 pieces.
    expect(cost(updated, wingsId)).toBeCloseTo((2500.0028 + 86 * 0.9355) / 86, 2);
  });

  /*
    The live trap. The shop already had "Chicken wings" at an old price; the
    sheet said "Chicken Wings" at the new one. A case-blind match took the
    old twin, and every plate costed its chicken at a third of the price.
  */
  it('prefers the row spelled exactly as written over a twin that differs in case', async () => {
    TWINS['chicken wings'] = [{ id: 'rm-old-wings', name: 'Chicken wings', unit: 'pc', costPrice: 10.98, category: 'INGREDIENT' }];
    try {
      const { run, recipes, updated, preps } = build();
      const res = await run([['Marinated Wings', '86', 'pc', 'Chicken Wings', '86', '', '']]);
      expect(res.errors).toEqual([]);
      expect(recipes[0].lines[0].rawMaterialId).toBe('rm-wings');          // the exact one, not rm-old-wings
      expect(cost(updated, preps.get('marinated wings')!.id)).toBeCloseTo(29.0698, 3);
    } finally { delete TWINS['chicken wings']; }
  });

  it('refuses twins outright when neither is spelled exactly as written', async () => {
    TWINS['chicken wings'] = [{ id: 'rm-old-wings', name: 'Chicken wings', unit: 'pc', costPrice: 10.98, category: 'INGREDIENT' }];
    try {
      const { run, recipes } = build();
      // "chicken WINGS" matches both "Chicken Wings" and "Chicken wings" case-blind, neither exactly.
      const res = await run([['Marinated Wings', '86', 'pc', 'chicken WINGS', '86', '', '']]);
      expect(res.errors[0].message).toMatch(/matches more than one ingredient.*"Chicken Wings".*"Chicken wings"/);
      expect(recipes).toEqual([]);
    } finally { delete TWINS['chicken wings']; }
  });

  /*
    Nothing is written until every row of a prep has been resolved. Before,
    an existing prep's yield and unit were rewritten first, and a bad row
    below it left the prep half-changed with its old recipe.
  */
  it('leaves an existing prep untouched when one of its new rows fails', async () => {
    const { run, updated, recipes } = build();
    await run([['Breading', '100', 'portion', 'Salt', '15', '', '']]);
    const writes = updated.length;
    const res = await run([['Breading', '50', 'pc', 'Paprika', '15', '', '']]);   // Paprika is not on the shelf
    expect(res.errors.map((e) => e.message).join('\n')).toMatch(/"Paprika" not found/);
    expect(updated.slice(writes)).toEqual([]);       // no new unit, yield, or cost
    expect(recipes).toHaveLength(1);                  // the first recipe stands
    expect(recipes[0].makes).toBe(100);
  });

  it('reuses a prep that differs from the sheet only in case, under the shop\'s own spelling', async () => {
    const { run, created, updated, recipes } = build();
    await run([['Breading', '100', 'portion', 'Salt', '15', '', '']]);
    const res = await run([['breading', '120', 'portion', 'Salt', '18', '', '']]);
    expect(res.errors).toEqual([]);
    expect(res.updated).toBe(1);
    expect(created).toHaveLength(1);                  // no twin
    const yieldWrite = updated.find((u) => u.id === 'prep-1' && u.data.batchYield != null);
    expect(Number(yieldWrite!.data.batchYield)).toBe(120);
    expect(yieldWrite!.data.name).toBeUndefined();    // spelling left as the shop has it
    expect(recipes[1]).toEqual({ id: 'prep-1', makes: 120, lines: [{ rawMaterialId: 'rm-salt', quantity: 18 }] });
  });

  it('refuses to turn a supply into a prep just because the names match', async () => {
    const { run, created, updated, recipes } = build();
    const res = await run([['Bleach', '10', 'ml', 'Salt', '5', '', '']]);
    expect(res.errors[0].message).toMatch(/"Bleach" is already on your list as a kitchen supply/);
    expect(created).toEqual([]);
    expect(updated).toEqual([]);
    expect(recipes).toEqual([]);
  });

  /*
    setRecipe can still say no -- a loop through a prep already in the shop,
    for one. A prep created and then left without a recipe would cost nothing
    on every plate that uses it, so it is taken back out, and the preps in
    this file built on it are skipped by name rather than costed at zero.
  */
  it('takes back a prep it created when the recipe is refused, and skips what was built on it', async () => {
    const { run, created, deleted, recipes, subRecipes, preps } = build();
    subRecipes.setRecipe.mockRejectedValueOnce(new Error('"Salt" is made from "Breading" (directly or further down), so this would loop.'));
    const res = await run([
      ['Breading',        '100', 'portion', 'Salt',          '15', '', ''],
      ['Marinated Wings', '86',  'pc',      'Breading',      '86', '', ''],
      ['Marinated Wings', '',    '',        'Chicken Wings', '86', '', ''],
    ]);
    expect(created).toHaveLength(1);
    expect(deleted).toEqual(['prep-1']);
    expect(preps.has('breading')).toBe(false);
    expect(recipes).toEqual([]);
    expect(res.imported).toBe(0);
    const msgs = res.errors.map((e) => e.message);
    expect(msgs[0]).toMatch(/Prep "Breading": .*would loop/);
    expect(msgs[1]).toMatch(/Prep "Marinated Wings": not imported, because "Breading"/);
  });

  it('writes the new prep cost onto the plates that use it -- recipe-based plates only', async () => {
    const { run, prisma, updated } = build({
      plates: [{ id: 'plate-recipe', mode: 'RECIPE_BASED' }, { id: 'plate-unit', mode: 'UNIT_BASED' }],
    });
    const res = await run([['Breading', '100', 'portion', 'Salt', '15', '', '']]);
    expect(res.errors).toEqual([]);
    // The unit-based plate keeps the price it was bought at; only the recipe-based one is re-costed.
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    const call = prisma.product.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'plate-recipe' });
    expect(Number(call.data.costPrice)).toBeCloseTo(2 * cost(updated, 'prep-1'), 4);
  });

  it('converts a kilo written on a gram ingredient', async () => {
    const { run, recipes } = build();
    const res = await run([['Cooked Rice', '375', 'serving', 'Uncooked Rice', '25', 'kg', '']]);
    expect(res.errors).toEqual([]);
    expect(recipes[0].lines[0]).toEqual({ rawMaterialId: 'rm-rice', quantity: 25000 });
  });

  it('leaves a measured cost alone once a real batch exists', async () => {
    const { run, updated, preps } = build({ batched: ['prep-1'] });
    const res = await run([['Breading', '100', 'portion', 'Salt', '15', '', '']]);
    expect(res.errors).toEqual([]);
    expect(res.keptCost).toBe(1);
    expect(res.costed).toBe(0);
    expect(updated.some((u) => u.id === preps.get('breading')!.id && u.data.costPrice != null)).toBe(false);
  });

  it('names the row when an ingredient is missing, and still imports the others', async () => {
    const { run, recipes } = build();
    const res = await run([
      ['Breading', '100', 'portion', 'Paprika', '15', '', ''],     // not on the shelf
      ['Cooked Rice', '375', 'serving', 'Uncooked Rice', '25000', '', ''],
    ]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/Breading.*row 3.*"Paprika" not found/);
    expect(recipes.map((r) => r.makes)).toEqual([375]);
  });

  it('refuses a supply in a batch, by name', async () => {
    const { run, recipes } = build();
    const res = await run([['Breading', '100', 'portion', 'Bleach', '10', '', '']]);
    expect(res.errors[0].message).toMatch(/"Bleach" is a kitchen supply, not an ingredient/);
    expect(recipes).toEqual([]);
  });

  it('asks for the yield, the unit, and a positive quantity — and does not guess', async () => {
    const { run, recipes } = build();
    const res = await run([
      ['No Yield',   '',    'pc',  'Salt', '15', '', ''],
      ['No Unit',    '10',  '',    'Salt', '15', '', ''],
      ['Zero Qty',   '10',  'pc',  'Salt', '0',  '', ''],
      ['Twice',      '10',  'pc',  'Salt', '5',  '', ''],
      ['Twice',      '',    '',    'salt', '5',  '', ''],
    ]);
    const msgs = res.errors.map((e) => e.message).join('\n');
    expect(msgs).toMatch(/One batch makes/);
    expect(msgs).toMatch(/Counted in/);
    expect(msgs).toMatch(/above 0/);
    expect(msgs).toMatch(/listed twice/);
    expect(recipes).toEqual([]);
  });

  it('refuses a loop rather than looping', async () => {
    const { run, recipes } = build();
    const res = await run([
      ['Sauce A', '10', 'ml', 'Sauce B', '5', '', ''],
      ['Sauce B', '10', 'ml', 'Sauce A', '5', '', ''],
    ]);
    expect(res.errors.map((e) => e.message).join('\n')).toMatch(/loop/);
    expect(recipes).toEqual([]);
  });

  it('skips the sample rows the template ships with, and the hint row', async () => {
    const { run, recipes } = build();
    const res = await run([['Sample - Breading', '100', 'portion', 'Salt', '15', '', '']]);
    expect(res.skipped).toBe(1);
    expect(res.errors).toEqual([]);
    expect(recipes).toEqual([]);
  });

  it('refuses to run without the sub-recipe rules rather than writing rows by hand', async () => {
    const svc = new ImportService({} as any);
    await expect(svc.importPrepsFromRows([HEADER], TENANT)).rejects.toThrow(/not available/);
  });
});
