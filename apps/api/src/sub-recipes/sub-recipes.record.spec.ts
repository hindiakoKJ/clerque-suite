import { SubRecipesService } from './sub-recipes.service';

/**
 * Every preparation leaves a record.
 *
 * Stock Movements — the "show me everything that happened to my inventory"
 * view — is assembled from AccountingEvent payloads. Making a batch emitted
 * none, so a preparation was the ONE stock movement in the whole system with
 * no trail: the sugar left the shelf, 2 kg of syrup appeared, and nothing
 * anywhere said who did it or when.
 *
 * For a shop that wants each preparation documented — kitchen or bar — that is
 * the gap. The record is deliberately NOT a ledger instruction: the journal
 * posts nothing for it, because the value moved within one account.
 */
describe('SubRecipesService.makeBatch — the record of the preparation', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const SYRUP = 'syrup';
  const USER = 'barista-1';

  function build() {
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
        create:   jest.fn().mockResolvedValue({}),
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
            { id: 'b', quantity: 1000,
              rawMaterial: { id: 'water', name: 'Filtered Water', unit: 'ml', costPrice: 0.002 } },
          ],
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([
          { rawMaterialId: 'sugar', quantity: 20000 },
          { rawMaterialId: 'water', quantity: 40000 },
        ]),
      },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const svc = new SubRecipesService(prisma) as any;
    return { svc, events };
  }

  const make = (svc: any, over: Record<string, unknown> = {}) =>
    svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1, ...over }, USER);

  it('records the preparation at all', async () => {
    const { svc, events } = build();
    await make(svc);
    expect(events).toHaveLength(1);
    expect(events[0].payload.kind).toBe('SUB_RECIPE_BATCH');
  });

  it('says WHO made it — the whole point of documenting prep', async () => {
    const { svc, events } = build();
    await make(svc);
    expect(events[0].payload.madeById).toBe(USER);
  });

  it('says when, and how many batches', async () => {
    const { svc, events } = build();
    await make(svc, { batches: 3 });
    expect(events[0].payload.batches).toBe(3);
    expect(typeof events[0].payload.madeAt).toBe('string');
  });

  it('records what came OUT, with its value', async () => {
    const { svc, events } = build();
    await make(svc);
    const p = events[0].payload;
    expect(p.rawMaterialName).toBe('White Sugar Syrup');
    expect(Number(p.quantity)).toBe(2000);
    expect(Number(p.totalValue)).toBeCloseTo(1200 * 0.085 + 1000 * 0.002, 2);
  });

  it('records every ingredient that went IN, so both sides are traceable', async () => {
    const { svc, events } = build();
    await make(svc);
    const consumed = events[0].payload.consumed;
    expect(consumed.map((c: any) => [c.name, c.quantity])).toEqual([
      ['White Sugar', 1200],
      ['Filtered Water', 1000],
    ]);
  });

  it('scales what went in with the batch count', async () => {
    const { svc, events } = build();
    await make(svc, { batches: 2 });
    expect(events[0].payload.consumed[0].quantity).toBe(2400);
  });

  it('carries the reference, so the record ties back to the tap that made it', async () => {
    const { svc, events } = build();
    await make(svc, { referenceNumber: 'BATCH-abc' });
    expect(events[0].payload.referenceNumber).toBe('BATCH-abc');
  });

  it('records inside the same transaction as the stock movement', async () => {
    // A batch that moved stock without leaving a record would be exactly the
    // hole this closes, just narrower.
    const { svc, events } = build();
    await make(svc);
    expect(events).toHaveLength(1);
  });

  it('leaves no record when the batch is a duplicate', async () => {
    // Nothing happened, so nothing should be documented as having happened.
    const { svc, events } = build();
    (svc as any).prisma.rawMaterialLot.findFirst =
      jest.fn().mockResolvedValue({ id: 'lot-1', qtyReceived: 2000 });
    const res = await make(svc, { referenceNumber: 'BATCH-seen' });
    expect(res.duplicate).toBe(true);
    expect(events).toHaveLength(0);
  });
});
