import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/**
 * One mistyped delivery cost re-costs the whole menu.
 *
 * Receiving blends the delivery cost into the weighted average and then
 * ripples it out through `recostProductsUsing`, so the number typed into one
 * box rewrites what every drink using that ingredient costs — and therefore
 * every margin the owner reads. Nothing on the way in objected.
 *
 * The realistic mistake is a unit confusion: beans are on file at ₱1.85 per
 * gram, the sack cost ₱1,850, and someone types 1850. The latte then costs
 * more than a phone. Same shape as the kg/g trap on the create form, arriving
 * through a different door.
 *
 * A factor of 10 is deliberately loose. Real prices move, and a guard that
 * cries wolf gets clicked through without being read.
 */
describe('InventoryService.receiveRawMaterial — cost sanity', () => {
  const TENANT = 't1';
  const RM = 'rm-beans';
  const BRANCH = 'b1';

  function build(costPrice: number | null) {
    const tx: any = {
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue({ quantity: 1000 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      rawMaterial: { update: jest.fn().mockResolvedValue({}) },
      rawMaterialLot: { create: jest.fn().mockResolvedValue({}) },
      accountingEvent: { create: jest.fn().mockResolvedValue({}) },
      aPBill: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: RM, tenantId: TENANT, name: 'Espresso Beans', unit: 'g',
          costPrice, category: 'INGREDIENT',
        }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH, tenantId: TENANT }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT' }) },
      vendor: { findFirst: jest.fn().mockResolvedValue({ id: 'v1' }) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      rawMaterialInventory: { findUnique: jest.fn().mockResolvedValue({ quantity: 1000 }) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new InventoryService(prisma, periods) as any;
    svc.assertBranchBelongsToTenant = jest.fn().mockResolvedValue(undefined);
    return { svc, tx };
  }

  const dto = (costPrice: number, extra: Record<string, unknown> = {}) => ({
    branchId: BRANCH, quantity: 500, costPrice,
    paymentMethod: 'CASH' as const, ...extra,
  });

  it('refuses a cost a thousand times the one on file', async () => {
    // ₱1.85/g on file, the sack price typed in.
    const { svc } = build(1.85);
    await expect(svc.receiveRawMaterial(TENANT, RM, dto(1850)))
      .rejects.toThrow(BadRequestException);
  });

  it('names both prices and points at the unit, rather than saying "invalid"', async () => {
    const { svc } = build(1.85);
    await expect(svc.receiveRawMaterial(TENANT, RM, dto(1850)))
      .rejects.toThrow(/Espresso Beans.*1\.85.*per g.*Check the unit/s);
  });

  it('refuses the opposite mistake too — a per-gram price against a per-sack item', async () => {
    const { svc } = build(1850);
    await expect(svc.receiveRawMaterial(TENANT, RM, dto(1.85)))
      .rejects.toThrow(/times less/);
  });

  it('writes nothing when it refuses', async () => {
    // Half a receipt at the wrong cost is worse than none: the WAC is already
    // poisoned and the recost ripple has already run.
    const { svc, tx } = build(1.85);
    await expect(svc.receiveRawMaterial(TENANT, RM, dto(1850))).rejects.toThrow();
    expect(tx.rawMaterialInventory.upsert).not.toHaveBeenCalled();
    expect(tx.rawMaterialLot.create).not.toHaveBeenCalled();
    expect(tx.accountingEvent.create).not.toHaveBeenCalled();
  });

  it('lets an ordinary price rise through untouched', async () => {
    // Beans went from ₱1.85 to ₱2.10. That is a Tuesday, not an error.
    const { svc, tx } = build(1.85);
    await svc.receiveRawMaterial(TENANT, RM, dto(2.1));
    expect(tx.rawMaterialInventory.upsert).toHaveBeenCalled();
  });

  it('allows a big-but-believable move at the edge of the band', async () => {
    // 9x. Loose on purpose: a guard that fires on real prices gets ignored.
    const { svc, tx } = build(1.0);
    await svc.receiveRawMaterial(TENANT, RM, dto(9));
    expect(tx.rawMaterialInventory.upsert).toHaveBeenCalled();
  });

  it('proceeds when the person says the price really did change', async () => {
    const { svc, tx } = build(1.85);
    await svc.receiveRawMaterial(TENANT, RM, dto(1850, { acceptCostChange: true }));
    expect(tx.rawMaterialInventory.upsert).toHaveBeenCalled();
  });

  it('says nothing about an ingredient that has no cost yet', async () => {
    // The first delivery IS the cost. There is nothing to compare against, and
    // refusing would make a new ingredient impossible to receive.
    const { svc, tx } = build(null);
    await svc.receiveRawMaterial(TENANT, RM, dto(1850));
    expect(tx.rawMaterialInventory.upsert).toHaveBeenCalled();
  });

  it('says nothing when the delivery carries no cost at all', async () => {
    // A free sample, or a receipt that just moves quantity.
    const { svc, tx } = build(1.85);
    await svc.receiveRawMaterial(TENANT, RM, {
      branchId: BRANCH, quantity: 500, paymentMethod: 'OWNER_FUNDED' as const,
    });
    expect(tx.rawMaterialInventory.upsert).toHaveBeenCalled();
  });
});
