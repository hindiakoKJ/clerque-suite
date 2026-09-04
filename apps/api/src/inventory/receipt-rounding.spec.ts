import { InventoryService } from './inventory.service';

/**
 * A receipt whose value lands on a half-centavo split the entry in two.
 *
 * `totalValue` was the bare product `quantity * unitCost` while `grossValue`,
 * computed two lines below from the same multiplication, was
 * `+(...).toFixed(2)`. The journal debits the first and credits the second, so
 * for a NON-VAT or owner-funded receipt — where the two ARE the same number —
 * an exact half-centavo rounded one way on the debit and the other on the
 * credit.
 *
 * Found on a test tenant loaded with Carolina's real opening stock:
 *   5325 ml x PHP 0.575  = 3061.875 -> Dr 3061.88 / Cr 3061.87
 *   13939 g x PHP 0.235  = 3275.665 -> Dr 3275.67 / Cr 3275.66
 *
 * Two receipts out of 59 entries, and the trial balance stopped footing by
 * PHP 0.02. Every entry still reported "balanced" under a tolerance check,
 * which is how it stayed invisible.
 */
describe('Receiving stock — the two legs must be the same number', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const RM = 'rm-1';

  function build(taxStatus: 'VAT' | 'NON_VAT' = 'NON_VAT') {
    const events: any[] = [];
    const tx: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: RM, name: 'Monin Dark Chocolate Sauce', unit: 'ml',
          costPrice: 0.575, category: 'INGREDIENT', lotsTracked: false, isActive: true,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue({ quantity: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      rawMaterialLot: { create: jest.fn().mockResolvedValue({}) },
      // Entering a cost re-blends the weighted average, which ripples into
      // every recipe using the ingredient. No recipe here: nothing to ripple.
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      product: { update: jest.fn().mockResolvedValue({}) },
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }),
      },
      vendor: { findFirst: jest.fn().mockResolvedValue(null) },
      bill: { create: jest.fn().mockResolvedValue({}) },
      purchaseRequestLine: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      purchaseOrderItem: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    const material = {
      id: RM, name: 'Monin Dark Chocolate Sauce', unit: 'ml',
      costPrice: 0.575, category: 'INGREDIENT', lotsTracked: false, isActive: true,
    };
    const prisma: any = {
      rawMaterial: { findFirst: jest.fn().mockResolvedValue(material) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus, costingMethod: 'WAC' }),
                findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus, costingMethod: 'WAC' }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }), count: jest.fn().mockResolvedValue(1) },
      rawMaterialInventory: { findUnique: jest.fn().mockResolvedValue({ quantity: 0 }) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const periods: any = { assertDateIsOpen: jest.fn() };
    return { svc: new InventoryService(prisma, periods) as any, events };
  }

  const receive = (svc: any, quantity: number, unitCost: number) =>
    svc.receiveRawMaterial(TENANT, RM, {
      branchId: BRANCH, quantity, unitCost,
      paymentMethod: 'OWNER_FUNDED', referenceNumber: 'HALF-CENTAVO',
    });

  it('values a half-centavo receipt as ONE number, not two', async () => {
    // 5325 x 0.575 = 3061.875 exactly — the case that split the entry.
    const { svc, events } = build();
    await receive(svc, 5325, 0.575);
    const p = events[0]?.payload;
    expect(p).toBeTruthy();
    expect(p.totalValue).toBe(p.grossValue);
  });

  it('and the second one found in the real data', async () => {
    // 13939 x 0.235 = 3275.665.
    const { svc, events } = build();
    await receive(svc, 13939, 0.235).catch(() => undefined);
    const p = events[0]?.payload;
    expect(p.totalValue).toBe(p.grossValue);
  });

  it('stores the value to the centavo, not to a float tail', async () => {
    const { svc, events } = build();
    await receive(svc, 5325, 0.575).catch(() => undefined);
    // 3061.8749999999995 must not survive into the ledger.
    expect(events[0].payload.totalValue).toBe(3061.87);
  });

  it('leaves an ordinary receipt exactly as it was', async () => {
    /*
      The guarantee that makes this safe: where no rounding was in question,
      nothing moves. 1000 x 0.575 = 575 exactly, and both legs still say 575.
    */
    const { svc, events } = build();
    await receive(svc, 1000, 0.575);
    expect(events[0].payload.totalValue).toBe(575);
    expect(events[0].payload.grossValue).toBe(575);
  });

  /*
    The same rule, one line further down: a VAT-registered shop.

    The shelf is worth the price minus the 12% the BIR gives back, so ONE
    delivery is three numbers -- net, VAT, gross -- and the journal debits the
    first two against the third. Each was rounded on its own, so about one
    receipt in ten came out a centavo apart. Most of those posted an entry
    that did not balance (the checker allows a centavo); the rest failed
    outright, retried five times and left the delivery off the books.
  */
  const receiveVat = (svc: any, quantity: number, grossUnitPrice: number) =>
    svc.receiveRawMaterial(TENANT, RM, {
      branchId: BRANCH, quantity, costPrice: grossUnitPrice,
      paymentMethod: 'CASH', referenceNumber: 'VAT-ROUNDING',
    });

  it('a VAT receipt adds up: net + input VAT is the gross, to the centavo', async () => {
    // 7 x 1.02 gross: net 6.38, VAT 0.76, gross 7.14. Rounded apart it was
    // 6.38 + 0.77 = 7.15 -- a centavo of debits with no credit behind it.
    const { svc, events } = build('VAT');
    await receiveVat(svc, 7, 1.02);
    const p = events[0].payload;
    expect(p.grossValue).toBe(7.14);
    expect(+(p.totalValue + p.inputVat).toFixed(2)).toBe(p.grossValue);
  });

  it('holds across the awkward quantities too', async () => {
    for (const [qty, price] of [[1.5, 1.01], [0.25, 1.01], [12, 1.03], [25, 0.99], [3, 4.00]] as const) {
      const { svc, events } = build('VAT');
      await receiveVat(svc, qty, price);
      const p = events[0].payload;
      expect(+(p.totalValue + p.inputVat).toFixed(2)).toBe(p.grossValue);
      expect(p.inputVat).toBeGreaterThanOrEqual(0);
    }
  });

  it('claims no VAT back when there is no VAT to claim', async () => {
    // A NON-VAT shop, and an owner-funded receipt at a VAT shop, both have
    // one number: gross is net and the VAT line never appears.
    const { svc, events } = build('NON_VAT');
    await receiveVat(svc, 7, 1.02);
    expect(events[0].payload.inputVat).toBe(0);
    expect(events[0].payload.grossValue).toBe(events[0].payload.totalValue);
  });
});
