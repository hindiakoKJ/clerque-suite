import { OrdersService } from './orders.service';

/**
 * A customer must hear "we're out" BEFORE they pay, not after.
 *
 * The till accepted six lattes with three lattes' worth of milk: there was no
 * server check, and `Math.max(before - consumeQty, 0)` floored the shortfall
 * silently. The sale went through, the drawer took the money, and three
 * customers were refused holding a paid receipt.
 *
 * The system even KNEW: it computed the shortfall further down and spent it on
 * COGS. `Tenant.allowSaleWhenOutOfStock` existed and was honoured on the
 * display side, so the tile greyed out — but the tile is only a picture.
 * Anything past it (quantity, a stale cache, the tablet app which drops the
 * flag entirely) was accepted.
 */
describe('OrdersService.create — refusing what the kitchen cannot make', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const LATTE = 'p-latte';
  const MILK = { id: 'rm-milk', name: 'Fresh Milk', unit: 'ml', costPrice: 0.09, lotsTracked: false };

  function build(opts: { milkStock: number; allowOversell?: boolean }) {
    const writes: any[] = [];
    const tx: any = {
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bomItem: {
        findMany: jest.fn().mockResolvedValue([
          { productId: LATTE, rawMaterialId: MILK.id, quantity: 150, rawMaterial: MILK },
        ]),
      },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([{ rawMaterialId: MILK.id, quantity: opts.milkStock }]),
        update: jest.fn((a: any) => { writes.push(a); return Promise.resolve({}); }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      accountingEvent: { create: jest.fn() },
      orderPayment: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      orderDiscount: { createMany: jest.fn() },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(), updateMany: jest.fn(),
      },
      inventoryLog: { create: jest.fn() },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          inventoryMode: 'RECIPE_BASED', costingMethod: 'WAC', taxStatus: 'VAT', planCode: 'CLERQUE',
          recipeDeductionPausedAt: null,
          allowSaleWhenOutOfStock: opts.allowOversell ?? false,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: LATTE, name: 'Latte', inventoryMode: 'RECIPE_BASED', costPrice: 40 },
        ]),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma: any = {
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
      productVariant: { count: jest.fn().mockResolvedValue(1) },
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
    return { svc, writes };
  }

  const payload = (qty: number) => ({
    clientUuid: 'ceil-' + qty + '-' + Math.random(),
    shiftId: 'shift-1',
    branchId: BRANCH,
    items: [{
      productId: LATTE, productName: 'Latte', unitPrice: 150, quantity: qty,
      discountAmount: 0, vatAmount: 0, lineTotal: 150 * qty, isVatable: false, modifiers: [],
    }],
    payments: [{ method: 'CASH', amount: 150 * qty }],
    discounts: [], subtotal: 150 * qty, discountAmount: 0, vatAmount: 0, totalAmount: 150 * qty,
    isPwdScDiscount: false, createdAt: new Date().toISOString(),
  });

  it('refuses six lattes when there is milk for three', async () => {
    const { svc } = build({ milkStock: 450 });   // 3 x 150 ml
    await expect(svc.create(TENANT, 'cashier-1', payload(6) as never))
      .rejects.toMatchObject({ response: { code: 'NOT_ENOUGH_INGREDIENTS' } });
  });

  it('names the ingredient and how many can actually be made', async () => {
    const { svc } = build({ milkStock: 450 });
    await expect(svc.create(TENANT, 'cashier-1', payload(6) as never))
      .rejects.toThrow(/Fresh Milk.*enough for 3/s);
  });

  it('says it before payment, in words a cashier can act on', async () => {
    const { svc } = build({ milkStock: 450 });
    await expect(svc.create(TENANT, 'cashier-1', payload(6) as never))
      .rejects.toThrow(/Change the order before taking payment/);
  });

  it('writes nothing at all when it refuses', async () => {
    // A half-committed sale is worse than a refused one.
    const { svc, writes } = build({ milkStock: 450 });
    await svc.create(TENANT, 'cashier-1', payload(6) as never).catch(() => undefined);
    expect(writes).toHaveLength(0);
  });

  it('allows exactly what the shelf supports', async () => {
    const { svc, writes } = build({ milkStock: 450 });
    await svc.create(TENANT, 'cashier-1', payload(3) as never);
    expect(writes.length).toBeGreaterThan(0);
  });

  it('lets a shop that wants to oversell carry on', async () => {
    // A kitchen that trusts its cooks over its stock file sets the flag and
    // gets the old behaviour back.
    const { svc, writes } = build({ milkStock: 450, allowOversell: true });
    await svc.create(TENANT, 'cashier-1', payload(6) as never);
    expect(writes.length).toBeGreaterThan(0);
  });

  it('never refuses a sale that already happened offline', async () => {
    /*
      A synced offline order is a record of something that occurred: the drink
      is in the customer's hand. Refusing it would lose a real sale rather than
      prevent one, and would leave the books short of a sale the till took.
    */
    const { svc, writes } = build({ milkStock: 450 });
    await svc.create(TENANT, 'cashier-1', payload(6) as never, { skipStockCeiling: true } as never);
    expect(writes.length).toBeGreaterThan(0);
  });

  it('leaves an ecosystem caller alone', async () => {
    // An API order is recording something that happened elsewhere.
    const { svc, writes } = build({ milkStock: 450 });
    await svc.create(TENANT, null, payload(6) as never, {
      channel: 'API', createdByApiKeyId: 'k1',
    } as never).catch(() => undefined);
    expect(writes.length).toBeGreaterThan(0);
  });
});
