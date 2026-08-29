import { InventoryService } from './inventory.service';

/**
 * A delivery received twice is always a mistake.
 *
 * The bulk importer has always known this — it skips a row whose reference
 * number already has a lot against that ingredient. The in-app Receive path
 * did not: it wrote `referenceNumber` onto the lot and never looked at it
 * again. So a double-clicked Receive, or a retry after the connection dropped
 * mid-request, added the stock twice AND posted the inventory journal entry
 * twice, with nothing in the data to mark the second one as spurious.
 *
 * It matters more once purchase requests exist: the request's line number
 * becomes the reference, and "don't buy or receive the same line twice" stops
 * being something a person has to remember.
 *
 * A duplicate returns the original receipt rather than throwing, so a client
 * retrying after a timeout gets the answer it would have got the first time.
 */
describe('InventoryService — receiving the same reference twice', () => {
  const TENANT = 't1';
  const RM     = 'rm-beans';
  const BRANCH = 'b1';

  function build(existingLot: any = null) {
    const tx: any = {
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue({ quantity: 1000 }),
        upsert:     jest.fn().mockResolvedValue({}),
      },
      rawMaterial:     { update: jest.fn().mockResolvedValue({}) },
      rawMaterialLot:  { create: jest.fn().mockResolvedValue({}) },
      accountingEvent: { create: jest.fn().mockResolvedValue({}) },
      aPBill:          { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      product:         { findMany: jest.fn().mockResolvedValue([]) },
      bomItem:         { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({ id: RM, tenantId: TENANT, name: 'Coffee Beans', unit: 'g', costPrice: 1.1 }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH, tenantId: TENANT }) },
      vendor: { findFirst: jest.fn().mockResolvedValue({ id: 'v1' }) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(existingLot) },
      rawMaterialInventory: { findUnique: jest.fn().mockResolvedValue({ quantity: 1000 }) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new InventoryService(prisma, periods) as any;
    // assertBranchBelongsToTenant is a private helper that hits its own query
    svc.assertBranchBelongsToTenant = jest.fn().mockResolvedValue(undefined);
    return { svc, prisma, tx };
  }

  const dto = (ref?: string) => ({
    branchId: BRANCH, quantity: 5000, costPrice: 1.1,
    paymentMethod: 'CASH' as const, referenceNumber: ref,
  });

  it('records the delivery the first time', async () => {
    const { svc, tx } = build(null);
    const res = await svc.receiveRawMaterial(TENANT, RM, dto('DR-1001'));

    expect(tx.rawMaterialLot.create).toHaveBeenCalled();
    expect(tx.rawMaterialInventory.upsert).toHaveBeenCalled();
    expect(res.duplicate).toBeUndefined();
    expect(res.quantity).toBe(5000);
  });

  it('refuses the second time, and adds no stock', async () => {
    const { svc, tx } = build({
      id: 'lot1', branchId: BRANCH, qtyReceived: 5000, unitCost: 1.1,
      receivedAt: new Date('2026-08-24T04:00:00Z'),
    });
    const res = await svc.receiveRawMaterial(TENANT, RM, dto('DR-1001'));

    expect(res.duplicate).toBe(true);
    expect(res.message).toMatch(/already received/i);
    // nothing was written — no lot, no stock, no journal entry
    expect(tx.rawMaterialLot.create).not.toHaveBeenCalled();
    expect(tx.rawMaterialInventory.upsert).not.toHaveBeenCalled();
    expect(tx.accountingEvent.create).not.toHaveBeenCalled();
  });

  it('reports the ORIGINAL receipt, so a retry after a timeout is safe', async () => {
    const { svc } = build({
      id: 'lot1', branchId: BRANCH, qtyReceived: 5000, unitCost: 1.1,
      receivedAt: new Date('2026-08-24T04:00:00Z'),
    });
    const res = await svc.receiveRawMaterial(TENANT, RM, dto('DR-1001'));

    expect(res.quantity).toBe(5000);
    expect(res.totalValue).toBeCloseTo(5500, 2);
    expect(res.quantityAfter).toBe(1000);
    expect(res.quantityBefore).toBe(-4000);   // 1000 now, 5000 of it from this lot
  });

  it('allows the same reference on a DIFFERENT ingredient', async () => {
    // One invoice covers many items. Scoping the check to (reference, ingredient)
    // is what makes a single DR number usable across a whole delivery.
    const { svc, prisma, tx } = build(null);
    await svc.receiveRawMaterial(TENANT, 'rm-milk', dto('DR-1001'));

    expect(prisma.rawMaterialLot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ rawMaterialId: 'rm-milk', referenceNumber: 'DR-1001' }),
      }),
    );
    expect(tx.rawMaterialLot.create).toHaveBeenCalled();
  });

  it('does not deduplicate when no reference is given', async () => {
    // Without a reference there is nothing to match on, and refusing every
    // second receipt of the same ingredient would break normal restocking.
    const { svc, prisma, tx } = build(null);
    await svc.receiveRawMaterial(TENANT, RM, dto(undefined));

    expect(prisma.rawMaterialLot.findFirst).not.toHaveBeenCalled();
    expect(tx.rawMaterialLot.create).toHaveBeenCalled();
  });

  it('trims the reference, so " DR-1001 " is the same delivery', async () => {
    const { svc, prisma } = build(null);
    await svc.receiveRawMaterial(TENANT, RM, dto('  DR-1001  '));

    expect(prisma.rawMaterialLot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ referenceNumber: 'DR-1001' }) }),
    );
  });

  it('ignores a blank reference rather than matching every blank one to each other', async () => {
    const { svc, prisma, tx } = build(null);
    await svc.receiveRawMaterial(TENANT, RM, dto('   '));

    expect(prisma.rawMaterialLot.findFirst).not.toHaveBeenCalled();
    expect(tx.rawMaterialLot.create).toHaveBeenCalled();
  });
});
