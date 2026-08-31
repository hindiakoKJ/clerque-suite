import { SubRecipesService } from './sub-recipes.service';

/**
 * The point of recording a batch is that the raw materials behind a prep
 * finally move.
 *
 * Before this, a latte consumed White Sugar Syrup and the White Sugar sat
 * untouched: it could never fall, never trip a reorder alert, and never reach
 * a buy list. The shop runs out of sugar with the system insisting it holds
 * eight kilos. Cafe Carolina's real numbers are used throughout — 1000 g sugar
 * plus 500 ml water yielding 1130 ml, priced at PHP 0.09/g and PHP 0.002/ml.
 */
describe('SubRecipesService — making a batch', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const SYRUP  = 'rm-syrup';

  function build(opts: {
    stock?: Record<string, number>;
    syrupStock?: number;
    syrupCost?: number;
    batchYield?: number | null;
    lines?: Array<{ id: string; name: string; unit: string; cost: number; qty: number }>;
    /** Lot layers behind a component, which the batch now drains oldest-first. */
    componentLots?: Array<{ id: string; qtyRemaining: number; receivedAt: Date }>;
  } = {}) {
    const lines = opts.lines ?? [
      { id: 'rm-sugar', name: 'White Sugar', unit: 'g',  cost: 0.09,  qty: 1000 },
      { id: 'rm-water', name: 'Water',       unit: 'ml', cost: 0.002, qty: 500  },
    ];
    const stock = { 'rm-sugar': 8000, 'rm-water': 108000, ...(opts.stock ?? {}) };
    const writes: Array<{ id: string; qty: number }> = [];
    const lots: any[] = [];
    const events: any[] = [];
    let syrupCost = opts.syrupCost ?? 0.0806;

    /*
      Stock writes are RELATIVE now -- { decrement } on the inputs and
      { increment } on the output -- so a sale ringing at the same moment is
      not erased by a total computed from a snapshot taken before it.

      The mock applies the change to a running balance and records the
      RESULT, so these cases keep asserting the quantity that ends up on the
      shelf rather than the shape of the write.
    */
    const balances: Record<string, number> = { ...stock, [SYRUP]: opts.syrupStock ?? 711 };
    const applied = (id: string, data: any, fallbackCreate?: any) => {
      const q = data?.quantity;
      if (q && typeof q === 'object' && 'decrement' in q) balances[id] = (balances[id] ?? 0) - Number(q.decrement);
      else if (q && typeof q === 'object' && 'increment' in q) balances[id] = (balances[id] ?? 0) + Number(q.increment);
      else if (q !== undefined) balances[id] = Number(q);
      else if (fallbackCreate?.quantity !== undefined) balances[id] = Number(fallbackCreate.quantity);
      writes.push({ id, qty: balances[id] });
    };

    const tx: any = {
      rawMaterialInventory: {
        update: jest.fn(({ where, data }: any) => {
          applied(where.branchId_rawMaterialId.rawMaterialId, data);
          return Promise.resolve({});
        }),
        upsert: jest.fn(({ where, create, update }: any) => {
          applied(where.branchId_rawMaterialId.rawMaterialId, update, create);
          return Promise.resolve({});
        }),
        // Floors anything the decrements pushed below zero. Nothing to do
        // here: makeBatch refuses outright when the inputs are short.
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ quantity: opts.syrupStock ?? 711 }),
      },
      rawMaterial:    { update: jest.fn(({ data }: any) => { syrupCost = Number(data.costPrice); return Promise.resolve({}); }) },
      /*
        A batch now records ITSELF: an event carrying who made it, when,
        what went in and what came out. The journal posts nothing for it --
        value moves within 1051 -- but Stock Movements reads it, and
        without it a preparation left no trail anywhere.
      */
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }),
      },
      rawMaterialLot: {
        create: jest.fn(({ data }: any) => { lots.push(data); return Promise.resolve({}); }),
        // The components' lot layers are drained too now: the batch used to
        // create a lot for its output and never touch the inputs', so
        // qtyRemaining kept counting stock already stirred into syrup.
        findMany: jest.fn().mockResolvedValue(opts.componentLots ?? []),
        update:   jest.fn().mockResolvedValue({}),
      },
    };

    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: SYRUP, name: 'White Sugar Syrup', unit: 'ml',
          costPrice: opts.syrupCost ?? 0.0806,
          batchYield: opts.batchYield === undefined ? 1130 : opts.batchYield,
          subRecipeItems: lines.map((l) => ({
            id: 'sri-' + l.id, quantity: l.qty,
            rawMaterial: { id: l.id, name: l.name, unit: l.unit, costPrice: l.cost },
          })),
        }),
        findMany: jest.fn().mockResolvedValue(lines.map((l) => ({ id: l.id, name: l.name }))),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue(
          Object.entries(stock).map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity })),
        ),
      },
      subRecipeItem: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const svc = new SubRecipesService(prisma) as any;
    return { svc, prisma, tx, writes, lots, events, cost: () => syrupCost };
  }

  it('consumes the inputs and adds the yield', async () => {
    const { svc, writes } = build();
    const res = await svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1');

    expect(writes.find((w) => w.id === 'rm-sugar')!.qty).toBe(7000);      // 8000 - 1000
    expect(writes.find((w) => w.id === 'rm-water')!.qty).toBe(107500);    // 108000 - 500
    expect(writes.find((w) => w.id === SYRUP)!.qty).toBe(1841);           // 711 + 1130
    expect(res.produced).toBe(1130);
  });

  it('values the batch at exactly what went into it', async () => {
    // The invariant. If the batch were worth more or less than its inputs,
    // stirring sugar into water would create or destroy inventory value.
    const { svc } = build();
    const res = await svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1');

    expect(res.inputValue).toBeCloseTo(1000 * 0.09 + 500 * 0.002, 6);   // 91.00
    expect(res.unitCost * res.produced).toBeCloseTo(res.inputValue, 6);
    expect(res.unitCost).toBeCloseTo(91 / 1130, 6);                     // 0.08053
  });

  it('scales cleanly across several batches', async () => {
    const { svc, writes } = build();
    const res = await svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 3 }, 'u1');

    expect(writes.find((w) => w.id === 'rm-sugar')!.qty).toBe(5000);
    expect(res.produced).toBe(3390);
    expect(res.unitCost * res.produced).toBeCloseTo(res.inputValue, 6);
  });

  it('blends the batch into the existing WAC rather than replacing it', async () => {
    // Syrup made in March at old sugar prices and syrup made today are the
    // same ingredient in the same bottle.
    const { svc, cost } = build({ syrupStock: 711, syrupCost: 0.20 });
    const res = await svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1');

    const expected = (711 * 0.20 + 1130 * (91 / 1130)) / 1841;
    expect(cost()).toBeCloseTo(expected, 6);
    expect(cost()).toBeGreaterThan(91 / 1130);   // pulled up by the dearer old stock
    expect(cost()).toBeLessThan(0.20);
  });

  it('refuses a batch the ingredients could not have made, and says which', async () => {
    // Recording an impossible batch is worse than recording nothing: it blends
    // a cost for stock that does not exist.
    const { svc, writes } = build({ stock: { 'rm-sugar': 400 } });
    await expect(svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1'))
      .rejects.toThrow(/not enough white sugar/i);
    expect(writes).toHaveLength(0);
  });

  it('refuses production when no recipe has been entered', async () => {
    const { svc } = build({ lines: [] });
    await expect(svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1'))
      .rejects.toThrow(/no recipe yet/i);
  });

  it('refuses production when the yield is unknown', async () => {
    const { svc } = build({ batchYield: null });
    await expect(svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1'))
      .rejects.toThrow(/no batch yield/i);
  });

  it('records a lot, so a batch is auditable and can drain FIFO', async () => {
    const { svc, lots } = build();
    await svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1, madeAt: '2026-08-30' }, 'u1');

    expect(lots).toHaveLength(1);
    expect(Number(lots[0].qtyReceived)).toBe(1130);
    expect(String(lots[0].referenceNumber)).toMatch(/^BATCH-2026-08-30-/);
  });

  it('names what was consumed, so the movement report can show both sides', async () => {
    const { svc } = build();
    const res = await svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 2 }, 'u1');
    expect(res.consumed).toEqual([
      { name: 'White Sugar', quantity: 2000, unit: 'g'  },
      { name: 'Water',       quantity: 1000, unit: 'ml' },
    ]);
  });

  /*
    Three things a batch screen makes urgent.

    Recording a batch is not something a person can SEE happening, it is done
    on a phone in a kitchen, and it moves stock AND revalues an ingredient. So
    it needs the same protections every other stock movement has: it must not
    happen twice on a double-tap, it must not restate a month that is closed,
    and it must drain the layers it consumed.
  */
  describe('protections a floor action needs', () => {
    it('makes the same batch only once for a given reference', async () => {
      const { svc, prisma, writes } = build();
      prisma.rawMaterialLot = {
        findFirst: jest.fn().mockResolvedValue({ id: 'lot-1', qtyReceived: 1130 }),
      };
      const res = await svc.makeBatch(
        TENANT, SYRUP, { branchId: BRANCH, batches: 1, referenceNumber: 'BATCH-abc' }, 'u1',
      );
      expect(res.duplicate).toBe(true);
      expect(writes).toHaveLength(0);
    });

    it('returns what the first attempt produced, rather than throwing', async () => {
      // A client retrying after a timeout should get the answer it would have
      // got the first time.
      const { svc, prisma } = build();
      prisma.rawMaterialLot = {
        findFirst: jest.fn().mockResolvedValue({ id: 'lot-1', qtyReceived: 1130 }),
      };
      const res = await svc.makeBatch(
        TENANT, SYRUP, { branchId: BRANCH, batches: 1, referenceNumber: 'BATCH-abc' }, 'u1',
      );
      expect(res.produced).toBe(1130);
    });

    it('makes the batch when the reference has not been seen', async () => {
      const { svc, prisma, writes } = build();
      prisma.rawMaterialLot = { findFirst: jest.fn().mockResolvedValue(null) };
      await svc.makeBatch(
        TENANT, SYRUP, { branchId: BRANCH, batches: 1, referenceNumber: 'BATCH-new' }, 'u1',
      );
      expect(writes.length).toBeGreaterThan(0);
    });

    it('stamps the caller reference on the lot, so the retry can find it', async () => {
      const { svc, prisma, lots } = build();
      prisma.rawMaterialLot = { findFirst: jest.fn().mockResolvedValue(null) };
      await svc.makeBatch(
        TENANT, SYRUP, { branchId: BRANCH, batches: 1, referenceNumber: 'BATCH-new' }, 'u1',
      );
      expect(lots[0].referenceNumber).toBe('BATCH-new');
    });

    it('refuses to record a batch into a closed month', async () => {
      const { svc, prisma } = build();
      const periods = { assertDateIsOpen: jest.fn().mockRejectedValue(new Error('Period is closed.')) };
      const svc2 = new (svc.constructor)(prisma, periods) as any;
      await expect(svc2.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1'))
        .rejects.toThrow(/closed/i);
    });

    it('writes nothing when the month is closed', async () => {
      const { svc, prisma, writes } = build();
      const periods = { assertDateIsOpen: jest.fn().mockRejectedValue(new Error('Period is closed.')) };
      const svc2 = new (svc.constructor)(prisma, periods) as any;
      await svc2.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1').catch(() => undefined);
      expect(writes).toHaveLength(0);
    });

    it('drains the components lot layers, oldest first', async () => {
      /*
        The batch created a lot for its OUTPUT and never touched the inputs',
        so qtyRemaining on the sugar kept counting stock already stirred into
        syrup. A later FIFO sale then drained a layer that was not there, at a
        price the shop had already used up.
      */
      const { svc, tx } = build({
        componentLots: [
          { id: 'lot-old', qtyRemaining: 600, receivedAt: new Date('2026-01-01') },
          { id: 'lot-new', qtyRemaining: 900, receivedAt: new Date('2026-06-01') },
        ],
      });
      await svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1');

      const drains = (tx.rawMaterialLot.update as jest.Mock).mock.calls.map((c) => ({
        id:   c[0].where.id,
        take: Number(c[0].data.qtyRemaining.decrement),
      }));
      // 1000 g of sugar: 600 from the old layer, then 400 from the newer one.
      expect(drains[0]).toEqual({ id: 'lot-old', take: 600 });
      expect(drains[1]).toEqual({ id: 'lot-new', take: 400 });
    });

    it('never drains more than a layer holds', async () => {
      const { svc, tx } = build({
        componentLots: [{ id: 'lot-small', qtyRemaining: 50, receivedAt: new Date('2026-01-01') }],
      });
      await svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches: 1 }, 'u1');
      for (const call of (tx.rawMaterialLot.update as jest.Mock).mock.calls) {
        expect(Number(call[0].data.qtyRemaining.decrement)).toBeLessThanOrEqual(50);
      }
    });
  });
});

