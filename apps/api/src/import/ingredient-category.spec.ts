import { ImportService } from './import.service';

/**
 * Ingredients cost a menu item. Supplies do not.
 *
 * Nothing in the model distinguished coffee beans from bleach — both are
 * bought, counted and run out — so a café's ingredient list quietly fills with
 * things that will never appear in a recipe. 17 of Cafe Carolina's 283 rows
 * were tissue, trash bags, batteries and a mixing bowl.
 *
 * With a category, the rule the owner asked for becomes enforceable: only an
 * INGREDIENT may be part of a recipe, so only an INGREDIENT reaches COGS. A
 * supply is still stocked and counted; it simply cannot cost a drink.
 */
describe('ImportService — ingredient vs supply', () => {
  const TENANT = 't1';
  const HEAD = ['Name*', 'Unit*', 'Cost per Unit (₱)*', 'Low Stock Alert', 'Notes',
                'Recipe Unit', 'Pack Size', 'Category'];

  function build() {
    const writes: any[] = [];
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: any) => { writes.push(data); return Promise.resolve({ id: 'rm' }); }),
        update: jest.fn(({ data }: any) => { writes.push(data); return Promise.resolve({ id: 'rm' }); }),
      },
    };
    const svc = new ImportService(prisma) as any;
    const run = (rows: string[][]) => svc.importIngredientsFromRows([HEAD, ...rows], TENANT);
    return { run, writes };
  }

  it('files a supply as a supply', async () => {
    const { run, writes } = build();
    const res = await run([['Zonrox Bleach', 'L', '62', '', '', 'ml', '', 'Kitchen Supply']]);

    expect(res.errors).toEqual([]);
    expect(writes[0].category).toBe('KITCHEN_SUPPLY');
  });

  it('accepts the ways a person actually writes it', async () => {
    // "Kitchen Supplies", "kitchen supply", "KITCHEN_SUPPLY" are one thing.
    const { run, writes } = build();
    await run([
      ['A', 'g', '1', '', '', 'g', '', 'Kitchen Supplies'],
      ['B', 'g', '1', '', '', 'g', '', 'bar supply'],
      ['C', 'g', '1', '', '', 'g', '', 'OFFICE_SUPPLY'],
      ['D', 'g', '1', '', '', 'g', '', 'Ingredient'],
    ]);
    expect(writes.map((w) => w.category)).toEqual([
      'KITCHEN_SUPPLY', 'BAR_SUPPLY', 'OFFICE_SUPPLY', 'INGREDIENT',
    ]);
  });

  it('refuses a category it does not recognise rather than filing it as food', async () => {
    const { run, writes } = build();
    const res = await run([['Mystery', 'g', '1', '', '', 'g', '', 'Consumables']]);

    expect(writes).toHaveLength(0);
    expect(res.errors[0].message).toMatch(/not one of/i);
  });

  it('leaves the category alone when the cell is blank', async () => {
    // A blank must not re-file something already categorised in the app.
    const { run, writes } = build();
    await run([['Coffee Beans', 'kg', '1100', '', '', 'g', '', '']]);

    expect(writes[0].category).toBeUndefined();
  });

  it('still imports a sheet with no Category column at all', async () => {
    // Every seven-column sheet already in the wild keeps working. The column is
    // located by header, not position, so its absence simply means "not
    // supplied" — and the database default files the row as INGREDIENT, which
    // is how it is being treated today anyway.
    const { run: _unused, writes } = build();
    void _unused;

    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: any) => { writes.push(data); return Promise.resolve({ id: 'rm' }); }),
        update: jest.fn().mockResolvedValue({ id: 'rm' }),
      },
    };
    const svc = new ImportService(prisma) as any;
    const res = await svc.importIngredientsFromRows([
      ['Name*', 'Unit*', 'Cost per Unit (₱)*', 'Low Stock Alert', 'Notes',
       'Recipe Unit', 'Pack Size'],
      ['Old Sheet', 'g', '1', '', '', 'g', ''],
    ], TENANT);

    expect(res.errors).toEqual([]);
    expect(writes[0].category).toBeUndefined();
  });
});

/**
 * The other half of the rule: a supply cannot be an ingredient of anything.
 */
describe('ImportService — recipes refuse a supply', () => {
  const TENANT = 't1';

  function build(category: string) {
    const created: any[] = [];
    const prisma: any = {
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', name: 'Latte' }),
        update:     jest.fn().mockResolvedValue({ id: 'p1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([{ id: 'rm1', name: 'Zonrox Bleach', unit: 'ml', category }]),
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
    const svc = new ImportService(prisma) as any;
    const run = () => svc.importRecipesFromRows([
      ['Product Name*', 'Ingredient Name*', 'Quantity*', 'Unit'],
      ['Latte', 'Zonrox Bleach', '5', 'ml'],
    ], TENANT);
    return { run, created };
  }

  it('lets an ingredient into a recipe', async () => {
    const { run, created } = build('INGREDIENT');
    const res = await run();
    expect(res.errors).toEqual([]);
    expect(created).toHaveLength(1);
  });

  it('refuses a kitchen supply, and says why', async () => {
    // Bleach in a recipe is a mistake worth seeing, not a row to skip quietly.
    const { run, created } = build('KITCHEN_SUPPLY');
    const res = await run();

    expect(created).toHaveLength(0);
    expect(res.errors[0].message).toMatch(/kitchen supply/i);
    expect(res.errors[0].message).toMatch(/expense, not a cost of sale/i);
  });

  it('refuses office and bar supplies too', async () => {
    for (const c of ['OFFICE_SUPPLY', 'BAR_SUPPLY']) {
      const { run, created } = build(c);
      await run();
      expect(created).toHaveLength(0);
    }
  });
});
