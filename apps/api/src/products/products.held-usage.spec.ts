import { ProductsService } from './products.service';

/**
 * Six lattes paid and still at the bar have not taken their milk yet.
 *
 * The book still counts that milk until the ready tap, but the next customer
 * cannot have it. The till's "N left", its low-stock and out-of-stock marks,
 * the named limiting ingredient, the parked-prep hint and the products table
 * all have to count from on hand less what waiting tickets hold -- or the till
 * offers the same cups twice and the sale is refused against the same milk.
 *
 * One fake database that honours the filters the real hold helper sends
 * (branch, order status, still waiting, net quantity), so a ticket at another
 * branch, a voided order or a line already confirmed shows up as a wrong number.
 */
describe('ProductsService -- ingredients held by waiting tickets', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const OTHER = 'br-2';
  const rm = (id: string, name: string, unit: string) => ({ id, name, unit, costPrice: null, lotsTracked: false });
  const MILK = rm('rm-milk', 'Full Cream Milk', 'ml');
  const BEANS = rm('rm-beans', 'Coffee Beans', 'g');
  const SAUCE = rm('rm-sauce', 'Spaghetti Sauce', 'g');
  const FROZEN = rm('rm-frozen', 'Spaghetti Sauce (frozen)', 'g');
  const on = (x: ReturnType<typeof rm>, quantity: number) => ({ rawMaterialId: x.id, quantity, rawMaterial: x });

  // Latte: milk runs out first (3000/150 = 20; beans 900/18 = 50).
  // Spaghetti: no ready sauce on the line, a 2 kg tub parked behind it.
  // Sauce Tub: sold straight from the parked prep, so a waiting one holds it.
  // Bottled Water: shelf stock, which never waits for a ready tap.
  const MENU = [
    { id: 'p-latte', name: 'Latte', inventoryMode: 'RECIPE_BASED', bomItems: [on(MILK, 150), on(BEANS, 18)], shelf: null },
    { id: 'p-spag', name: 'Spaghetti', inventoryMode: 'RECIPE_BASED', bomItems: [on(SAUCE, 200)], shelf: null },
    { id: 'p-tub', name: 'Sauce Tub', inventoryMode: 'RECIPE_BASED', bomItems: [on(FROZEN, 500)], shelf: null },
    { id: 'p-water', name: 'Bottled Water', inventoryMode: 'UNIT_BASED', bomItems: [], shelf: { quantity: 40, lowStockAlert: null } },
  ];
  const STOCK = [
    { branchId: BRANCH, rawMaterialId: MILK.id, quantity: 3000 },
    { branchId: BRANCH, rawMaterialId: BEANS.id, quantity: 900 },
    { branchId: BRANCH, rawMaterialId: FROZEN.id, quantity: 2000 },
    { branchId: OTHER, rawMaterialId: MILK.id, quantity: 99999 },
    { branchId: OTHER, rawMaterialId: FROZEN.id, quantity: 99999 },
  ];

  interface Ticket {
    productId: string; quantity: number; branchId?: string; status?: string;
    refundedQty?: number; usageOnReady?: boolean; usagePostedAt?: Date | null; tenantId?: string;
  }
  const inList = (value: unknown, cond: any) =>
    cond === undefined || (cond && typeof cond === 'object' && 'in' in cond ? cond.in.includes(value) : value === cond);

  function build(tickets: Ticket[]) {
    const rows = tickets.map((t) => ({
      branchId: BRANCH, status: 'PAID', refundedQty: 0, usageOnReady: true, usagePostedAt: null, tenantId: TENANT, ...t,
    }));
    const prisma: any = {
      tenant:        { findUnique: jest.fn().mockResolvedValue({ allowSaleWhenOutOfStock: false }) },
      customer:      { findFirst: jest.fn().mockResolvedValue(null) },
      priceListItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierGroup: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterial:   { findMany: jest.fn().mockResolvedValue([]) },
      product: {
        findMany: jest.fn(({ include }: any) => Promise.resolve(MENU.map((p) => ({
          id: p.id, name: p.name, tenantId: TENANT, isActive: true, price: 100, costPrice: null,
          categoryId: null, category: null, modifierGroups: [], variants: [],
          inventoryMode: p.inventoryMode, bomItems: p.bomItems,
          inventory: include.inventory && p.shelf ? [p.shelf] : [],
        })))),
      },
      rawMaterialInventory: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(STOCK
          .filter((s) => inList(s.branchId, where.branchId) && inList(s.rawMaterialId, where.rawMaterialId)))),
      },
      // The ready sauce is one frozen tub moved across, 2000 g for 2000 g.
      subRecipeItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(where.parentRawMaterialId.in.includes(SAUCE.id)
          ? [{ parentRawMaterialId: SAUCE.id, quantity: 2000, parent: { batchYield: 2000, _count: { subRecipeItems: 1 } }, rawMaterial: { id: FROZEN.id, name: FROZEN.name, unit: FROZEN.unit } }]
          : [])),
      },
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(rows
          .filter((r) => r.usageOnReady === where.usageOnReady && r.usagePostedAt === where.usagePostedAt)
          .filter((r) => r.tenantId === where.order.tenantId && inList(r.status, where.order.status) && inList(r.branchId, where.order.branchId))
          .map((r) => ({
            productId: r.productId, variantId: null, quantity: r.quantity, refundedQty: r.refundedQty,
            modifiers: [], order: { branchId: r.branchId },
          })))),
      },
      bomItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(MENU
          .filter((p) => where.productId.in.includes(p.id))
          .flatMap((p) => p.bomItems.map((b) => ({ productId: p.id, ...b }))))),
      },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { svc: new ProductsService(prisma), prisma };
  }

  const tile = async (tickets: Ticket[], id: string) => {
    const tiles: any[] = await build(tickets).svc.findForPos(TENANT, BRANCH);
    return tiles.find((t) => t.id === id);
  };
  const row = async (tickets: Ticket[], id: string, branchId: string | undefined = BRANCH) => {
    const rows: any[] = await build(tickets).svc.findAll(TENANT, false, branchId);
    return rows.find((r) => r.id === id);
  };

  describe('the till (findForPos)', () => {
    it('with nothing waiting, the tile reads the book and says nothing about holds', async () => {
      const latte = await tile([], 'p-latte');
      expect(latte).toMatchObject({ maxProducible: 20, isLowStock: false, isOutOfStock: false });
      expect(latte.limitedBy).toEqual({ rawMaterialId: MILK.id, name: MILK.name, unit: 'ml', stock: 3000, perUnit: 150 });
    });

    it('six lattes waiting at this branch take six off the tile, and the limit says how much is held', async () => {
      const latte = await tile([{ productId: 'p-latte', quantity: 6 }], 'p-latte');
      // 3000 - 6 x 150 = 2100 free -> 14.
      expect(latte.maxProducible).toBe(14);
      expect(latte.limitedBy).toMatchObject({ rawMaterialId: MILK.id, stock: 2100, perUnit: 150, held: 900 });
    });

    it('low stock and out of stock follow what is free, not the book', async () => {
      // 17 waiting: 450 ml free -> 3 left, low.
      expect(await tile([{ productId: 'p-latte', quantity: 17 }], 'p-latte'))
        .toMatchObject({ maxProducible: 3, isLowStock: true, isOutOfStock: false });
      // 20 waiting: every drop spoken for -> the tile is disabled.
      expect(await tile([{ productId: 'p-latte', quantity: 12 }, { productId: 'p-latte', quantity: 8 }], 'p-latte'))
        .toMatchObject({ maxProducible: 0, isLowStock: true, isOutOfStock: true, limitedBy: { stock: 0, held: 3000 } });
      // More held than on the books never goes below zero.
      expect(await tile([{ productId: 'p-latte', quantity: 25 }], 'p-latte'))
        .toMatchObject({ maxProducible: 0, limitedBy: { stock: 0, held: 3750 } });
    });

    it('a ticket at another branch, a voided order, a confirmed line or a refunded one holds nothing here', async () => {
      const latte = await tile([
        { productId: 'p-latte', quantity: 6, branchId: OTHER },
        { productId: 'p-latte', quantity: 6, status: 'VOIDED' },
        { productId: 'p-latte', quantity: 6, usagePostedAt: new Date('2026-09-15T02:00:00Z') },
        { productId: 'p-latte', quantity: 6, usageOnReady: false },
        { productId: 'p-latte', quantity: 6, refundedQty: 6 },
      ], 'p-latte');
      expect(latte.maxProducible).toBe(20);
      expect(latte.limitedBy).not.toHaveProperty('held');
    });

    it('a size ceiling carries the hold too', async () => {
      const { svc, prisma } = build([{ productId: 'p-latte', quantity: 6 }]);
      prisma.product.findMany.mockResolvedValue([{
        id: 'p-iced', name: 'Iced Latte', tenantId: TENANT, isActive: true, price: 120, categoryId: null, category: null,
        modifierGroups: [], inventory: [], inventoryMode: 'RECIPE_BASED', bomItems: [],
        variants: [{ id: 'v16', variantBomItems: [on(MILK, 300)] }],
      }]);
      const [iced]: any[] = await svc.findForPos(TENANT, BRANCH);
      // 2100 free / 300 = 7.
      expect(iced.variantCeilings).toEqual([{ variantId: 'v16', maxProducible: 7, limitedBy: expect.objectContaining({ stock: 2100, held: 900 }) }]);
      expect(iced).toMatchObject({ maxProducible: 7, limitedBy: { held: 900 } });
    });

    it('a parked tub a waiting ticket counts on is not offered as a whole move; one held elsewhere is', async () => {
      // No waiting tub: 2000 g parked covers the 2000 g move.
      expect((await tile([], 'p-spag')).limitedBy.backup).toEqual({ rawMaterialId: FROZEN.id, name: FROZEN.name, unit: 'g', onHand: 2000 });
      // A tub waiting at this branch holds 500 g: 1500 g free is a part tub.
      expect((await tile([{ productId: 'p-tub', quantity: 1 }], 'p-spag')).limitedBy.backup).toBeUndefined();
      // The same ticket at another branch or voided holds nothing here; the hint shows the tub that is physically there.
      const elsewhere = await tile([{ productId: 'p-tub', quantity: 1, branchId: OTHER }, { productId: 'p-tub', quantity: 1, status: 'VOIDED' }], 'p-spag');
      expect(elsewhere.limitedBy.backup).toMatchObject({ rawMaterialId: FROZEN.id, onHand: 2000 });
    });

    it('asks for the holds of this branch only', async () => {
      const { svc, prisma } = build([]);
      await svc.findForPos(TENANT, BRANCH);
      expect(prisma.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ order: expect.objectContaining({ tenantId: TENANT, branchId: { in: [BRANCH] } }) }),
      }));
    });
  });

  describe('the products table (findAll)', () => {
    it('with nothing waiting, the recipe ceiling and the low-stock mark are unchanged', async () => {
      expect(await row([], 'p-latte')).toMatchObject({ stockQty: 20, isLowStock: false });
    });

    it('a waiting ticket at this branch lowers the ceiling and can make it low, the same number the till shows', async () => {
      const tickets = [{ productId: 'p-latte', quantity: 17 }];
      const latte = await row(tickets, 'p-latte');
      expect(latte).toMatchObject({ stockQty: 3, isLowStock: true });
      expect(latte.stockQty).toBe((await tile(tickets, 'p-latte')).maxProducible);
    });

    it('a ticket at another branch or of a voided order does not', async () => {
      expect(await row([
        { productId: 'p-latte', quantity: 17, branchId: OTHER },
        { productId: 'p-latte', quantity: 17, status: 'VOIDED' },
      ], 'p-latte')).toMatchObject({ stockQty: 20, isLowStock: false });
    });

    it('shelf stock is the book quantity whatever waits', async () => {
      expect(await row([{ productId: 'p-latte', quantity: 17 }], 'p-water')).toMatchObject({ stockQty: 40 });
    });

    it('with no branch in scope there is no ceiling, and no holds are read', async () => {
      const { svc, prisma } = build([{ productId: 'p-latte', quantity: 17 }]);
      const rows: any[] = await svc.findAll(TENANT, false, undefined);
      expect(rows.find((r) => r.id === 'p-latte')).toMatchObject({ stockQty: null, isLowStock: false });
      expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
    });
  });
});
