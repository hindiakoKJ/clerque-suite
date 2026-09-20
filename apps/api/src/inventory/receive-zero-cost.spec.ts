import { InventoryService } from './inventory.service';

/**
 * Receiving a delivery when one side has no price.
 *
 * `blendCost` decides the arithmetic (see zero-cost-blend.spec.ts). These
 * tests run it through the real receive, because that is where it has to hold:
 * what gets written to RawMaterial.costPrice, and whether the stock account is
 * still worth what the shelf is worth afterwards.
 *
 * Carolina's shop loaded opening stock for six condiments at ₱0. Averaged in,
 * the first real delivery of soy sauce would have priced it at a sixth of what
 * it cost, and every plate with soy sauce in it with it.
 */
describe('Receiving stock that had no price, and deliveries that name none', () => {
  const TENANT = 't1';
  const MAIN   = 'branch-main';
  const SOY    = 'rm-soy';

  function build(onHand: Array<{ branchId: string; quantity: number }>, costPrice: number) {
    const written: number[] = [];
    const events: any[] = [];
    const tx: any = {
      rawMaterialInventory: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(
          onHand.find((r) => r.branchId === where.branchId_rawMaterialId.branchId) ?? null,
        )),
        findMany: jest.fn(() => Promise.resolve(onHand.map((r) => ({ ...r })))),
        upsert:   jest.fn().mockResolvedValue({}),
      },
      rawMaterial: {
        update:   jest.fn(({ data }: any) => { written.push(Number(data.costPrice)); return Promise.resolve({}); }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'lot1' }) },
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
      accountingEvent: { create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }) },
      aPBill: { create: jest.fn().mockResolvedValue({}) },
      vendor: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma: any = {
      branch: { findFirst: jest.fn(({ where }: any) => Promise.resolve({ id: where.id })) },
      rawMaterial: { findFirst: jest.fn().mockResolvedValue({ id: SOY, tenantId: TENANT, name: 'Soy sauce', unit: 'g', category: 'INGREDIENT', costPrice, lowStockAlert: null }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', inventoryValuation: 'WAC', businessType: 'FOOD_BEVERAGE' }) },
      rawMaterialInventory: { findUnique: tx.rawMaterialInventory.findUnique },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    return { svc: new InventoryService(prisma, periods) as any, written, events };
  }

  /** The opening-stock entry queued for stock that had been carried at nothing. */
  const valuing = (events: any[]) =>
    events.filter((e) => e.payload?.reasonCode === 'OPENING_BALANCE');

  it('does not let stock loaded at ₱0 drag the first real price down', async () => {
    // 5,000 g of soy sauce loaded at ₱0, then 1,000 g delivered at ₱0.06.
    const { svc, written } = build([{ branchId: MAIN, quantity: 5_000 }], 0);
    await svc.receiveRawMaterial(TENANT, SOY, {
      branchId: MAIN, quantity: 1_000, costPrice: 0.06,
      paymentMethod: 'CASH', referenceNumber: 'DR-SOY-1',
    });

    expect(written).toEqual([0.06]);
    // The old arithmetic: (5000 x 0 + 1000 x 0.06) / 6000 = ₱0.01 a gram.
    expect(written[0]).not.toBeCloseTo(0.01, 4);
  });

  it('books the stock it just gave a price to, so 1051 still matches the shelf', async () => {
    const { svc, events } = build([{ branchId: MAIN, quantity: 5_000 }], 0);
    await svc.receiveRawMaterial(TENANT, SOY, {
      branchId: MAIN, quantity: 1_000, costPrice: 0.06,
      paymentMethod: 'CASH', referenceNumber: 'DR-SOY-1',
    });

    // Shelf after: 6,000 g x ₱0.06 = ₱360. The delivery itself books ₱60, so
    // the 5,000 g that were carried at nothing must book the other ₱300.
    const opening = valuing(events);
    expect(opening).toHaveLength(1);
    expect(opening[0].payload.quantity).toBe(5_000);
    expect(opening[0].payload.totalValue).toBe(300);
    expect(opening[0].payload.rawMaterialId).toBe(SOY);
  });

  it('keeps the price on file when the delivery itself names none', async () => {
    // A barista records ice that came with the COD order and leaves the cost
    // blank. Averaged in, it would halve the price of every gram on the shelf.
    const { svc, written, events } = build([{ branchId: MAIN, quantity: 1_000 }], 0.40);
    await svc.receiveRawMaterial(TENANT, SOY, {
      branchId: MAIN, quantity: 1_000, costPrice: 0,
      paymentMethod: 'OWNER_FUNDED', referenceNumber: 'DR-SOY-2',
    });

    expect(written).toEqual([]);                      // nothing overwritten
    const opening = valuing(events);
    expect(opening).toHaveLength(1);
    expect(opening[0].payload.quantity).toBe(1_000);  // the delivery, at the price on file
    expect(opening[0].payload.totalValue).toBe(400);
  });

  it('still warns when there is no price anywhere to use', async () => {
    const { svc, written, events } = build([{ branchId: MAIN, quantity: 1_000 }], 0);
    const res = await svc.receiveRawMaterial(TENANT, SOY, {
      branchId: MAIN, quantity: 1_000, costPrice: 0,
      paymentMethod: 'OWNER_FUNDED', referenceNumber: 'DR-SOY-3',
    });

    expect(written).toEqual([]);
    expect(valuing(events)).toEqual([]);
    expect(res.warning).toBeTruthy();
  });

  it('leaves an ordinary priced delivery exactly as it was', async () => {
    const { svc, written, events } = build([{ branchId: MAIN, quantity: 1_000 }], 0.10);
    await svc.receiveRawMaterial(TENANT, SOY, {
      branchId: MAIN, quantity: 1_000, costPrice: 0.20,
      paymentMethod: 'CASH', referenceNumber: 'DR-SOY-4', acceptCostChange: true,
    });
    expect(written[0]).toBeCloseTo(0.15, 8);
    expect(valuing(events)).toEqual([]);
  });
});
