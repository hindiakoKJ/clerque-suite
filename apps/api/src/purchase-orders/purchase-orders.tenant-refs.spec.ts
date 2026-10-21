import { ForbiddenException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * A PO line may only name this shop's ingredients and products.
 *
 * The line DTO is a plain interface, so nothing upstream checked the ids.
 * A line could carry another shop's ingredient or product id, and the PO
 * detail then looked the names up by id alone, handing back that shop's
 * ingredient name and unit, or product name and SKU. Create and update now
 * check the ids against the shop, and the detail only resolves names inside
 * the shop.
 */
describe('PurchaseOrdersService — PO lines stay inside the shop', () => {
  const TENANT = 'shop-a';
  const OWN_RM = 'rm-a';
  const OWN_PROD = 'prod-a';
  const FOREIGN_RM = 'rm-b';
  const FOREIGN_PROD = 'prod-b';

  // What the database holds: one ingredient and one product per shop.
  const RAW = [
    { id: OWN_RM, tenantId: TENANT, name: 'Beans', unit: 'g' },
    { id: FOREIGN_RM, tenantId: 'shop-b', name: 'Secret Blend', unit: 'g' },
  ];
  const PRODUCTS = [
    { id: OWN_PROD, tenantId: TENANT, name: 'Cup 12oz', sku: 'C12' },
    { id: FOREIGN_PROD, tenantId: 'shop-b', name: 'B Product', sku: 'B-1' },
  ];
  const byWhere = (rows: any[]) => jest.fn(async ({ where, select }: any) =>
    rows
      .filter((r) => where.id.in.includes(r.id))
      .filter((r) => where.tenantId === undefined || r.tenantId === where.tenantId)
      .map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]]))));

  function build() {
    const tx: any = {
      branch:            { findFirst: jest.fn().mockResolvedValue({ id: 'br-a' }) },
      vendor:            { findFirst: jest.fn().mockResolvedValue({ id: 'v-a' }) },
      rawMaterial:       { findMany: byWhere(RAW) },
      product:           { findMany: byWhere(PRODUCTS) },
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
        create:    jest.fn(async (args: any) => ({ id: 'po-new', ...args.data })),
        update:    jest.fn(async (args: any) => ({ id: 'po-1', ...args.data })),
      },
      purchaseOrderItem: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma: any = {
      $transaction: jest.fn((fn: any) => fn(tx)),
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 'po-1', status: 'DRAFT', taxCents: 0 }),
      },
      rawMaterial: { findMany: byWhere(RAW) },
      product:     { findMany: byWhere(PRODUCTS) },
    };
    const svc = new PurchaseOrdersService(prisma, {} as any);
    return { svc, prisma, tx };
  }

  const line = (over: any) => ({ description: 'x', qtyOrdered: 1, unitCost: 1, ...over });
  const order = (items: any[]) => ({ orderDate: '2026-10-21', items });

  describe('create()', () => {
    it('refuses another shop\'s ingredient and saves nothing', async () => {
      const { svc, tx } = build();
      await expect(svc.create(TENANT, 'u1', order([line({ rawMaterialId: FOREIGN_RM })])))
        .rejects.toThrow(ForbiddenException);
      expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('refuses another shop\'s product, even next to the shop\'s own lines', async () => {
      const { svc, tx } = build();
      await expect(svc.create(TENANT, 'u1', order([
        line({ rawMaterialId: OWN_RM }),
        line({ productId: FOREIGN_PROD }),
      ]))).rejects.toThrow(ForbiddenException);
      expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('still saves lines that name the shop\'s own ingredient and product', async () => {
      const { svc, tx } = build();
      await svc.create(TENANT, 'u1', order([
        line({ rawMaterialId: OWN_RM }),
        line({ productId: OWN_PROD }),
        line({ rawMaterialId: OWN_RM }),   // the same item twice is one id, not a mismatch
      ]));
      expect(tx.purchaseOrder.create).toHaveBeenCalledTimes(1);
      expect(tx.rawMaterial.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [OWN_RM] }, tenantId: TENANT } }),
      );
    });
  });

  describe('update()', () => {
    it('refuses replacing the lines with another shop\'s ingredient, and keeps the old lines', async () => {
      const { svc, tx } = build();
      await expect(svc.update(TENANT, 'po-1', { items: [line({ rawMaterialId: FOREIGN_RM })] }))
        .rejects.toThrow(ForbiddenException);
      expect(tx.purchaseOrderItem.deleteMany).not.toHaveBeenCalled();
      expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('still replaces the lines with the shop\'s own items', async () => {
      const { svc, tx } = build();
      await svc.update(TENANT, 'po-1', { items: [line({ productId: OWN_PROD })] });
      expect(tx.purchaseOrderItem.deleteMany).toHaveBeenCalled();
      expect(tx.purchaseOrder.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('get()', () => {
    it('resolves names only inside the shop, so an old foreign line shows no name', async () => {
      const { svc, prisma } = build();
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1', tenantId: TENANT,
        items: [
          { id: 'i1', rawMaterialId: OWN_RM,     productId: null },
          { id: 'i2', rawMaterialId: FOREIGN_RM, productId: null },
          { id: 'i3', rawMaterialId: null,       productId: FOREIGN_PROD },
          { id: 'i4', rawMaterialId: null,       productId: OWN_PROD },
        ],
      });
      const po: any = await svc.get(TENANT, 'po-1');
      expect(po.items[0].rawMaterial).toEqual({ id: OWN_RM, name: 'Beans', unit: 'g' });
      expect(po.items[1].rawMaterial).toBeNull();
      expect(po.items[2].product).toBeNull();
      expect(po.items[3].product).toEqual({ id: OWN_PROD, name: 'Cup 12oz', sku: 'C12' });
      expect(JSON.stringify(po)).not.toContain('Secret Blend');
      expect(JSON.stringify(po)).not.toContain('B Product');
    });
  });
});
