import { OrdersService } from './orders.service';

/**
 * Pausing ingredient deduction must not move the books.
 *
 * A shop rings sales for weeks before its recipe book is finished. With
 * recipes half-entered, deducting produces a stock picture that is wrong in
 * both directions — a few products drain, most do not. Tenant.
 * recipeDeductionPausedAt makes it uniformly "nothing deducted", so the whole
 * backlog can be replayed in one safe pass later.
 *
 * The trap this file exists to pin: lot-level costing and the pause cannot
 * both be honoured. FIFO/FEFO cost comes from draining lots, and a drain that
 * is never written is invisible to the NEXT order — so every sale in the
 * window would re-drain the same cheap layer and understate COGS for as long
 * as the pause lasted. Simulating the drain in memory only papers over a
 * single order; an earlier version of this feature did exactly that and
 * understated COGS by 76% across ten cups.
 *
 * So while paused, recipe costing falls back to the ingredient's running
 * average (RawMaterial.costPrice). Stable, no drift, explainable — and for the
 * common case (costing by Product.costPrice, i.e. Tenant.inventoryMode =
 * UNIT_BASED) COGS does not change at all, because recipe cost never reaches
 * those books. Lot layers are drained for real later by Recipe Catch-Up.
 */
describe('OrdersService — ingredient deduction pause', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const LATTE = 'p-latte';
  const BEANS = 'rm-beans';

  /** Two lots at different unit costs — FIFO must take the cheap one first. */
  const LOTS = [
    { id: 'lot-cheap', qtyRemaining: 20, unitCost: 1, expirationDate: null, receivedAt: new Date('2026-01-01') },
    { id: 'lot-dear',  qtyRemaining: 80, unitCost: 5, expirationDate: null, receivedAt: new Date('2026-02-01') },
  ];

  let invWrites: number;
  let lotWrites: number;
  let itemStamps: any[];

  function build(pausedAt: Date | null, itemCount = 1) {
    invWrites = 0;
    lotWrites = 0;
    itemStamps = [];
    const lotState = LOTS.map((l) => ({ ...l }));

    const tx: any = {
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn((args: any) => { itemStamps.push(args); return Promise.resolve({ count: 1 }); }),
      },
      bomItem: {
        findMany: jest.fn().mockResolvedValue([
          // 10g of beans per cup, lot-tracked so the FIFO/FEFO path runs.
          { productId: LATTE, rawMaterialId: BEANS, quantity: 10, rawMaterial: { costPrice: 99, lotsTracked: true } },
        ]),
      },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: {
        // Deductions are relative now, so a concurrent sale cannot be erased;
        // updateMany then floors any row the overselling pushed below zero.
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(where.rawMaterialId.in.map((id: string) => ({ rawMaterialId: id, quantity: 1000 }))),
        ),
        update: jest.fn(() => { invWrites++; return Promise.resolve({}); }),
      },
      // Stateful, so the live path really sees its own writes. Without this
      // the unpaused baseline would re-read full lots on every line and the
      // comparison against the paused path would be meaningless.
      rawMaterialLot: {
        findMany: jest.fn(() =>
          Promise.resolve(lotState.filter((l) => l.qtyRemaining > 0).map((l) => ({ ...l }))),
        ),
        update: jest.fn(({ where, data }: any) => {
          lotWrites++;
          const lot = lotState.find((l) => l.id === where.id);
          if (lot) lot.qtyRemaining = Number(data.qtyRemaining);
          return Promise.resolve({});
        }),
      },
      accountingEvent: { create: jest.fn() },
      orderPayment: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      orderDiscount: { createMany: jest.fn() },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      inventoryLog: { create: jest.fn() },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          inventoryMode: 'RECIPE_BASED',           // recipe costing ON, so COGS is observable
          recipeDeductionPausedAt: pausedAt,
          costingMethod: 'FIFO',
          taxStatus: 'VAT',
          planCode: 'CLERQUE',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: LATTE, name: 'Latte', inventoryMode: 'RECIPE_BASED', costPrice: 60 },
        ]),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const prisma: any = {
      // The order carries a shiftId now — a POS cash sale needs a drawer to
      // put the money in — so the ownership check runs.
      shift: { count: jest.fn().mockResolvedValue(1) },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'VAT', planCode: 'CLERQUE', isPtuHolder: false }),
        findUnique: jest.fn().mockResolvedValue({ taxStatus: 'VAT', planCode: 'CLERQUE' }),
      },
      branch: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      user: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
      modifierGroup: { count: jest.fn().mockResolvedValue(1) },
      modifierOption: { count: jest.fn().mockResolvedValue(1) },
      product: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(where?.isRxRequired ? [] : [{ id: LATTE, tenantId: TENANT, name: 'Latte', drugClass: null }]),
        ),
      },
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

    const items = Array.from({ length: itemCount }, () => ({
      productId: LATTE, productName: 'Latte', unitPrice: 139, quantity: 1,
      discountAmount: 0, vatAmount: 0, lineTotal: 139, isVatable: false,
      costPrice: 60, modifiers: [],
    }));

    const payload = {
      clientUuid: 'u-' + Math.random(),
      // A real till always has one: a POS cash sale needs a drawer to put the
      // money in, so cash without a shiftId is now refused.
      shiftId: 'shift-1',
      branchId: BRANCH,
      items,
      payments: [{ method: 'CASH', amount: 139 * itemCount }],
      discounts: [], subtotal: 139 * itemCount, discountAmount: 0, vatAmount: 0,
      totalAmount: 139 * itemCount,
      isPwdScDiscount: false, createdAt: new Date().toISOString(),
    };

    return { svc, tx, payload };
  }

  const cogsUnitCost = (tx: any) => {
    const call = (tx.accountingEvent.create as jest.Mock).mock.calls
      .find((c) => c[0]?.data?.type === 'COGS');
    return Number(call?.[0].data.payload.lines[0].unitCost);
  };
  const cogsMethod = (tx: any) => {
    const call = (tx.accountingEvent.create as jest.Mock).mock.calls
      .find((c) => c[0]?.data?.type === 'COGS');
    return call?.[0].data.payload.lines[0].costMethod;
  };

  it('deducts and stamps the order when running normally', async () => {
    const { svc, tx, payload } = build(null);
    await svc.create(TENANT, 'cashier-1', payload as never);

    expect(invWrites).toBe(1);
    expect(lotWrites).toBeGreaterThan(0);
    // The LINE records that its ingredients left the building.
    const stamp = itemStamps.find((u) => u.data?.ingredientsDeductedAt);
    expect(stamp).toBeDefined();
    expect(stamp.where.productId.in).toContain(LATTE);
  });

  it('writes no stock and leaves the order unstamped while paused', async () => {
    const { svc, payload } = build(new Date('2026-08-01T00:00:00.000Z'));
    await svc.create(TENANT, 'cashier-1', payload as never);

    expect(invWrites).toBe(0);
    expect(lotWrites).toBe(0);
    // No stamp — which is exactly what lets Recipe Catch-Up find these lines.
    expect(itemStamps.find((u) => u.data?.ingredientsDeductedAt)).toBeUndefined();
  });

  it('costs from lot layers when running normally', async () => {
    const live = build(null);
    await live.svc.create(TENANT, 'cashier-1', live.payload as never);

    // 10g drained from lot-cheap at ₱1/g = ₱10.
    expect(cogsUnitCost(live.tx)).toBeCloseTo(10, 6);
  });

  it('costs from the ingredient average while paused, and says so', async () => {
    const paused = build(new Date('2026-08-01T00:00:00.000Z'));
    await paused.svc.create(TENANT, 'cashier-1', paused.payload as never);

    // No lots are drained, so cost comes from RawMaterial.costPrice:
    // 10g x ₱99 = ₱990. Deliberately NOT the lot price — pricing off a layer
    // we did not drain is what produced the 76% understatement.
    expect(cogsUnitCost(paused.tx)).toBeCloseTo(990, 6);
    expect(cogsMethod(paused.tx)).toBe('RECIPE_WAC');
  });

  it('stays stable across orders while paused — no cheap-layer drift', async () => {
    // The regression that broke the first attempt: order 2 must cost exactly
    // what order 1 did. With lot layers untouched, the average is invariant.
    const first = build(new Date('2026-08-01T00:00:00.000Z'));
    await first.svc.create(TENANT, 'cashier-1', first.payload as never);

    const second = build(new Date('2026-08-01T00:00:00.000Z'));
    await second.svc.create(TENANT, 'cashier-1', second.payload as never);

    expect(cogsUnitCost(second.tx)).toBeCloseTo(cogsUnitCost(first.tx), 6);
  });

  it('leaves lot layers untouched while paused, for the catch-up to drain later', async () => {
    const paused = build(new Date('2026-08-01T00:00:00.000Z'), 3);
    await paused.svc.create(TENANT, 'cashier-1', paused.payload as never);

    expect(lotWrites).toBe(0);
  });
});
