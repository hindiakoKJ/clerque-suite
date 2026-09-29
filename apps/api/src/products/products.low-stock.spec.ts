import { ProductsService } from './products.service';

/**
 * When the tile turns amber.
 *
 * A recipe product has no shelf row of its own, so its LOW badge fell back
 * to "5 cups left" -- minutes of runway -- whatever reorder point the owner
 * had set on the milk. The ingredient that sets the ceiling now brings its
 * own reorder level, and the badge follows it, on the till and in the
 * products table alike. A per-product threshold in servings still counts,
 * and with no threshold anywhere the default stays at five.
 */
describe('ProductsService -- the LOW badge follows the limiting ingredient\'s reorder point', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const CUP = 150;  // ml of milk a latte takes

  function build(opts: { milk: number; reorder?: number | null; cupsAlert?: number | null; shelf?: { quantity: number; lowStockAlert: number | null } }) {
    const milk = { id: 'rm-milk', name: 'Full Cream Milk', unit: 'ml', lowStockAlert: opts.reorder ?? null };
    const products = [
      { id: 'p-latte', name: 'Latte', price: 139, isActive: true, categoryId: null, inventoryMode: 'RECIPE_BASED', variants: [], modifierGroups: [],
        inventory: opts.cupsAlert != null ? [{ quantity: 0, lowStockAlert: opts.cupsAlert }] : [],
        bomItems: [{ rawMaterialId: milk.id, quantity: CUP, rawMaterial: milk }] },
      ...(opts.shelf
        ? [{ id: 'p-water', name: 'Bottled Water', price: 25, isActive: true, categoryId: null, inventoryMode: 'UNIT_BASED', variants: [], modifierGroups: [],
             inventory: [opts.shelf], bomItems: [] }]
        : []),
    ];
    const prisma: any = {
      tenant:               { findUnique: jest.fn().mockResolvedValue({ allowSaleWhenOutOfStock: false }) },
      customer:             { findFirst: jest.fn().mockResolvedValue(null) },
      priceListItem:        { findMany: jest.fn().mockResolvedValue([]) },
      product:              { findMany: jest.fn().mockResolvedValue(products) },
      modifierGroup:        { findMany: jest.fn().mockResolvedValue([]) },
      // The table's own lookup of each ingredient (cost and reorder point).
      rawMaterial:          { findMany: jest.fn().mockResolvedValue([{ id: milk.id, costPrice: null, lowStockAlert: milk.lowStockAlert }]) },
      rawMaterialInventory: { findMany: jest.fn().mockResolvedValue([{ rawMaterialId: milk.id, quantity: opts.milk }]) },
      subRecipeItem:        { findMany: jest.fn().mockResolvedValue([]) },
      orderItem:            { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new ProductsService(prisma);
  }
  const tile = async (opts: Parameters<typeof build>[0], id = 'p-latte') =>
    ((await build(opts).findForPos(TENANT, BRANCH)) as any[]).find((t) => t.id === id);
  const row = async (opts: Parameters<typeof build>[0], id = 'p-latte') =>
    ((await build(opts).findAll(TENANT, false, BRANCH)) as any[]).find((r) => r.id === id);

  it('with a reorder point on the milk, the badge comes on when the milk reaches it -- not at five cups', async () => {
    // 1,800 ml is twelve cups: more than five, but under the 2,000 ml the owner asked to be told at.
    expect(await tile({ milk: 12 * CUP, reorder: 2000 })).toMatchObject({ maxProducible: 12, isLowStock: true, limitedBy: { name: 'Full Cream Milk', stock: 1800, reorderLevel: 2000 } });
    // 3,000 ml is above it: nothing to say yet.
    expect(await tile({ milk: 20 * CUP, reorder: 2000 })).toMatchObject({ maxProducible: 20, isLowStock: false });
    // Exactly at the point counts, the same way the buy list counts it.
    expect(await tile({ milk: 2000, reorder: 2000 })).toMatchObject({ isLowStock: true });
  });

  it('with no reorder point the default stays at five cups, and the limit carries no reorder level', async () => {
    const low = await tile({ milk: 4 * CUP });
    expect(low).toMatchObject({ maxProducible: 4, isLowStock: true });
    expect(low.limitedBy).not.toHaveProperty('reorderLevel');
    expect(await tile({ milk: 6 * CUP })).toMatchObject({ maxProducible: 6, isLowStock: false });
  });

  it('a reorder point far below never hides the last few cups', async () => {
    // Told at 100 ml, but four cups left is still worth saying.
    expect(await tile({ milk: 4 * CUP, reorder: 100 })).toMatchObject({ maxProducible: 4, isLowStock: true });
  });

  it('a per-product threshold in servings still counts, either way round', async () => {
    // Ten cups asked for: twelve is fine by the cups, but the milk is under its own point.
    expect(await tile({ milk: 12 * CUP, reorder: 2000, cupsAlert: 10 })).toMatchObject({ isLowStock: true });
    // Ten cups asked for, eight left, milk comfortably above its point: the cups rule fires.
    expect(await tile({ milk: 8 * CUP, reorder: 500, cupsAlert: 10 })).toMatchObject({ isLowStock: true });
    // Two cups asked for, four left, milk above its point: the owner said two, so not yet.
    expect(await tile({ milk: 4 * CUP, reorder: 100, cupsAlert: 2 })).toMatchObject({ isLowStock: false });
  });

  it('shelf stock is unchanged: its own row decides', async () => {
    expect(await tile({ milk: 3000, shelf: { quantity: 3, lowStockAlert: null } }, 'p-water')).toMatchObject({ maxProducible: 3, isLowStock: true });
    expect(await tile({ milk: 3000, shelf: { quantity: 8, lowStockAlert: null } }, 'p-water')).toMatchObject({ maxProducible: 8, isLowStock: false });
    expect(await tile({ milk: 3000, shelf: { quantity: 8, lowStockAlert: 10 } }, 'p-water')).toMatchObject({ maxProducible: 8, isLowStock: true });
  });

  it('the products table shows the same badge the till does', async () => {
    expect(await row({ milk: 12 * CUP, reorder: 2000 })).toMatchObject({ stockQty: 12, isLowStock: true });
    expect(await row({ milk: 20 * CUP, reorder: 2000 })).toMatchObject({ stockQty: 20, isLowStock: false });
    expect(await row({ milk: 4 * CUP })).toMatchObject({ stockQty: 4, isLowStock: true });
    expect(await row({ milk: 6 * CUP })).toMatchObject({ stockQty: 6, isLowStock: false });
  });
});
