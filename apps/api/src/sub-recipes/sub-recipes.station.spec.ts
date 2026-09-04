import { SubRecipesService } from './sub-recipes.service';

/**
 * Which side of the shop used the ingredients.
 *
 * A cafe's kitchen and bar draw on ONE shelf. Sugar goes into the bar's syrup
 * and into the kitchen's glaze, and once it is off the shelf the record said
 * only that the shop used it — so "what does the kitchen cost to run" had no
 * answer, and neither did "which side is burning through the sugar".
 *
 * Recorded as a LABEL on the movement, deliberately, and NOT as a separate
 * stock balance. Splitting the shelf in two would mean the till reading one
 * pool and refusing a rice bowl whose sauce is booked to the other — the sale
 * is hard-refused with NOT_ENOUGH_INGREDIENTS before payment
 * (orders.service.ts). Attribution answers the question without breaking the
 * sale, which is the whole point.
 */
describe('SubRecipesService.makeBatch — attributing the prep to a station', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const SAUCE = 'sauce';
  const USER = 'cook-1';
  const KITCHEN = { id: 'st-kitchen', name: 'Kitchen', kind: 'KITCHEN' };

  function build(opts: { station?: any } = {}) {
    const events: any[] = [];
    const tx: any = {
      rawMaterialInventory: {
        update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ quantity: 0 }),
      },
      rawMaterial:    { update: jest.fn().mockResolvedValue({}) },
      rawMaterialLot: {
        create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }),
      },
    };
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: SAUCE, name: 'Spaghetti Sauce', unit: 'g', costPrice: 0.2, batchYield: 2000,
          subRecipeItems: [
            { id: 'a', quantity: 1500,
              rawMaterial: { id: 'tom', name: 'Tomatoes', unit: 'g', costPrice: 0.12 } },
          ],
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      branch:  { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      station: {
        findFirst: jest.fn().mockResolvedValue('station' in opts ? opts.station : KITCHEN),
        // The shop's own stations, read so a persona scope written for a floor
        // plan this shop does not have cannot refuse every batch.
        findMany:  jest.fn().mockResolvedValue([{ kind: 'KITCHEN' }, { kind: 'BAR' }]),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([{ rawMaterialId: 'tom', quantity: 50000 }]),
      },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      // Which products use this prep, and therefore which station it belongs
      // to. Empty = no station derived, which is permissive everywhere.
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      // And which preps use it, for the one-hop inheritance a parked tub needs.
      subRecipeItem: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    return { svc: new SubRecipesService(prisma) as any, events, prisma };
  }

  const make = (svc: any, over: Record<string, unknown> = {}) =>
    svc.makeBatch(TENANT, SAUCE, { branchId: BRANCH, batches: 1, ...over }, USER);

  it('records WHICH station made it', async () => {
    const { svc, events } = build();
    await make(svc, { stationId: KITCHEN.id });
    expect(events[0].payload.stationId).toBe('st-kitchen');
  });

  it('stores the station NAME too, so the record survives a rename', async () => {
    // Stock Movements reads this back months later. A bare id there means a
    // join per row, or more likely a screen that shows nothing.
    const { svc, events } = build();
    await make(svc, { stationId: KITCHEN.id });
    expect(events[0].payload.stationName).toBe('Kitchen');
    expect(events[0].payload.stationKind).toBe('KITCHEN');
  });

  it('leaves it blank when nobody said, rather than guessing', async () => {
    /*
      A station attributed by assumption would put the kitchen's sugar on the
      bar's running cost — a number that looks authoritative and is wrong,
      which is worse than a gap that is visibly a gap.
    */
    const { svc, events } = build();
    await make(svc);
    expect(events[0].payload.stationId).toBeNull();
    expect(events[0].payload.stationName).toBeNull();
  });

  it('refuses a station belonging to another shop', async () => {
    const { svc } = build({ station: null });
    await expect(make(svc, { stationId: 'someone-elses' }))
      .rejects.toThrow(/not in your organization/);
  });

  it('does not look up a station when none was given', async () => {
    // One query per batch that answers nothing is still one query per batch.
    const { svc, prisma } = build();
    await make(svc);
    expect(prisma.station.findFirst).not.toHaveBeenCalled();
  });

  it('scopes the station lookup to the tenant', async () => {
    const { svc, prisma } = build();
    await make(svc, { stationId: KITCHEN.id });
    expect(prisma.station.findFirst.mock.calls[0][0].where)
      .toMatchObject({ id: KITCHEN.id, tenantId: TENANT });
  });

  it('hands the station back to the caller, so the screen can confirm it', async () => {
    const { svc } = build();
    const res = await make(svc, { stationId: KITCHEN.id });
    expect(res.station).toEqual(KITCHEN);
  });

  it('still consumes and produces exactly as before — attribution changes no quantity', async () => {
    /*
      The guarantee that makes this safe to add. A label on a movement must not
      move the movement: the same tomatoes leave, the same sauce arrives.
    */
    const withIt = build();
    const without = build();
    const a = await make(withIt.svc, { stationId: KITCHEN.id });
    const b = await make(without.svc);
    expect(a.produced).toBe(b.produced);
    expect(a.consumed).toEqual(b.consumed);
    expect(a.unitCost).toBe(b.unitCost);
  });
});
