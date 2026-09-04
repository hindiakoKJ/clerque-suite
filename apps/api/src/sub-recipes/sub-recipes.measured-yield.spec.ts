import { SubRecipesService } from './sub-recipes.service';

/**
 * The batch yield is a number nobody can know before the first batch.
 *
 * A shop setting up a sauce is asked "how much does one batch make?" and the
 * honest answer is "we have never weighed it". So the figure entered at setup
 * is a guess — and it never corrected itself: the system multiplied that guess
 * by the batch count forever, however far the pot drifted.
 *
 * It is not only a stock figure. Cost per unit is `what went in / what came
 * out`, so a wrong yield makes every dish containing the sauce wrong too, in a
 * direction nobody can see. Measuring the pot once fixes both at the same time.
 */
describe('SubRecipesService.makeBatch — what actually came out', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const SAUCE = 'sauce';
  const USER = 'cook-1';

  function build() {
    const events: any[] = [];
    const lots: any[] = [];
    const tx: any = {
      rawMaterialInventory: {
        update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ quantity: 0 }),
      },
      rawMaterial: { update: jest.fn().mockResolvedValue({}) },
      rawMaterialLot: {
        create: jest.fn(({ data }: any) => { lots.push(data); return Promise.resolve({}); }),
        findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}),
      },
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }),
      },
    };
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: SAUCE, name: 'Teriyaki Sauce', unit: 'ml', costPrice: 0.05, batchYield: 2000,
          subRecipeItems: [
            // PHP 100 of inputs per batch, so the arithmetic is easy to read.
            { id: 'a', quantity: 1000,
              rawMaterial: { id: 'soy', name: 'Soy sauce', unit: 'ml', costPrice: 0.1 } },
          ],
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      branch:  { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      station: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: { findMany: jest.fn().mockResolvedValue([{ rawMaterialId: 'soy', quantity: 999999 }]) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      subRecipeItem: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    return { svc: new SubRecipesService(prisma) as any, events, lots };
  }

  const make = (svc: any, over: Record<string, unknown> = {}) =>
    svc.makeBatch(TENANT, SAUCE, { branchId: BRANCH, batches: 1, ...over }, USER);

  it('uses the recipe yield when nobody measured — exactly as before', async () => {
    const { svc } = build();
    const res = await make(svc);
    expect(res.produced).toBe(2000);
    expect(res.yieldVariance).toBeNull();
  });

  it('uses what the cook measured when they did', async () => {
    // The pot reduced further than the recipe assumed.
    const { svc } = build();
    const res = await make(svc, { actualYield: 1600 });
    expect(res.produced).toBe(1600);
  });

  it('makes the cost per unit TRUE, not just the quantity', async () => {
    /*
      The point of measuring. PHP 100 of soy into 2000 ml is PHP 0.05/ml; the
      same PHP 100 into a real 1600 ml is PHP 0.0625/ml. A sauce that reduced
      further IS more concentrated and genuinely costs more per ml, and every
      dish using it should say so.
    */
    const { svc } = build();
    const res = await make(svc, { actualYield: 1600 });
    expect(res.unitCost).toBeCloseTo(0.0625, 6);
  });

  it('reports how far the pot drifted from the recipe', async () => {
    const { svc } = build();
    const res = await make(svc, { actualYield: 1600 });
    expect(res.expected).toBe(2000);
    expect(res.yieldVariance).toBeCloseTo(-0.2, 4);   // 20% less
  });

  it('measures the WHOLE run, not one batch of it', async () => {
    // The cook reads one number off the jug for everything they made.
    const { svc } = build();
    const res = await make(svc, { batches: 3, actualYield: 5400 });
    expect(res.expected).toBe(6000);
    expect(res.produced).toBe(5400);
  });

  it('records both numbers, so the drift survives the moment', async () => {
    const { svc, events } = build();
    await make(svc, { actualYield: 1600 });
    const p = events[0].payload;
    expect(p.quantity).toBe(1600);
    expect(p.expectedQuantity).toBe(2000);
    expect(p.measuredYield).toBe(1600);
  });

  it('leaves measuredYield null when nobody measured, rather than echoing the guess', async () => {
    // A guess recorded as a measurement is worse than no measurement.
    const { svc, events } = build();
    await make(svc);
    expect(events[0].payload.measuredYield).toBeNull();
  });

  it('puts the measured amount on the lot, so stock and cost agree', async () => {
    const { svc, lots } = build();
    await make(svc, { actualYield: 1600 });
    expect(Number(lots[0].qtyReceived)).toBe(1600);
    expect(Number(lots[0].unitCost)).toBeCloseTo(0.0625, 6);
  });

  it('refuses a measurement of zero rather than dividing by it', async () => {
    const { svc } = build();
    await expect(make(svc, { actualYield: 0 })).rejects.toThrow(/greater than zero/);
  });

  it('refuses a negative measurement', async () => {
    const { svc } = build();
    await expect(make(svc, { actualYield: -50 })).rejects.toThrow(/greater than zero/);
  });
});
