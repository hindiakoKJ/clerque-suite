import { OrdersService } from './orders.service';

/**
 * Recipe INVENTORY and recipe COSTING are separate switches.
 *
 * Both used to key off "does this product have a BOM", which forced an
 * all-or-nothing choice: a shop that had entered its recipes but not yet
 * priced its ingredients silently posted ₱0 COGS, because the recipe cost
 * outranks Product.costPrice. Toggling the product back to UNIT_BASED did
 * not help — the flag was never read at sale time.
 *
 * Now:
 *   • Ingredients are ALWAYS deducted when a recipe exists, so ingredient
 *     stock works from day one with everything uncosted.
 *   • Costing follows Tenant.inventoryMode, and a product marked
 *     RECIPE_BASED overrides it — letting a shop run product-based costing
 *     today and move products over as their real ingredient costs land.
 */
describe('OrdersService — costing mode vs inventory deduction', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const PRODUCT = 'p-latte';
  const FLAT_COST = 60;

  const MILK = { id: 'rm-milk', costPrice: 0, lotsTracked: false }; // uncosted on purpose

  let consumed: Record<string, number>;

  function build(houseMode: string, productMode: string) {
    consumed = {};
    const stock: Record<string, number> = { 'rm-milk': 1000 };

    const tx: any = {
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      // Recipe exists: 150ml milk per cup.
      bomItem: {
        findMany: jest.fn().mockResolvedValue([
          { rawMaterialId: MILK.id, quantity: 150, rawMaterial: MILK },
        ]),
      },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve({ quantity: stock[where.branchId_rawMaterialId.rawMaterialId] ?? 0 }),
        ),
        update: jest.fn(({ where, data }: any) => {
          const id = where.branchId_rawMaterialId.rawMaterialId;
          consumed[id] = (stock[id] ?? 0) - Number(data.quantity);
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
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      inventoryLog: { create: jest.fn() },
      tenant: {
        // The house switch the sale reads.
        findUnique: jest.fn().mockResolvedValue({
          inventoryMode: houseMode, costingMethod: 'WAC', taxStatus: 'VAT', planCode: 'CLERQUE',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: PRODUCT, name: 'Latte', inventoryMode: productMode, costPrice: FLAT_COST },
        ]),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const prisma: any = {
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

  const payload = () => ({
    clientUuid: 'u-' + Math.random(),
    branchId: BRANCH,
    items: [{
      productId: PRODUCT, productName: 'Latte', unitPrice: 139, quantity: 1,
      discountAmount: 0, vatAmount: 0, lineTotal: 139, isVatable: false,
      costPrice: FLAT_COST, modifiers: [],
    }],
    payments: [{ method: 'CASH', amount: 139 }],
    discounts: [], subtotal: 139, discountAmount: 0, vatAmount: 0, totalAmount: 139,
    isPwdScDiscount: false, createdAt: new Date().toISOString(),
  });

  const cogsOf = (tx: any) => {
    const call = (tx.accountingEvent.create as jest.Mock).mock.calls
      .find((c) => c[0]?.data?.type === 'COGS');
    return call?.[0].data.payload.lines[0];
  };

  it('deducts ingredients even when costing is product-based', async () => {
    const { svc, tx } = build('UNIT_BASED', 'UNIT_BASED');
    await svc.create(TENANT, 'cashier-1', payload() as never);

    // Inventory management never pauses — this is the whole point.
    expect(consumed[MILK.id]).toBe(150);
    // ...and the shop's own cost price is what reaches the books.
    expect(Number(cogsOf(tx).unitCost)).toBe(FLAT_COST);
  });

  it('uses the recipe when a product is marked recipe-based', async () => {
    const { svc, tx } = build('UNIT_BASED', 'RECIPE_BASED');
    await svc.create(TENANT, 'cashier-1', payload() as never);

    expect(consumed[MILK.id]).toBe(150);
    // Ingredients are uncosted, so recipe costing legitimately yields 0 —
    // which is exactly why it must not be forced on a shop that has not
    // priced its ingredients yet.
    expect(Number(cogsOf(tx).unitCost)).toBe(0);
    expect(cogsOf(tx).costMethod).toBe('RECIPE_WAC');
  });

  it('switches the whole shop over when the house toggle is recipe-based', async () => {
    const { svc, tx } = build('RECIPE_BASED', 'UNIT_BASED');
    await svc.create(TENANT, 'cashier-1', payload() as never);

    expect(consumed[MILK.id]).toBe(150);
    expect(cogsOf(tx).costMethod).toBe('RECIPE_WAC');
  });

  it('costs from the recipe once ingredients are actually priced', async () => {
    MILK.costPrice = 0.085;              // the shop fills in its milk cost
    try {
      const { svc, tx } = build('UNIT_BASED', 'RECIPE_BASED');
      await svc.create(TENANT, 'cashier-1', payload() as never);
      // 150ml x ₱0.085 = ₱12.75 — real cost, no re-import needed.
      expect(Number(cogsOf(tx).unitCost)).toBeCloseTo(12.75, 2);
    } finally {
      MILK.costPrice = 0;
    }
  });
});
