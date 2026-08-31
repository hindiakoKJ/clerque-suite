import { SubRecipesService } from './sub-recipes.service';

/**
 * Monitoring a prep chain that is three levels deep.
 *
 * The shop preps ahead precisely so service is fast: a base, a mother sauce
 * built on the base, a finishing sauce built on that. The list used to look
 * exactly ONE level down, so it told a cook "you cannot make the finishing
 * sauce, you are out of mother sauce" and stopped there.
 *
 * That is the least useful true statement available. The cook still has to
 * walk the chain by hand to find out there is plenty of base and the thing
 * actually missing is sugar — which is the only fact anyone can act on.
 */
describe('SubRecipesService.list — seeing down the whole chain', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';

  //  L3 finishing  <- 300 ml L2  (+ 20 g herbs)
  //  L2 mother     <- 500 ml L1  (+ 200 ml cream)
  //  L1 base       <- 1000 ml water + 200 g sugar
  const CHAIN = [
    {
      id: 'L1', name: 'L1 Base Stock', unit: 'ml', costPrice: 0.02, batchYield: 1000,
      inventory: [] as Array<{ quantity: number }>,
      subRecipeItems: [
        { quantity: 1000, rawMaterial: { id: 'water', name: 'Water', unit: 'ml', costPrice: 0.002 } },
        { quantity: 200,  rawMaterial: { id: 'sugar', name: 'Sugar', unit: 'g',  costPrice: 0.085 } },
      ],
    },
    {
      id: 'L2', name: 'L2 Mother Sauce', unit: 'ml', costPrice: 0.13, batchYield: 600,
      inventory: [] as Array<{ quantity: number }>,
      subRecipeItems: [
        { quantity: 500, rawMaterial: { id: 'L1',    name: 'L1 Base Stock', unit: 'ml', costPrice: 0.02 } },
        { quantity: 200, rawMaterial: { id: 'cream', name: 'Cream',         unit: 'ml', costPrice: 0.35 } },
      ],
    },
    {
      id: 'L3', name: 'L3 Finishing Sauce', unit: 'ml', costPrice: 0.21, batchYield: 300,
      inventory: [] as Array<{ quantity: number }>,
      subRecipeItems: [
        { quantity: 300, rawMaterial: { id: 'L2',    name: 'L2 Mother Sauce', unit: 'ml', costPrice: 0.13 } },
        { quantity: 20,  rawMaterial: { id: 'herbs', name: 'Herbs',           unit: 'g',  costPrice: 1.10 } },
      ],
    },
  ];

  function build(stock: Record<string, number>) {
    const prisma: any = {
      rawMaterial: { findMany: jest.fn().mockResolvedValue(CHAIN) },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue(
          Object.entries(stock).map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity })),
        ),
      },
    };
    return new SubRecipesService(prisma) as any;
  }

  const of = (rows: any[], id: string) => rows.find((r) => r.id === id);

  it('says nothing is ready when the level below is empty', async () => {
    // Plenty of raw material, but no mother sauce made yet.
    const svc = build({ water: 100000, sugar: 10000, cream: 5000, herbs: 500 });
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L3').batches).toBe(0);
  });

  it('but says how many are possible once the levels below are made', async () => {
    /*
      water 100,000 and sugar 10,000 -> 50 batches of L1 -> 50,000 ml
      L1 50,000 and cream 5,000      -> 25 batches of L2 -> 15,000 ml
      L2 15,000 and herbs 500        -> 25 batches of L3
    */
    const svc = build({ water: 100000, sugar: 10000, cream: 5000, herbs: 500 });
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L3').batchesWithPrep).toBe(25);
  });

  it('flags that prep is needed first, so the two numbers are not confusing', async () => {
    const svc = build({ water: 100000, sugar: 10000, cream: 5000, herbs: 500 });
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L3').needsPrep).toBe(true);
  });

  it('names the RAW material that finally runs out, not the prep in the way', async () => {
    // Sugar is the binding constraint three levels down: 400 g only makes
    // 2 batches of L1, which is 2,000 ml, which is 4 batches of L2.
    const svc = build({ water: 100000, sugar: 400, cream: 5000, herbs: 500 });
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L3').rootLimitedBy).toBe('Sugar');
  });

  it('shows the path down to it, so the chain is visible', async () => {
    const svc = build({ water: 100000, sugar: 400, cream: 5000, herbs: 500 });
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L3').limiterChain).toEqual(['L2 Mother Sauce', 'L1 Base Stock', 'Sugar']);
  });

  it('points at the real constraint even when it is near the top', async () => {
    // Herbs run out immediately: 20 g is one batch of L3, whatever is below.
    const svc = build({ water: 100000, sugar: 10000, cream: 5000, herbs: 20 });
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L3').rootLimitedBy).toBe('Herbs');
    expect(of(rows, 'L3').batchesWithPrep).toBe(1);
  });

  it('counts what is already made, on top of what could be', async () => {
    // 600 ml of L2 already prepped is 2 batches of L3 without touching L1.
    const svc = build({ water: 0, sugar: 0, cream: 0, herbs: 500, L2: 600 });
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L3').batches).toBe(2);
    expect(of(rows, 'L3').batchesWithPrep).toBe(2);
    expect(of(rows, 'L3').needsPrep).toBe(false);
  });

  it('marks which components are themselves prepped', async () => {
    // The screen needs this to draw the chain rather than a flat list.
    const svc = build({ water: 100000, sugar: 10000, cream: 5000, herbs: 500 });
    const rows = await svc.list(TENANT, BRANCH);
    const comps = of(rows, 'L3').components;
    expect(comps.find((c: any) => c.rawMaterialId === 'L2').isPrep).toBe(true);
    expect(comps.find((c: any) => c.rawMaterialId === 'herbs').isPrep).toBe(false);
  });

  it('reads zero everywhere when the shelf is bare, without crashing', async () => {
    const svc = build({});
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L3').batches).toBe(0);
    expect(of(rows, 'L3').batchesWithPrep).toBe(0);
  });

  it('still costs and lists the bottom of the chain normally', async () => {
    const svc = build({ water: 100000, sugar: 10000, cream: 5000, herbs: 500 });
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'L1').batches).toBe(50);
    expect(of(rows, 'L1').needsPrep).toBe(false);
    expect(of(rows, 'L1').rootLimitedBy).toBe('Sugar');
  });

  /*
    Telling a thaw apart from a cook, without asking anyone.

    Carolina's "levels" are not a hierarchy: level 2 is 2 kg of sauce in the
    freezer and level 3 is the same 2 kg thawed on the line. Same ingredients,
    same weight, nothing added. The mechanism carries it already — a one-line
    recipe of 2000 g in, 2000 g out, moves quantity and cost across untouched.

    What does not carry is the vocabulary. "One batch makes 2000 g" and "I made
    some" are cooking words, and reading them next to a tub you are defrosting
    is nonsense. So the shape is INFERRED: one component, itself a prep, and
    the yield equals what goes in means nothing was added.

    Inferred rather than configured because every shop does this differently
    and none of them should have to fill in a form about it.
  */
  describe('a thaw is not a cook', () => {
    const FROZEN = {
      id: 'F', name: 'Spag Sauce FROZEN', unit: 'g', costPrice: 0.227, batchYield: 2000,
      inventory: [] as Array<{ quantity: number }>,
      subRecipeItems: [
        { quantity: 1200, rawMaterial: { id: 'tom', name: 'Tomato', unit: 'g', costPrice: 0.12 } },
        { quantity: 700,  rawMaterial: { id: 'mea', name: 'Meat',   unit: 'g', costPrice: 0.42 } },
      ],
    };
    const READY = {
      id: 'R', name: 'Spag Sauce READY', unit: 'g', costPrice: 0.227, batchYield: 2000,
      inventory: [] as Array<{ quantity: number }>,
      subRecipeItems: [
        { quantity: 2000, rawMaterial: { id: 'F', name: 'Spag Sauce FROZEN', unit: 'g', costPrice: 0.227 } },
      ],
    };

    function rot(stock: Record<string, number>) {
      const prisma: any = {
        rawMaterial: { findMany: jest.fn().mockResolvedValue([FROZEN, READY]) },
        rawMaterialInventory: {
          findMany: jest.fn().mockResolvedValue(
            Object.entries(stock).map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity })),
          ),
        },
      };
      return new SubRecipesService(prisma) as any;
    }

    it('calls the thaw a MOVE', async () => {
      const rows = await rot({ tom: 20000, mea: 12000, F: 2000 }).list(TENANT, BRANCH);
      expect(rows.find((r: any) => r.id === 'R').kind).toBe('MOVE');
    });

    it('names where it moves from', async () => {
      const rows = await rot({ tom: 20000, mea: 12000, F: 2000 }).list(TENANT, BRANCH);
      expect(rows.find((r: any) => r.id === 'R').movesFrom).toBe('Spag Sauce FROZEN');
    });

    it('calls the cook a MAKE', async () => {
      const rows = await rot({ tom: 20000, mea: 12000 }).list(TENANT, BRANCH);
      expect(rows.find((r: any) => r.id === 'F').kind).toBe('MAKE');
      expect(rows.find((r: any) => r.id === 'F').movesFrom).toBeNull();
    });

    it('is a MAKE when anything at all is added', async () => {
      // Same single source, but a pinch of herbs goes in: that is a recipe.
      const withHerbs = {
        ...READY,
        subRecipeItems: [
          ...READY.subRecipeItems,
          { quantity: 20, rawMaterial: { id: 'her', name: 'Herbs', unit: 'g', costPrice: 1.1 } },
        ],
      };
      const prisma: any = {
        rawMaterial: { findMany: jest.fn().mockResolvedValue([FROZEN, withHerbs]) },
        rawMaterialInventory: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const rows = await (new SubRecipesService(prisma) as any).list(TENANT, BRANCH);
      expect(rows.find((r: any) => r.id === 'R').kind).toBe('MAKE');
    });

    it('is a MAKE when the yield differs from what went in', async () => {
      // 2000 g in, 1800 g out is a reduction — real cooking, real loss.
      const reduced = { ...READY, batchYield: 1800 };
      const prisma: any = {
        rawMaterial: { findMany: jest.fn().mockResolvedValue([FROZEN, reduced]) },
        rawMaterialInventory: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const rows = await (new SubRecipesService(prisma) as any).list(TENANT, BRANCH);
      expect(rows.find((r: any) => r.id === 'R').kind).toBe('MAKE');
    });

    it('is a MAKE when the single source is bought, not prepped', async () => {
      // Decanting a purchased drum is still just stock, not a second state.
      const fromRaw = {
        ...READY,
        subRecipeItems: [
          { quantity: 2000, rawMaterial: { id: 'tom', name: 'Tomato', unit: 'g', costPrice: 0.12 } },
        ],
      };
      const prisma: any = {
        rawMaterial: { findMany: jest.fn().mockResolvedValue([FROZEN, fromRaw]) },
        rawMaterialInventory: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const rows = await (new SubRecipesService(prisma) as any).list(TENANT, BRANCH);
      expect(rows.find((r: any) => r.id === 'R').kind).toBe('MAKE');
    });

    it('still points at the freezer when the line is dry', async () => {
      const rows = await rot({ tom: 20000, mea: 12000, F: 0 }).list(TENANT, BRANCH);
      const ready = rows.find((r: any) => r.id === 'R');
      expect(ready.batches).toBe(0);
      expect(ready.limitedBy).toBe('Spag Sauce FROZEN');
      expect(ready.batchesWithPrep).toBeGreaterThan(0);
    });
  });
});
