import { InventoryService } from './inventory.service';

/**
 * Two people receiving at once must not erase each other.
 *
 * The write was absolute: read the quantity, add the delivery, write the total.
 * Two deliveries received at the same moment — the barista on the tablet and
 * the owner on his phone — each computed their own total from their own read,
 * and the later write erased the earlier delivery entirely.
 *
 * The failure is quiet and points the wrong way: stock reads LOW, so Procure
 * re-orders what is already on the shelf, and the only sign is a count that
 * comes up over. Stock transfers have always used a relative write; this is
 * the same fix applied to the path every delivery goes through.
 */
describe('InventoryService.receiveRawMaterial — concurrent deliveries', () => {
  const TENANT = 't1';
  const RM = 'rm-beans';
  const BRANCH = 'b1';

  function build(existingRow: boolean) {
    const upserts: any[] = [];
    const tx: any = {
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue(existingRow ? { quantity: 1000 } : null),
        upsert: jest.fn((a: any) => { upserts.push(a); return Promise.resolve({}); }),
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
          id: RM, tenantId: TENANT, name: 'Coffee Beans', unit: 'g',
          costPrice: 1.85, category: 'INGREDIENT',
        }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH, tenantId: TENANT }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT' }) },
      vendor: { findFirst: jest.fn().mockResolvedValue({ id: 'v1' }) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue(existingRow ? { quantity: 1000 } : null),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new InventoryService(prisma, periods) as any;
    svc.assertBranchBelongsToTenant = jest.fn().mockResolvedValue(undefined);
    return { svc, upserts };
  }

  const dto = { branchId: BRANCH, quantity: 500, costPrice: 1.85, paymentMethod: 'CASH' as const };

  it('adds the delivery rather than writing a computed total', async () => {
    const { svc, upserts } = build(true);
    await svc.receiveRawMaterial(TENANT, RM, dto);
    expect(Number(upserts[0].update.quantity.increment)).toBe(500);
  });

  it('never sends an absolute quantity on the update path', async () => {
    // An absolute figure is exactly what let one delivery overwrite another.
    const { svc, upserts } = build(true);
    await svc.receiveRawMaterial(TENANT, RM, dto);
    expect(upserts[0].update.quantity.increment).toBeDefined();
    expect(typeof upserts[0].update.quantity).not.toBe('number');
  });

  it('still writes the plain quantity when creating the first row', async () => {
    // Nothing to add to: no row means the delivery IS the whole shelf.
    const { svc, upserts } = build(false);
    await svc.receiveRawMaterial(TENANT, RM, dto);
    expect(Number(upserts[0].create.quantity)).toBe(500);
  });

  it('stamps the new row with the tenant and branch', async () => {
    const { svc, upserts } = build(false);
    await svc.receiveRawMaterial(TENANT, RM, dto);
    expect(upserts[0].create.tenantId).toBe(TENANT);
    expect(upserts[0].create.branchId).toBe(BRANCH);
  });
});
