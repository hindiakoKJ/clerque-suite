import { OrdersService } from './orders.service';

/**
 * A Large is not a Regular with a bigger price.
 *
 * `VariantBomItem` has existed since sizes were introduced and had a write
 * endpoint, and nothing on the consumption side ever read it — the sale walk
 * queried `bomItem` alone. So a shop that models sizes as variants sold the
 * Large at Large money while deducting Regular ingredients and posting Regular
 * COGS. The margin on the Large looked wonderful, no error was ever raised,
 * and the shortfall only showed up at a stock count.
 *
 * A variant recipe REPLACES the product's rather than adding to it: it is the
 * whole recipe for that size, not a supplement.
 */
describe('OrdersService.create — variant recipes', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const PRODUCT = 'p-latte';
  const LARGE = 'v-large';
  const MILK = { id: 'rm-milk', costPrice: 0.09, lotsTracked: false };

  let consumed: Record<string, number>;

  function build(variantLines: Array<{ variantId: string; quantity: number }>) {
    consumed = {};
    const stock: Record<string, number> = { 'rm-milk': 100000 };

    const tx: any = {
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // The base product says 150 ml per cup.
      bomItem: {
        findMany: jest.fn().mockResolvedValue([
          { productId: PRODUCT, rawMaterialId: MILK.id, quantity: 150, rawMaterial: MILK },
        ]),
      },
      // The Large says 250. This table was never read before.
      variantBomItem: {
        findMany: jest.fn().mockResolvedValue(
          variantLines.map((v) => ({
            variantId: v.variantId, rawMaterialId: MILK.id,
            quantity: v.quantity, rawMaterial: MILK,
          })),
        ),
      },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            where.rawMaterialId.in.map((id: string) => ({ rawMaterialId: id, quantity: stock[id] ?? 0 })),
          ),
        ),
        update: jest.fn(({ where, data }: any) => {
          consumed[where.branchId_rawMaterialId.rawMaterialId] =
            Number(data.quantity?.decrement ?? 0);
          return Promise.resolve({});
        }),
      },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      accountingEvent: { create: jest.fn() },
      orderPayment: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      orderDiscount: { createMany: jest.fn() },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(), updateMany: jest.fn(),
      },
      inventoryLog: { create: jest.fn() },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          inventoryMode: 'RECIPE_BASED', costingMethod: 'WAC', taxStatus: 'VAT', planCode: 'CLERQUE',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: PRODUCT, name: 'Latte', inventoryMode: 'RECIPE_BASED', costPrice: 60 },
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
      // Variant ownership is checked through the product's tenant.
      productVariant: { count: jest.fn().mockResolvedValue(1) },
      product: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(where?.isRxRequired ? [] : [{ id: PRODUCT, tenantId: TENANT, name: 'Latte', drugClass: null }]),
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
    return { svc, tx };
  }

  const payload = (variantId?: string) => ({
    clientUuid: 'u-variant-' + (variantId ?? 'none') + '-' + variantId,
    shiftId: 'shift-1',
    branchId: BRANCH,
    items: [{
      productId: PRODUCT, variantId, productName: 'Latte', unitPrice: 180, quantity: 1,
      discountAmount: 0, vatAmount: 0, lineTotal: 180, isVatable: false,
      costPrice: 60, modifiers: [],
    }],
    payments: [{ method: 'CASH', amount: 180 }],
    discounts: [], subtotal: 180, discountAmount: 0, vatAmount: 0, totalAmount: 180,
    isPwdScDiscount: false, createdAt: new Date().toISOString(),
  });

  const cogsOf = (tx: any) => {
    const call = (tx.accountingEvent.create as jest.Mock).mock.calls
      .find((c) => c[0]?.data?.type === 'COGS');
    return call?.[0].data.payload.lines[0];
  };

  it('pours the LARGE recipe when the line is a Large', async () => {
    const { svc } = build([{ variantId: LARGE, quantity: 250 }]);
    await svc.create(TENANT, 'cashier-1', payload(LARGE) as never);
    expect(consumed[MILK.id]).toBe(250);
  });

  it('replaces the base recipe rather than adding to it', async () => {
    // 250, not 400. A variant recipe is the whole recipe for that size.
    const { svc } = build([{ variantId: LARGE, quantity: 250 }]);
    await svc.create(TENANT, 'cashier-1', payload(LARGE) as never);
    expect(consumed[MILK.id]).not.toBe(400);
  });

  it('costs the Large on what the Large actually poured', async () => {
    const { svc, tx } = build([{ variantId: LARGE, quantity: 250 }]);
    await svc.create(TENANT, 'cashier-1', payload(LARGE) as never);
    expect(Number(cogsOf(tx).unitCost)).toBeCloseTo(250 * MILK.costPrice, 4);
  });

  it('falls back to the product recipe when the variant has none', async () => {
    // Every product today, which is why this changes nothing for them.
    const { svc } = build([]);
    await svc.create(TENANT, 'cashier-1', payload(LARGE) as never);
    expect(consumed[MILK.id]).toBe(150);
  });

  it('uses the product recipe for a line with no variant at all', async () => {
    const { svc } = build([{ variantId: LARGE, quantity: 250 }]);
    await svc.create(TENANT, 'cashier-1', payload(undefined) as never);
    expect(consumed[MILK.id]).toBe(150);
  });

  it('does not go looking for variant recipes when no line has one', async () => {
    const { svc, tx } = build([]);
    await svc.create(TENANT, 'cashier-1', payload(undefined) as never);
    expect(tx.variantBomItem.findMany).not.toHaveBeenCalled();
  });
});
