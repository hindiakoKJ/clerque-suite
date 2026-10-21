import { ForbiddenException } from '@nestjs/common';
import { ImportService } from './import.service';

/**
 * The stock imports take a branch id from the request, and it must be one of
 * the caller's own branches.
 *
 * POST /import/inventory, /import/loyverse and /import/setup-pack passed the
 * query's branchId straight to the stock writer, which filed the shop's stock
 * rows under that branch. Another shop's branch id was accepted. It is now
 * checked against the shop before the file is even read.
 */
describe('ImportService — the stock branch must be this shop\'s', () => {
  const TENANT = 'shop-a';
  const OWN_BRANCH = 'br-a';
  const FOREIGN_BRANCH = 'br-b';
  const OPEN_PERIODS = { assertDateIsOpen: async () => undefined } as never;

  function model(overrides: Record<string, unknown> = {}) {
    return {
      findFirst:  jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany:   jest.fn().mockResolvedValue([]),
      create:     jest.fn().mockResolvedValue({ id: 'new-id' }),
      update:     jest.fn().mockResolvedValue({ id: 'upd-id' }),
      upsert:     jest.fn().mockResolvedValue({ id: 'ups-id' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    };
  }

  function build() {
    const tx = {
      rawMaterialInventory: model(), rawMaterial: model(), rawMaterialLot: model(),
      bomItem: model(), product: model(), accountingEvent: model(),
    };
    const prisma: any = {
      tenant:        model({ findUnique: jest.fn().mockResolvedValue({ businessType: 'COFFEE_SHOP' }) }),
      category:      model(),
      product:       model(),
      productLot:    model(),
      // Only shop A's own branch matches { id, tenantId }.
      branch:        model({
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === OWN_BRANCH && where.tenantId === TENANT ? { id: OWN_BRANCH, name: 'Main' } : null),
      }),
      inventoryItem: model(),
      account:       model(),
      journalEntry:  model(),
      customer:      model(),
      vendor:        model(),
      rawMaterial:   model(),
      rawMaterialLot: model(),
      bomItem:       model(),
      $transaction:  jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const svc = new ImportService(prisma, OPEN_PERIODS);
    // Spy on the file reader: a refused branch must stop before the file is read.
    const parseFile = jest.spyOn(svc as any, 'parseFile');
    const parseAllSheets = jest.spyOn(svc as any, 'parseAllSheets');
    return { svc, prisma, parseFile, parseAllSheets };
  }

  const asFile = (buffer: Buffer, name = 'stock.xlsx') =>
    ({ originalname: name, buffer } as unknown as Express.Multer.File);

  describe('POST /import/inventory', () => {
    it('refuses another shop\'s branch before reading the file', async () => {
      const { svc, prisma, parseFile } = build();
      const file = asFile(await svc.inventoryTemplate());
      await expect(svc.importInventory(file, TENANT, FOREIGN_BRANCH)).rejects.toThrow(ForbiddenException);
      expect(parseFile).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
    });

    it('still imports into the shop\'s own branch', async () => {
      const { svc, parseFile } = build();
      const r = await svc.importInventory(asFile(await svc.inventoryTemplate()), TENANT, OWN_BRANCH);
      expect(parseFile).toHaveBeenCalled();
      expect(r.errors).toEqual([]);
    });
  });

  describe('POST /import/loyverse', () => {
    it('refuses another shop\'s branch before reading the file', async () => {
      const { svc, parseFile } = build();
      const file = asFile(await svc.loyverseTemplate(), 'loyverse.xlsx');
      await expect(svc.importLoyverse(file, TENANT, FOREIGN_BRANCH)).rejects.toThrow(ForbiddenException);
      expect(parseFile).not.toHaveBeenCalled();
    });

    it('still reads the export for the shop\'s own branch, or with no branch', async () => {
      const { svc, parseFile, prisma } = build();
      const file = asFile(await svc.loyverseTemplate(), 'loyverse.xlsx');
      // The sample export may or may not import rows; what matters is the branch is not refused.
      await svc.importLoyverse(file, TENANT, OWN_BRANCH).catch((e) => {
        expect(e).not.toBeInstanceOf(ForbiddenException);
      });
      await svc.importLoyverse(file, TENANT, undefined).catch((e) => {
        expect(e).not.toBeInstanceOf(ForbiddenException);
      });
      expect(parseFile).toHaveBeenCalledTimes(2);
      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OWN_BRANCH, tenantId: TENANT } }),
      );
    });
  });

  describe('POST /import/setup-pack', () => {
    it('refuses another shop\'s branch for the whole pack, not as one bad sheet', async () => {
      const { svc, parseAllSheets, prisma } = build();
      const file = asFile(await svc.setupPackTemplate(TENANT), 'pack.xlsx');
      await expect(svc.importSetupPack(file, TENANT, FOREIGN_BRANCH)).rejects.toThrow(ForbiddenException);
      expect(parseAllSheets).not.toHaveBeenCalled();
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('still imports the pack for the shop\'s own branch', async () => {
      const { svc } = build();
      const r = await svc.importSetupPack(asFile(await svc.setupPackTemplate(TENANT), 'pack.xlsx'), TENANT, OWN_BRANCH);
      expect(r.products.notIncluded).toBe(false);
    });

    it('still imports with no branch (the caller has none), without a lookup', async () => {
      const { svc, prisma } = build();
      const r = await svc.importSetupPack(asFile(await svc.setupPackTemplate(TENANT), 'pack.xlsx'), TENANT, '');
      expect(r.products.notIncluded).toBe(false);
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });
  });
});
