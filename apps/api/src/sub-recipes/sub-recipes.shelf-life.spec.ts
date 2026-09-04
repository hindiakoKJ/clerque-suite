import { SubRecipesService } from './sub-recipes.service';

/**
 * A prepared batch has a clock, and nothing was starting it.
 *
 * `makeBatch` created a lot with `expirationDate` left null, so a tub of sauce
 * thawed on Tuesday and a tub thawed three weeks ago were the same row to the
 * system. Two things fell out of that: FEFO had nothing to sort by and quietly
 * degraded to FIFO, and the expiry warnings — which read that column — never
 * fired for anything the shop made itself, only for things it bought.
 *
 * It bites hardest on the batch that is only PARTLY used. A shop that keeps a
 * ready tub on the line and a parked one behind it finishes neither in a day
 * by design, so the ready tub is the single most likely thing to spoil, and it
 * was the one thing with no recorded age.
 *
 * Optional throughout: a shop that does not want to track this passes nothing
 * and gets exactly the old behaviour.
 */
describe('SubRecipesService.makeBatch — how long the batch is good for', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const SYRUP = 'syrup';
  const USER = 'barista-1';

  function build() {
    const lots: any[] = [];
    const events: any[] = [];
    const tx: any = {
      rawMaterialInventory: {
        update:     jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert:     jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ quantity: 500 }),
      },
      rawMaterial:    { update: jest.fn().mockResolvedValue({}) },
      rawMaterialLot: {
        create:   jest.fn(({ data }: any) => { lots.push(data); return Promise.resolve({}); }),
        findMany: jest.fn().mockResolvedValue([]),
        update:   jest.fn().mockResolvedValue({}),
      },
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }),
      },
    };
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: SYRUP, name: 'White Sugar Syrup', unit: 'g', costPrice: 0.052, batchYield: 2000,
          subRecipeItems: [
            { id: 'a', quantity: 1200,
              rawMaterial: { id: 'sugar', name: 'White Sugar', unit: 'g', costPrice: 0.085 } },
          ],
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([{ rawMaterialId: 'sugar', quantity: 20000 }]),
      },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      // Which products use this prep, and therefore which station it belongs
      // to. Empty = no station derived, which is permissive everywhere.
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      // And which preps use it, for the one-hop inheritance a parked tub needs.
      subRecipeItem: { findMany: jest.fn().mockResolvedValue([]) },
      // The shop's own stations, read so a persona scope written for a floor
      // plan this shop does not have cannot refuse every batch.
      station: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    return { svc: new SubRecipesService(prisma) as any, lots, events };
  }

  const MADE_AT = '2026-09-01T02:00:00.000Z';
  const make = (svc: any, over: Record<string, unknown> = {}) =>
    svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1, madeAt: MADE_AT, ...over }, USER);

  it('counts the shelf life forward from when the batch was made', async () => {
    // Not from now, and not from first use: a batch starts ageing when it is
    // prepared, whatever time it gets entered into the system.
    const { svc, lots } = build();
    await make(svc, { shelfLifeDays: 5 });
    expect(new Date(lots[0].expirationDate).toISOString()).toBe('2026-09-06T02:00:00.000Z');
  });

  it('takes an explicit date over the rule of thumb', async () => {
    // The cook holding the tub knows more than a default does.
    const { svc, lots } = build();
    await make(svc, { shelfLifeDays: 30, expiresAt: '2026-09-03T00:00:00.000Z' });
    expect(new Date(lots[0].expirationDate).toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('leaves it unset when the shop does not track it', async () => {
    // The old behaviour, unchanged — an untracked prep is not a broken one.
    const { svc, lots } = build();
    await make(svc);
    expect(lots[0].expirationDate).toBeNull();
  });

  it('puts the date on the record too, not only on the lot', async () => {
    // Stock Movements is read far more often than the lot table is.
    const { svc, events } = build();
    await make(svc, { shelfLifeDays: 5 });
    expect(events[0].payload.expiresAt).toBe('2026-09-06T02:00:00.000Z');
  });

  it('refuses a shelf life of zero rather than expiring the batch on arrival', async () => {
    const { svc } = build();
    await expect(make(svc, { shelfLifeDays: 0 })).rejects.toThrow(/positive number of days/);
  });

  it('refuses a negative shelf life', async () => {
    const { svc } = build();
    await expect(make(svc, { shelfLifeDays: -3 })).rejects.toThrow(/positive number of days/);
  });

  it('refuses a good-until date it cannot read, instead of silently dropping it', async () => {
    // Silently ignoring it would be the worst outcome: the cook believes the
    // batch is being tracked and it is not.
    const { svc } = build();
    await expect(make(svc, { expiresAt: 'next tuesday' })).rejects.toThrow(/not a valid date/);
  });
});