describe('SubRecipesService — how many batches could still be made', () => {
  function build(stock: Record<string, number>) {
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rm-syrup', name: 'White Sugar Syrup', unit: 'ml',
          costPrice: 0.0806, batchYield: 1130,
          subRecipeItems: [
            { id: 's1', quantity: 1000, rawMaterial: { id: 'rm-sugar', name: 'White Sugar', unit: 'g',  costPrice: 0.09  } },
            { id: 's2', quantity: 500,  rawMaterial: { id: 'rm-water', name: 'Water',       unit: 'ml', costPrice: 0.002 } },
          ],
        }),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue(
          Object.entries(stock).map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity })),
        ),
      },
    };
    return new SubRecipesService(prisma) as any;
  }

  it('is limited by the tightest ingredient, and names it', async () => {
    // "8 left" with no cause sends the wrong person running. The sugar is the
    // constraint here; the water would allow 216 batches.
    const svc = build({ 'rm-sugar': 8000, 'rm-water': 108000 });
    const res = await svc.maxBatches('t1', 'rm-syrup', 'b1');

    expect(res.batches).toBe(8);
    expect(res.limitedBy).toBe('White Sugar');
    expect(res.yieldPerBatch).toBe(1130);
  });

  it('reports zero rather than a fraction of a batch', async () => {
    const svc = build({ 'rm-sugar': 400, 'rm-water': 108000 });
    const res = await svc.maxBatches('t1', 'rm-syrup', 'b1');
    expect(res.batches).toBe(0);
    expect(res.limitedBy).toBe('White Sugar');
  });

  it('treats an ingredient with no stock row as zero, not as unlimited', async () => {
    const svc = build({ 'rm-water': 108000 });
    const res = await svc.maxBatches('t1', 'rm-syrup', 'b1');
    expect(res.batches).toBe(0);
  });
});

