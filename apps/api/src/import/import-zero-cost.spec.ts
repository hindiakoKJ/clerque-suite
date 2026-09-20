import { ImportService } from './import.service';

/**
 * A ₱0 uploaded against something a recipe uses.
 *
 * The sale costs a recipe line at `rawMaterial.costPrice ?? 0`, so an
 * ingredient at ₱0 is booked as free in every plate it goes into, and stock
 * loaded at ₱0 is averaged in as a real price of nothing. Carolina's shop
 * opened with fourteen recipe ingredients at ₱0 -- flour, oil, soy sauce,
 * honey, ketchup -- and the only sign was that gross profit looked good.
 *
 * Both spreadsheet doors now refuse it, by name, in words a cook can act on.
 * A blank cost cell still means "keep the cost it has", which is what lets a
 * shop write its recipes down before it has priced every carton.
 *
 * Supplies are deliberately not refused: bleach or a bin liner at ₱0 is an
 * expense, never part of what a plate costs.
 */
const OPEN_PERIODS = { assertDateIsOpen: async () => undefined } as never;
const csvFile = (text: string): Express.Multer.File =>
  ({ originalname: 'x.csv', buffer: Buffer.from(text, 'utf-8') } as Express.Multer.File);

const ING_HEADER = 'Name*,Unit*,Cost per Unit (₱)*,Low Stock Alert,Notes,Recipe Unit,Pack Size,Category';

describe('Uploading Ingredients with a cost of 0', () => {
  /** @param inRecipe ids of the ingredients some live recipe uses. */
  function build(inRecipe: string[]) {
    const updated: any[] = [];
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn(async ({ where }: any) => ({
          id: 'rm-' + where.name, name: where.name, unit: 'g', category: 'INGREDIENT', costPrice: 1,
        })),
        // The "is it in a recipe?" question, asked once for the whole upload.
        findMany: jest.fn(async () => inRecipe.map((id) => ({ id }))),
        update:   jest.fn(async (args: any) => { updated.push(args.data); return args.data; }),
        create:   jest.fn(async (args: any) => { updated.push(args.data); return args.data; }),
      },
      bomItem:                  { count: jest.fn().mockResolvedValue(0) },
      variantBomItem:           { count: jest.fn().mockResolvedValue(0) },
      subRecipeItem:            { count: jest.fn().mockResolvedValue(0) },
      modifierOptionIngredient: { count: jest.fn().mockResolvedValue(0) },
      rawMaterialInventory:     { count: jest.fn().mockResolvedValue(0) },
    };
    const run = (rows: string[]) =>
      (new ImportService(prisma, OPEN_PERIODS) as any)
        .importIngredientsFromRows([ING_HEADER.split(','), ...rows.map((r) => r.split(','))], 't1');
    return { run, prisma, updated };
  }

  it('refuses a 0 on an ingredient a recipe uses, and names it', async () => {
    const { run, updated } = build(['rm-Soy sauce']);
    const res = await run(['Soy sauce,g,0,,,,,']);

    expect(updated).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toContain('"Soy sauce"');
    expect(res.errors[0].message).toContain('cannot be 0');
    expect(res.errors[0].message).toContain('leave the cost cell blank');
  });

  it('keeps taking a blank cost, because that means "leave it as it is"', async () => {
    // The reason the blank is allowed: a shop writes its recipes down long
    // before it has priced every carton, and rejecting here would fail every
    // Recipes row afterwards with "ingredient not found".
    const { run, updated } = build(['rm-Soy sauce']);
    const res = await run(['Soy sauce,g,,,,,,']);

    expect(res.errors).toEqual([]);
    expect(updated).toHaveLength(1);
    expect(updated[0].costPrice).toBeUndefined();   // the cost on file is untouched
    expect(res.missingCost).toBe(1);                // and it is counted as unpriced
  });

  it('lets a supply through at 0 -- bleach never reaches a plate', async () => {
    const { run, updated } = build([]);             // in no recipe
    const res = await run(['Zonrox Bleach,ml,0,,,,,Kitchen Supply']);
    expect(res.errors).toEqual([]);
    expect(updated).toHaveLength(1);
  });

  it('asks the recipe question once for the whole sheet, not once per row', async () => {
    const { run, prisma } = build(['rm-Flour', 'rm-Oil', 'rm-Honey']);
    await run(['Flour,g,0,,,,,', 'Oil,ml,0,,,,,', 'Honey,g,0,,,,,']);
    const recipeQueries = prisma.rawMaterial.findMany.mock.calls.filter((c: any[]) => c[0].where.OR);
    expect(recipeQueries).toHaveLength(1);
  });

  it('does not ask at all when every row is priced', async () => {
    const { run, prisma } = build(['rm-Flour']);
    const res = await run(['Flour,g,0.05,,,,,']);
    expect(res.errors).toEqual([]);
    expect(prisma.rawMaterial.findMany).not.toHaveBeenCalled();
  });
});

describe('Uploading Stock Receipts at a unit cost of 0', () => {
  const RECEIPT_HEADER = 'Date*,Ingredient/Product Name*,Quantity*,Unit Cost*,Branch,Payment Method,Vendor,Reference #';

  function build(inRecipe: string[], category = 'INGREDIENT') {
    const lots: any[] = [];
    const tx: any = {
      rawMaterialInventory: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      rawMaterial:          { update: jest.fn().mockResolvedValue({}) },
      rawMaterialLot:       { create: jest.fn(async (a: any) => { lots.push(a.data); return {}; }) },
      bomItem:              { findMany: jest.fn().mockResolvedValue([]) },
      product:              { update: jest.fn().mockResolvedValue({}) },
      accountingEvent:      { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      branch:         { findFirst: jest.fn().mockResolvedValue({ id: 'br-1', name: 'Main' }) },
      tenant:         { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'UNREGISTERED' }) },
      rawMaterial:    {
        findFirst: jest.fn().mockResolvedValue({ id: 'rm-soy', name: 'Soy sauce', unit: 'g', category, costPrice: 0 }),
        findMany:  jest.fn(async () => inRecipe.map((id) => ({ id }))),
      },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction:   jest.fn(async (fn: any) => fn(tx)),
    };
    const run = (rows: string[]) =>
      new ImportService(prisma, OPEN_PERIODS)
        .importStockReceipts(csvFile([RECEIPT_HEADER, ...rows].join('\n')), 't1', 'u1');
    return { run, lots };
  }

  it('refuses opening stock at 0 for an ingredient a recipe uses', async () => {
    const { run, lots } = build(['rm-soy']);
    const res = await run(['2026-09-01,Soy sauce,5000,0,,OWNER_FUNDED,,TEST-OPENING']);

    expect(lots).toEqual([]);
    expect(res.imported).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toContain('"Soy sauce"');
    expect(res.errors[0].message).toContain('needs a cost');
  });

  it('takes the same row once it has a price', async () => {
    const { run, lots } = build(['rm-soy']);
    const res = await run(['2026-09-01,Soy sauce,5000,0.06,,OWNER_FUNDED,,TEST-OPENING']);
    expect(res.errors).toEqual([]);
    expect(res.imported).toBe(1);
    expect(lots).toHaveLength(1);
  });

  it('lets a supply in at 0, since it never reaches a plate', async () => {
    const { run } = build([], 'KITCHEN_SUPPLY');
    const res = await run(['2026-09-01,Soy sauce,10,0,,OWNER_FUNDED,,TEST-SUPPLY']);
    expect(res.errors).toEqual([]);
    expect(res.imported).toBe(1);
  });
});
