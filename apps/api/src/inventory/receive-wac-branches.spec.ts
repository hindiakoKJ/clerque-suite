import { InventoryService } from './inventory.service';

/**
 * One cost, so one pool of stock to average it over.
 *
 * RawMaterial.costPrice belongs to the company. RawMaterialInventory belongs
 * to a branch. Blending a delivery against ONE branch's quantity and then
 * storing the answer company-wide let a small delivery into a nearly empty
 * branch reset the cost of that ingredient everywhere: 200 kg of sugar at the
 * main shop, 5 kg delivered to the kiosk at a holiday price, and every drink
 * in both shops re-costed at the kiosk's price.
 *
 * Nobody would catch it by eye. The number that moves is a cost per unit, not
 * a peso figure on any screen, and it moves every margin with it.
 *
 * A single-branch shop is unaffected: the sum over the branches is that one
 * branch, which is what it always was.
 */
describe('Weighted average cost, across the branches that share it', () => {
  const TENANT = 't1';
  const MAIN   = 'branch-main';
  const KIOSK  = 'branch-kiosk';
  const SUGAR  = 'rm-sugar';

  function build(onHand: Array<{ branchId: string; quantity: number }>, costPrice: number) {
    const written: Array<{ costPrice: number }> = [];
    const tx: any = {
      rawMaterialInventory: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(
          onHand.find((r) => r.branchId === where.branchId_rawMaterialId.branchId) ?? null,
        )),
        findMany: jest.fn(() => Promise.resolve(onHand.map((r) => ({ ...r })))),
        upsert:   jest.fn().mockResolvedValue({}),
      },
      rawMaterial: {
        update: jest.fn(({ data }: any) => { written.push({ costPrice: Number(data.costPrice) }); return Promise.resolve({}); }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'lot1' }) },
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
      accountingEvent: { create: jest.fn().mockResolvedValue({}) },
      aPBill: { create: jest.fn().mockResolvedValue({}) },
      vendor: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma: any = {
      branch: { findFirst: jest.fn(({ where }: any) => Promise.resolve({ id: where.id })) },
      rawMaterial: { findFirst: jest.fn().mockResolvedValue({ id: SUGAR, tenantId: TENANT, name: 'White Sugar', unit: 'g', costPrice, lowStockAlert: null }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', inventoryValuation: 'WAC', businessType: 'FOOD_BEVERAGE' }) },
      rawMaterialInventory: { findUnique: tx.rawMaterialInventory.findUnique },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new InventoryService(prisma, periods) as any;
    return { svc, tx, written };
  }

  it('does not let a small delivery to a quiet branch reset the price for the whole shop', async () => {
    // 200,000 g at 0.05 at the main branch, nothing at the kiosk.
    // The kiosk takes in 5,000 g at 0.20 — four times the price.
    const { svc, written } = build(
      [{ branchId: MAIN, quantity: 200_000 }, { branchId: KIOSK, quantity: 0 }],
      0.05,
    );
    await svc.receiveRawMaterial(TENANT, SUGAR, {
      branchId: KIOSK, quantity: 5_000, costPrice: 0.20,
      paymentMethod: 'CASH', referenceNumber: 'DR-KIOSK-1', acceptCostChange: true,
    });

    // (200000 × 0.05 + 5000 × 0.20) / 205000 = 10,000 + 1,000 over 205,000
    expect(written).toHaveLength(1);
    expect(written[0].costPrice).toBeCloseTo(11_000 / 205_000, 8);
    // Blended against the kiosk alone it would have been the delivery price.
    expect(written[0].costPrice).not.toBeCloseTo(0.20, 4);
  });

  it('leaves a one-branch shop exactly where it was', async () => {
    const { svc, written } = build([{ branchId: MAIN, quantity: 1_000 }], 0.10);
    await svc.receiveRawMaterial(TENANT, SUGAR, {
      branchId: MAIN, quantity: 1_000, costPrice: 0.20,
      paymentMethod: 'CASH', referenceNumber: 'DR-MAIN-1', acceptCostChange: true,
    });
    // (1000 × 0.10 + 1000 × 0.20) / 2000 = 0.15 — the same arithmetic as before.
    expect(written[0].costPrice).toBeCloseTo(0.15, 8);
  });

  it('takes the delivery price when the company holds none of it yet', async () => {
    const { svc, written } = build([{ branchId: MAIN, quantity: 0 }], 0);
    await svc.receiveRawMaterial(TENANT, SUGAR, {
      branchId: MAIN, quantity: 500, costPrice: 0.30,
      paymentMethod: 'CASH', referenceNumber: 'DR-FIRST',
    });
    expect(written[0].costPrice).toBeCloseTo(0.30, 8);
  });
});
