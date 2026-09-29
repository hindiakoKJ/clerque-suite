import { ProductsService } from './products.service';

/**
 * An add-on whose ingredient has run out.
 *
 * A sale takes an option's own ingredients (oat milk for an oat latte), and
 * the sale side already refuses a drink it cannot make. But the tile's count
 * came from the product's recipe alone, so it read a green "20 left" while
 * the oat milk behind one of its options was at zero -- the cashier learned
 * at Charge. Each option now carries the same ceiling the tile does, so the
 * picker can grey it out and name what ran out.
 */
describe('ProductsService -- add-on ingredients on the till', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const rm = (id: string, name: string, unit = 'ml') => ({ id, name, unit, lowStockAlert: null });
  const MILK    = rm('rm-milk',    'Full Cream Milk');
  const OAT     = rm('rm-oat',     'Oat Milk');
  const BEANS   = rm('rm-beans',   'Coffee Beans', 'g');
  const VANILLA = rm('rm-vanilla', 'Vanilla Syrup');
  const ing = (x: ReturnType<typeof rm>, quantity: number) => ({ rawMaterialId: x.id, quantity, rawMaterial: x });
  const option = (id: string, name: string, ingredients: ReturnType<typeof ing>[], extra: Record<string, unknown> = {}) =>
    ({ id, name, isDefault: false, isActive: true, priceAdjustment: 0, recipeMultiplier: 1, sortOrder: 0, ingredients, ...extra });

  // Milk: Fresh takes nothing extra; Oat takes oat and gives the dairy back; Extra shot takes beans.
  const MILK_GROUP = {
    id: 'g-milk', name: 'Milk', required: false, multiSelect: false, minSelect: 0, maxSelect: 1, isActive: true, categoryId: null, sortOrder: 0,
    options: [
      option('o-fresh', 'Fresh', [], { isDefault: true }),
      option('o-oat',   'Oat',   [ing(OAT, 150), ing(MILK, -150)], { priceAdjustment: 20 }),
      option('o-shot',  'Extra shot', [ing(BEANS, 18)], { priceAdjustment: 30 }),
    ],
  };
  // Bound to the whole Drinks category rather than attached to the product.
  const SYRUP_GROUP = {
    id: 'g-syrup', name: 'Syrup', required: false, multiSelect: true, minSelect: 0, maxSelect: null, isActive: true, categoryId: 'cat-drinks', sortOrder: 1,
    options: [option('o-vanilla', 'Vanilla', [ing(VANILLA, 10)], { priceAdjustment: 15 })],
  };

  const PRODUCTS = [
    { id: 'p-latte', name: 'Latte', price: 139, isActive: true, categoryId: 'cat-drinks', category: { id: 'cat-drinks', name: 'Drinks' },
      inventoryMode: 'RECIPE_BASED', inventory: [], variants: [],
      bomItems: [ing(MILK, 150)],
      modifierGroups: [{ id: 'j1', productId: 'p-latte', modifierGroupId: MILK_GROUP.id, sortOrder: 0, modifierGroup: MILK_GROUP }] },
    // Shelf stock with an add-on: the syrup is still taken by the sale.
    { id: 'p-water', name: 'Bottled Water', price: 25, isActive: true, categoryId: 'cat-drinks', category: { id: 'cat-drinks', name: 'Drinks' },
      inventoryMode: 'UNIT_BASED', inventory: [{ quantity: 40, lowStockAlert: null }], variants: [], bomItems: [], modifierGroups: [] },
  ];
  // Oat milk at zero, vanilla with no stock row at all, everything else plentiful.
  const STOCK = [
    { rawMaterialId: MILK.id, quantity: 3000 },
    { rawMaterialId: OAT.id, quantity: 0 },
    { rawMaterialId: BEANS.id, quantity: 900 },
  ];

  function build(allowSaleWhenOutOfStock = false) {
    const prisma: any = {
      tenant:               { findUnique: jest.fn().mockResolvedValue({ allowSaleWhenOutOfStock }) },
      customer:             { findFirst: jest.fn().mockResolvedValue(null) },
      priceListItem:        { findMany: jest.fn().mockResolvedValue([]) },
      product:              { findMany: jest.fn().mockResolvedValue(PRODUCTS.map((p) => ({ ...p, modifierGroups: [...p.modifierGroups] }))) },
      modifierGroup:        { findMany: jest.fn().mockResolvedValue([SYRUP_GROUP]) },
      rawMaterialInventory: { findMany: jest.fn().mockResolvedValue(STOCK) },
      subRecipeItem:        { findMany: jest.fn().mockResolvedValue([]) },
      orderItem:            { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { svc: new ProductsService(prisma), prisma };
  }

  const optionsOf = (tile: any, groupId: string): any[] =>
    tile.modifierGroups.find((mg: any) => mg.modifierGroupId === groupId).modifierGroup.options;

  it('an option whose ingredient is at zero is out, named; one that adds nothing is never limited', async () => {
    const [latte]: any[] = await build().svc.findForPos(TENANT, BRANCH);
    // The tile itself still counts from the product's recipe.
    expect(latte).toMatchObject({ maxProducible: 20, isOutOfStock: false });

    const [fresh, oat, shot] = optionsOf(latte, MILK_GROUP.id);
    expect(fresh).toMatchObject({ id: 'o-fresh', maxProducible: null, isOutOfStock: false, limitedBy: null });
    expect(oat).toMatchObject({ id: 'o-oat', maxProducible: 0, isOutOfStock: true, limitedBy: { rawMaterialId: OAT.id, name: 'Oat Milk', stock: 0, perUnit: 150 } });
    // 900 g / 18 g = 50 shots.
    expect(shot).toMatchObject({ id: 'o-shot', maxProducible: 50, isOutOfStock: false, limitedBy: { name: 'Coffee Beans' } });
  });

  it('only what an option ADDS counts: giving the dairy back needs no dairy', async () => {
    const [latte]: any[] = await build().svc.findForPos(TENANT, BRANCH);
    const oat = optionsOf(latte, MILK_GROUP.id)[1];
    expect(oat.limitedBy.rawMaterialId).toBe(OAT.id);
    expect(oat.limitedBy.rawMaterialId).not.toBe(MILK.id);
  });

  it('a group bound to the category is judged too, and its ingredient stock is read with the rest', async () => {
    const { svc, prisma } = build();
    const [latte, water]: any[] = await svc.findForPos(TENANT, BRANCH);
    for (const tile of [latte, water]) {
      const [vanilla] = optionsOf(tile, SYRUP_GROUP.id);
      expect(vanilla).toMatchObject({ id: 'o-vanilla', maxProducible: 0, isOutOfStock: true, limitedBy: { name: 'Vanilla Syrup', stock: 0 } });
    }
    expect(prisma.rawMaterialInventory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ branchId: BRANCH, rawMaterialId: { in: expect.arrayContaining([MILK.id, OAT.id, BEANS.id, VANILLA.id]) } }),
    }));
  });

  it('the recipe lines stay on the server; the option carries only what the picker needs', async () => {
    const [latte]: any[] = await build().svc.findForPos(TENANT, BRANCH);
    for (const o of optionsOf(latte, MILK_GROUP.id)) expect(o).not.toHaveProperty('ingredients');
    expect(optionsOf(latte, MILK_GROUP.id)[1]).toMatchObject({ name: 'Oat', priceAdjustment: 20 });
  });

  it('the owner who sells past zero keeps the option pickable, and the real count is still told', async () => {
    const [latte]: any[] = await build(true).svc.findForPos(TENANT, BRANCH);
    expect(optionsOf(latte, MILK_GROUP.id)[1]).toMatchObject({ maxProducible: 0, isOutOfStock: false });
  });
});
