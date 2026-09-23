import { OrdersService } from './orders.service';

/**
 * Owner's rule, at the till: a recipe item waiting at a kitchen or bar screen
 * is rung up (revenue, payment) but takes its ingredients and cost only when
 * it is marked ready. At the sale such a line is marked to wait, stays out of
 * the stock write and the cost-of-goods entry, and still counts against what
 * can be made -- together with what other waiting tickets already hold.
 */
describe('OrdersService.create — lines that wait for the ready tap', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const LATTE = 'p-latte';
  const WATER = 'p-water';
  const MILK = { id: 'rm-milk', name: 'Milk', unit: 'ml', costPrice: 0.1, lotsTracked: false };
  const SCREEN = { stationId: 's-bar', revenueAccountCode: null, station: { hasKds: true, isActive: true } };

  afterEach(() => { delete process.env.USAGE_ON_READY; });

  function build(opts: {
    routed?: boolean; paused?: boolean; milk?: number; heldLines?: any[]; allowOos?: boolean;
    latteMode?: 'RECIPE_BASED' | 'UNIT_BASED'; latteShelfRow?: boolean;
  } = {}) {
    const flushed: Record<string, number> = {};
    const tx: any = {
      order: {
        create: jest.fn().mockResolvedValue({
          id: 'o-1', orderNumber: 'ORD-1',
          items: [
            { id: 'li-latte', productId: LATTE, variantId: null, modifiers: [] },
            { id: 'li-water', productId: WATER, variantId: null, modifiers: [] },
          ],
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      orderItem: {
        // The hold: other tickets still waiting at a screen at this branch.
        findMany: jest.fn().mockResolvedValue(opts.heldLines ?? []),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      bomItem: { findMany: jest.fn().mockResolvedValue([{ productId: LATTE, rawMaterialId: MILK.id, quantity: 200, rawMaterial: MILK }]) },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([{ rawMaterialId: MILK.id, quantity: opts.milk ?? 10000 }]),
        update: jest.fn(({ where, data }: any) => { flushed[where.branchId_rawMaterialId.rawMaterialId] = Number(data.quantity.decrement); return Promise.resolve({}); }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      accountingEvent: { create: jest.fn() },
      inventoryItem: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve(
          where.productId === WATER ? { id: 'inv-w', quantity: 50, avgCost: 12 }
            : opts.latteShelfRow ? { id: 'inv-l', quantity: 0, avgCost: null } : null,
        )),
        update: jest.fn(), updateMany: jest.fn(),
      },
      inventoryLog: { create: jest.fn() },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          inventoryMode: 'RECIPE_BASED', valuationMethod: 'WAC', taxStatus: 'VAT', planCode: 'CLERQUE',
          recipeDeductionPausedAt: opts.paused ? new Date() : null, allowSaleWhenOutOfStock: !!opts.allowOos,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: LATTE, inventoryMode: opts.latteMode ?? 'RECIPE_BASED', category: opts.routed === false ? null : SCREEN },
          { id: WATER, inventoryMode: 'UNIT_BASED', category: null },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma: any = {
      shift: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ cashierId: null, closedAt: null }) },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'VAT', planCode: 'CLERQUE', isPtuHolder: false }),
        findUnique: jest.fn().mockResolvedValue({ taxStatus: 'VAT', planCode: 'CLERQUE' }),
      },
      branch: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      user: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn(({ where }: any) => Promise.resolve(where?.isRxRequired ? [] : [{ id: LATTE, tenantId: TENANT }, { id: WATER, tenantId: TENANT }])) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const svc = new OrdersService(
      prisma,
      { assertDateIsOpen: jest.fn() } as any,
      { assertVatConsistency: jest.fn() } as any,
      { log: jest.fn(), logVoid: jest.fn() } as any,
      { next: jest.fn().mockResolvedValue('ORD-1') } as any,
      { accrue: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    return { svc, tx, flushed };
  }

  const payload = (lattes = 1) => ({
    clientUuid: `u-${Math.random()}`, shiftId: 'shift-1', branchId: BRANCH,
    items: [
      { productId: LATTE, productName: 'Latte', unitPrice: 150, quantity: lattes, discountAmount: 0, vatAmount: 0, lineTotal: 150 * lattes, isVatable: false, costPrice: 40, modifiers: [] },
      { productId: WATER, productName: 'Water', unitPrice: 30, quantity: 1, discountAmount: 0, vatAmount: 0, lineTotal: 30, isVatable: false, costPrice: 12, modifiers: [] },
    ],
    payments: [{ method: 'CASH', amount: 150 * lattes + 30 }],
    discounts: [], subtotal: 150 * lattes + 30, discountAmount: 0, vatAmount: 0, totalAmount: 150 * lattes + 30,
    isPwdScDiscount: false, createdAt: new Date().toISOString(),
  });

  const marked = (tx: any) => tx.orderItem.updateMany.mock.calls.find((c: any[]) => c[0].data.usageOnReady === true)?.[0];
  const cogs = (tx: any) => tx.accountingEvent.create.mock.calls.find((c: any[]) => c[0].data.type === 'COGS')?.[0].data.payload;

  it('a live till sale marks the screen line to wait: no milk off the shelf, no cost booked for it; the counter item is used now', async () => {
    const { svc, tx, flushed } = build();
    await svc.create(TENANT, 'cashier', payload() as never);
    expect(marked(tx)).toEqual({ where: { id: { in: ['li-latte'] } }, data: { usageOnReady: true } });
    expect(flushed['rm-milk']).toBeUndefined();
    expect(cogs(tx).lines.map((l: any) => l.productId)).toEqual([WATER]);
    // Not stamped as deducted, so Recipe Catch-Up does not treat it as a backlog either.
    const stamp = tx.orderItem.updateMany.mock.calls.find((c: any[]) => c[0].data.ingredientsDeductedAt);
    expect(stamp).toBeUndefined();
    // Revenue is at the sale regardless.
    expect(tx.accountingEvent.create.mock.calls.find((c: any[]) => c[0].data.type === 'SALE')[0].data.payload.lines).toHaveLength(2);
  });

  it('an offline replay, a machine caller, a paused shop, a switched-off rule, or no screen: used at the sale as before', async () => {
    const cases: Array<[string, () => ReturnType<typeof build>, any]> = [
      ['offline replay', () => build(), { replayedOffline: true, skipStockCeiling: true }],
      ['machine caller', () => build(), { channel: 'API' }],
      ['no screen', () => build({ routed: false }), {}],
    ];
    for (const [name, make, opts] of cases) {
      const { svc, tx, flushed } = make();
      await svc.create(TENANT, 'cashier', payload() as never, opts);
      expect([name, marked(tx)]).toEqual([name, undefined]);
      expect([name, flushed['rm-milk']]).toEqual([name, 200]);
      expect([name, cogs(tx).lines.map((l: any) => l.productId).sort()]).toEqual([name, [LATTE, WATER]]);
    }

    process.env.USAGE_ON_READY = 'off';
    const off = build();
    await off.svc.create(TENANT, 'cashier', payload() as never);
    expect(marked(off.tx)).toBeUndefined();
    expect(off.flushed['rm-milk']).toBe(200);
    delete process.env.USAGE_ON_READY;

    const paused = build({ paused: true });
    await paused.svc.create(TENANT, 'cashier', payload() as never);
    expect(marked(paused.tx)).toBeUndefined();
  });

  it('only ingredients wait: a product that also keeps a shelf row is used at the sale, unless it is costed from its recipe', async () => {
    // Unit-based with a shelf row (even at zero): a void would put a unit back, so the sale must book it.
    const shelf = build({ latteMode: 'UNIT_BASED', latteShelfRow: true });
    await shelf.svc.create(TENANT, 'cashier', payload() as never);
    expect(marked(shelf.tx)).toBeUndefined();
    expect(shelf.flushed['rm-milk']).toBe(200);
    expect(cogs(shelf.tx).lines.map((l: any) => l.productId).sort()).toEqual([LATTE, WATER]);

    // Recipe-costed with a stray shelf row: never put back on a shelf, so it still waits.
    const recipe = build({ latteMode: 'RECIPE_BASED', latteShelfRow: true });
    await recipe.svc.create(TENANT, 'cashier', payload() as never);
    expect(marked(recipe.tx)).toEqual({ where: { id: { in: ['li-latte'] } }, data: { usageOnReady: true } });

    // Unit-based with no shelf row: nothing could be put back, so it waits.
    const noShelf = build({ latteMode: 'UNIT_BASED' });
    await noShelf.svc.create(TENANT, 'cashier', payload() as never);
    expect(marked(noShelf.tx)).toEqual({ where: { id: { in: ['li-latte'] } }, data: { usageOnReady: true } });
  });

  it('what other waiting tickets hold is not there to sell: refused, saying how much is held', async () => {
    // 500 ml on the shelf, two waiting lattes elsewhere hold 400: one more latte (200) cannot be made.
    const heldLines = [{ productId: LATTE, variantId: null, quantity: 2, refundedQty: 0, modifiers: [], order: { branchId: BRANCH } }];
    const { svc } = build({ milk: 500, heldLines });
    await expect(svc.create(TENANT, 'cashier', payload() as never)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_ENOUGH_INGREDIENTS', message: expect.stringMatching(/100 ml left after 400 ml for tickets still being made/) }),
    });
  });

  it('two lattes on one order both count against the shelf, though neither takes it yet', async () => {
    const { svc } = build({ milk: 300 });
    await expect(svc.create(TENANT, 'cashier', payload(2) as never)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_ENOUGH_INGREDIENTS' }),
    });
    const enough = build({ milk: 400 });
    await expect(enough.svc.create(TENANT, 'cashier', payload(2) as never)).resolves.toBeDefined();
  });

  it('the hold is read without this order\'s own lines', async () => {
    const { svc, tx } = build();
    await svc.create(TENANT, 'cashier', payload() as never);
    const heldQuery = tx.orderItem.findMany.mock.calls.find((c: any[]) => c[0]?.where?.usageOnReady === true)?.[0];
    expect(heldQuery.where.order).toMatchObject({ branchId: { in: [BRANCH] }, id: { not: 'o-1' } });
  });

  it('never copies a pharmacist\'s attest PIN into the books', async () => {
    const { svc, tx } = build({ routed: false });
    const p: any = payload();
    p.items[1].attestPin = '1234';
    await svc.create(TENANT, 'cashier', p as never);
    const sale = tx.accountingEvent.create.mock.calls.find((c: any[]) => c[0].data.type === 'SALE')[0].data.payload;
    expect(JSON.stringify(sale)).not.toContain('1234');
  });
});