/**
 * A sub-recipe that contains itself would make cost derivation and batch
 * counting recurse until the stack gives out. The database CHECK catches the
 * one-step case (A contains A); this covers the one it cannot see — A needs B,
 * B needs A — by walking the whole tree.
 */
describe('SubRecipesService — cycles', () => {
  function build(edges: Record<string, string[]>, names: Record<string, string>) {
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve({ id: where.id, name: names[where.id] ?? where.id })),
        findMany:  jest.fn(({ where }: any) =>
          Promise.resolve((where.id.in as string[]).map((id) => ({ id, name: names[id] ?? id })))),
      },
      subRecipeItem: {
        findMany: jest.fn(({ where }: any) => {
          const parents = where.parentRawMaterialId.in as string[];
          const out: Array<{ rawMaterialId: string }> = [];
          for (const p of parents) for (const c of edges[p] ?? []) out.push({ rawMaterialId: c });
          return Promise.resolve(out);
        }),
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    prisma.rawMaterial.update = jest.fn().mockResolvedValue({});
    return new SubRecipesService(prisma) as any;
  }
  const NAMES = { A: 'Sea Salt Cream', B: 'Cheese Foam', C: 'Condensed Milk' };

  it('accepts an ordinary recipe', async () => {
    const svc = build({}, NAMES);
    const res = await svc.setRecipe('t1', 'A', 500, [{ rawMaterialId: 'C', quantity: 5 }]);
    expect(res.lines).toBe(1);
  });

  it('refuses a component that already depends on the parent, two levels down', async () => {
    // B is made from A. Putting B into A would loop.
    const svc = build({ B: ['A'] }, NAMES);
    await expect(svc.setRecipe('t1', 'A', 500, [{ rawMaterialId: 'B', quantity: 5 }]))
      .rejects.toThrow(/would loop/i);
  });

  it('refuses a deeper loop too — A needs B needs C needs A', async () => {
    const svc = build({ B: ['C'], C: ['A'] }, NAMES);
    await expect(svc.setRecipe('t1', 'A', 500, [{ rawMaterialId: 'B', quantity: 5 }]))
      .rejects.toThrow(/would loop/i);
  });

  it('refuses an ingredient listed twice rather than silently doubling the batch', async () => {
    const svc = build({}, NAMES);
    await expect(svc.setRecipe('t1', 'A', 500, [
      { rawMaterialId: 'C', quantity: 5 },
      { rawMaterialId: 'C', quantity: 3 },
    ])).rejects.toThrow(/listed twice/i);
  });

  it('refuses a recipe with no yield', async () => {
    const svc = build({}, NAMES);
    await expect(svc.setRecipe('t1', 'A', 0, [{ rawMaterialId: 'C', quantity: 5 }]))
      .rejects.toThrow(/yield something/i);
  });

  it('terminates on a diamond instead of walking it twice', async () => {
    // A -> B and A -> C, both of which need D. A naive walk revisits D.
    const svc = build({ B: ['D'], C: ['D'], D: [] }, { ...NAMES, D: 'Water' });
    const res = await svc.setRecipe('t1', 'A', 500, [
      { rawMaterialId: 'B', quantity: 1 },
      { rawMaterialId: 'C', quantity: 1 },
    ]);
    expect(res.lines).toBe(2);
  });
});
