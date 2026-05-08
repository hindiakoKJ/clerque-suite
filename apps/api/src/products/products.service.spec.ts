/**
 * ProductsService — focused on the cross-tenant TOCTOU fix in deactivate()
 * and tenant scoping in list/find paths. Heavier creation / BOM logic is
 * exercised end-to-end via orders.service.spec.ts and journal.accounting.spec.ts.
 */
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function makePrismaMock() {
  return {
    product: {
      findMany:   jest.fn(),
      findFirst:  jest.fn(),
      findUnique: jest.fn(),
      update:     jest.fn(),
      updateMany: jest.fn(),
      count:      jest.fn(),
    },
  };
}

describe('ProductsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: ProductsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ProductsService(prisma as any);
  });

  describe('findAll — tenant scoping', () => {
    it('always filters by tenantId', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await service.findAll(TENANT_A);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_A }),
        }),
      );
    });

    it('hides inactive by default', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await service.findAll(TENANT_A);
      const args = prisma.product.findMany.mock.calls[0][0] as any;
      expect(args.where.isActive).toBe(true);
    });

    it('includes inactive when requested', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await service.findAll(TENANT_A, /*includeInactive*/ true);
      const args = prisma.product.findMany.mock.calls[0][0] as any;
      expect(args.where.isActive).toBeUndefined();
    });
  });

  describe('deactivate — TOCTOU fix (atomic tenant-scoped updateMany)', () => {
    it('uses updateMany with both id AND tenantId in WHERE', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 1 });
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', isActive: false });

      await service.deactivate(TENANT_A, 'p1');

      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', tenantId: TENANT_A },
        data:  { isActive: false },
      });
      // The legacy unscoped update() must NOT be used.
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when count=0 (cross-tenant id, or unknown)', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.deactivate(TENANT_A, 'p-from-tenant-b'))
        .rejects.toThrow(NotFoundException);
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
    });

    it('cross-tenant attack: TENANT_A trying to deactivate TENANT_B product gets count=0 and 404', async () => {
      // Simulates real Prisma behaviour: { id: pB, tenantId: tA } matches no rows.
      prisma.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.deactivate(TENANT_A, 'product-from-b'))
        .rejects.toThrow(NotFoundException);

      // No DB write happened.
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });
});
