import { OrdersService } from './orders.service';

/**
 * Ingredient SUBSTITUTION at the till.
 *
 * A coffee shop's "Oat milk" option does not ADD oat milk to a latte — it
 * replaces the dairy the base recipe calls for. The dairy is never poured, so
 * it must never be deducted from stock and never appear in COGS.
 *
 * A substitution is expressed as two modifier lines on the option: a negative
 * amount cancelling the base ingredient, and a positive amount for what is
 * actually used. Base and modifier lines are netted per ingredient and floored
 * at zero before anything is deducted or costed.
 */
describe('OrdersService — ingredient substitution', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const PRODUCT = 'p-latte';

  const DAIRY = { id: 'rm-dairy', costPrice: 0.085, lotsTracked: false }; // ₱0.085/ml
  const OAT   = { id: 'rm-oat',   costPrice: 0.180, lotsTracked: false }; // ₱0.18/ml
  const BEANS = { id: 'rm-beans', costPrice: 0.650, lotsTracked: false }; // ₱0.65/g

  /** Records what each raw material was actually asked to give up. */
  let consumed: Record<string, number>;

  function buildPrisma(modifierIngredients: Array<{ rawMaterialId: string; quantity: number; rm: typeof DAIRY }>) {
    consumed = {};
    const stock: Record<string, number> = { 'rm-dairy': 5000, 'rm-oat': 5000, 'rm-beans': 5000 };

    const tx = {
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([]),
        // Per-line deduction marker stamped after the BOM walk.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // Base recipe: 18g beans + 200ml dairy.
      bomItem: {
        // Fetched once for ALL products now — rows carry productId so the
        // service can group them per line.
        findMany: jest.fn().mockResolvedValue([
          { productId: PRODUCT, rawMaterialId: BEANS.id, quantity: 18,  rawMaterial: BEANS },
          { productId: PRODUCT, rawMaterialId: DAIRY.id, quantity: 200, rawMaterial: DAIRY },
        ]),
      },
      modifierOption: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'opt-oat',
            recipeMultiplier: 1,
            ingredients: modifierIngredients.map((m) => ({
              rawMaterialId: m.rawMaterialId,
              quantity: m.quantity,
              rawMaterial: m.rm,
            })),
          },
        ]),
      },
      rawMaterialInventory: {
        // Deductions are relative now, so a concurrent sale cannot be erased;
        // updateMany then floors any row the overselling pushed below zero.
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        // One batched read for every ingredient the order could touch.
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            where.rawMaterialId.in.map((id: string) => ({ rawMaterialId: id, quantity: stock[id] ?? 0 })),
          ),
        ),
        update: jest.fn(({ where, data }: any) => {
          const id = where.branchId_rawMaterialId.rawMaterialId;
          // The write is RELATIVE now — { quantity: { decrement } } — so a
          // concurrent sale on the other till cannot be erased by an
          // absolute figure computed from a stale snapshot.
          consumed[id] = Number(data.quantity?.decrement ?? 0);
          return Promise.resolve({});
        }),
      },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      accountingEvent: { create: jest.fn() },
      orderPayment: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      orderDiscount: { createMany: jest.fn() },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst:  jest.fn().mockResolvedValue(null),
        update:     jest.fn(),
        updateMany: jest.fn(),
      },
      inventoryLog: { create: jest.fn() },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          costingMethod: 'WAC', taxStatus: 'VAT', planCode: 'CLERQUE',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update:     jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      shift: { count: jest.fn().mockResolvedValue(1) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: PRODUCT, name: 'Latte', inventoryMode: 'RECIPE_BASED', costPrice: 0 },
        ]),
      },
    };

    return {
      tx,
      prisma: {
        order:  { findFirst: jest.fn().mockResolvedValue(null) },
        // The order carries a shiftId now — a POS cash sale needs a drawer to
        // put the money in — so the ownership check runs.
        shift:  { count: jest.fn().mockResolvedValue(1) },
        tenant: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'VAT', planCode: 'CLERQUE', isPtuHolder: false }),
          findUnique: jest.fn().mockResolvedValue({ taxStatus: 'VAT', planCode: 'CLERQUE' }),
        },
        branch: {
          count:     jest.fn().mockResolvedValue(1),
          findFirst: jest.fn().mockResolvedValue({ id: BRANCH }),
        },
        user:   { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
        // The till validates that every modifier group/option in the payload
        // belongs to this tenant before consuming anything.
        modifierGroup:  { count: jest.fn().mockResolvedValue(1) },
        modifierOption: { count: jest.fn().mockResolvedValue(1) },
        product: {
          // The same findMany serves two callers: the tenant-ownership check
          // and the Rx-attestation lookup, which filters isRxRequired. Honour
          // that filter so a coffee drink is not treated as a controlled drug.
          findMany: jest.fn(({ where }: any) =>
            Promise.resolve(
              where?.isRxRequired ? [] : [{ id: PRODUCT, tenantId: TENANT, name: 'Latte', drugClass: null }],
            ),
          ),
        },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      },
    };
  }

  function makeService(prisma: any) {
    return new OrdersService(
      prisma,
      { assertDateIsOpen: jest.fn() } as any,
      { assertVatConsistency: jest.fn() } as any,
      { log: jest.fn(), logVoid: jest.fn() } as any,
      { next: jest.fn().mockResolvedValue('ORD-1') } as any,
      { accrue: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  }

  const payload = () => ({
    clientUuid: 'u-' + Math.random(),
    // A real till always has one: a POS cash sale needs a drawer to put the
    // money in, so cash without a shiftId is now refused.
    shiftId: 'shift-1',
    branchId: BRANCH,
    items: [{
      productId: PRODUCT,
      productName: 'Latte',
      unitPrice: 150,
      quantity: 1,
      discountAmount: 0,
      vatAmount: 16.07,
      lineTotal: 150,
      isVatable: true,
      costPrice: 0,
      modifiers: [{ modifierGroupId: 'g-milk', modifierOptionId: 'opt-oat', optionName: 'Oat milk', priceAdjustment: 30 }],
    }],
    payments: [{ method: 'CASH', amount: 150 }],
    discounts: [],
    subtotal: 133.93,
    discountAmount: 0,
    vatAmount: 16.07,
    totalAmount: 150,
    isPwdScDiscount: false,
    createdAt: new Date().toISOString(),
  });

  it('pours oat milk and NO dairy when the option replaces it', async () => {
    // "Oat milk" = cancel the 200ml dairy, add 200ml oat.
    const { prisma } = buildPrisma([
      { rawMaterialId: DAIRY.id, quantity: -200, rm: DAIRY },
      { rawMaterialId: OAT.id,   quantity:  200, rm: OAT },
    ]);
    await makeService(prisma).create(TENANT, 'cashier-1', payload() as never);

    expect(consumed[OAT.id]).toBe(200);
    // The dairy is never poured — so it is never deducted.
    expect(consumed[DAIRY.id] ?? 0).toBe(0);
    // The rest of the recipe is untouched.
    expect(consumed[BEANS.id]).toBe(18);
  });

  it('never credits stock back when a substitution over-cancels', async () => {
    // -500ml against a 200ml base: settles at "none used", not +300ml.
    const { prisma } = buildPrisma([
      { rawMaterialId: DAIRY.id, quantity: -500, rm: DAIRY },
      { rawMaterialId: OAT.id,   quantity:  200, rm: OAT },
    ]);
    await makeService(prisma).create(TENANT, 'cashier-1', payload() as never);

    expect(consumed[DAIRY.id] ?? 0).toBe(0);
    expect(consumed[DAIRY.id] ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('still ADDS when the modifier is an extra, not a replacement', async () => {
    // "Extra shot" = +5g beans on top of the base 18g.
    const { prisma } = buildPrisma([
      { rawMaterialId: BEANS.id, quantity: 5, rm: BEANS },
    ]);
    await makeService(prisma).create(TENANT, 'cashier-1', payload() as never);

    expect(consumed[BEANS.id]).toBe(23);
    expect(consumed[DAIRY.id]).toBe(200);
  });

  it('costs the drink on what was actually poured', async () => {
    const { prisma, tx } = buildPrisma([
      { rawMaterialId: DAIRY.id, quantity: -200, rm: DAIRY },
      { rawMaterialId: OAT.id,   quantity:  200, rm: OAT },
    ]);
    await makeService(prisma).create(TENANT, 'cashier-1', payload() as never);

    const cogsCall = (tx.accountingEvent.create as jest.Mock).mock.calls
      .find((c) => c[0]?.data?.type === 'COGS');
    expect(cogsCall).toBeDefined();

    const line = cogsCall[0].data.payload.lines[0];
    // 18g beans @0.65 = 11.70, 200ml oat @0.18 = 36.00 -> 47.70.
    // Dairy would have been 17.00: charging both milks would give 64.70.
    expect(Number(line.unitCost)).toBeCloseTo(47.70, 2);
  });
});
