import { ProductsService } from './products.service';
import { productCeiling, ceilingOf, servingsOf } from './recipe-ceiling';

/**
 * The POS tile's "N left" and the buy list's "menu can sell now" are one
 * rule. These cases pin what the till shows today, and prove the shared
 * helper gives the same answer for the same rows.
 */
describe('recipe ceiling', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const rm = (id: string, name: string, unit = 'ml') => ({ id, name, unit });
  const MILK = rm('rm-milk', 'Full Cream Milk');
  const BEANS = rm('rm-beans', 'Coffee Beans', 'g');
  const SAUCE = rm('rm-sauce', 'Spaghetti Sauce', 'g');

  const PRODUCTS = [
    // Plain recipe: milk runs out first (3000/150 = 20; beans 900/18 = 50).
    { id: 'latte', name: 'Latte', inventoryMode: 'RECIPE_BASED', inventory: [], modifierGroups: [], variants: [],
      bomItems: [{ rawMaterialId: MILK.id, quantity: 150, rawMaterial: MILK }, { rawMaterialId: BEANS.id, quantity: 18, rawMaterial: BEANS }] },
    // Recipes only on the sizes: the best size is the ceiling.
    { id: 'americano', name: 'Americano', inventoryMode: 'RECIPE_BASED', inventory: [], modifierGroups: [], bomItems: [],
      variants: [
        { id: 'v12', variantBomItems: [{ rawMaterialId: BEANS.id, quantity: 18, rawMaterial: BEANS }] },
        { id: 'v16', variantBomItems: [{ rawMaterialId: BEANS.id, quantity: 36, rawMaterial: BEANS }] },
        { id: 'vnone', variantBomItems: [] },
      ] },
    // No recipe anywhere: can make nothing.
    { id: 'mystery', name: 'Mystery', inventoryMode: 'RECIPE_BASED', inventory: [], modifierGroups: [], bomItems: [], variants: [] },
    // An ingredient with no stock row at all counts as zero.
    { id: 'spag', name: 'Spaghetti', inventoryMode: 'RECIPE_BASED', inventory: [], modifierGroups: [], variants: [],
      bomItems: [{ rawMaterialId: SAUCE.id, quantity: 200, rawMaterial: SAUCE }, { rawMaterialId: MILK.id, quantity: 0, rawMaterial: MILK }] },
  ];
  const STOCK = [{ rawMaterialId: MILK.id, quantity: 3000 }, { rawMaterialId: BEANS.id, quantity: 900 }];
  const stockOf = (id: string) => Number(STOCK.find((s) => s.rawMaterialId === id)?.quantity ?? 0);

  async function tiles(extra: Record<string, any> = {}) {
    const prisma: any = {
      subRecipeItem: { findMany: jest.fn().mockResolvedValue([]) },
      ...extra,
      tenant: { findUnique: jest.fn().mockResolvedValue({ allowSaleWhenOutOfStock: false }) },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      priceListItem: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue(PRODUCTS.map((p) => ({ ...p, price: 100, isActive: true, categoryId: null }))) },
      modifierGroup: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: { findMany: jest.fn().mockResolvedValue(STOCK) },
      ...(extra.rawMaterialInventory ? { rawMaterialInventory: extra.rawMaterialInventory } : {}),
    };
    return new ProductsService(prisma).findForPos(TENANT, BRANCH);
  }

  it('the till: the first ingredient to run out sets the number, and names it', async () => {
    const [latte, americano, mystery, spag] = await tiles();
    expect(latte.maxProducible).toBe(20);
    expect(latte.limitedBy).toMatchObject({ rawMaterialId: MILK.id, name: 'Full Cream Milk', stock: 3000, perUnit: 150 });
    expect(americano.maxProducible).toBe(50);
    expect(americano.limitedBy).toMatchObject({ rawMaterialId: BEANS.id, perUnit: 18 });
    expect(americano.variantCeilings.map((v: any) => [v.variantId, v.maxProducible])).toEqual([['v12', 50], ['v16', 25]]);
    expect(mystery.maxProducible).toBe(0);
    expect(mystery.limitedBy).toBeNull();
    expect(spag.maxProducible).toBe(0);
    expect(spag.limitedBy).toMatchObject({ rawMaterialId: SAUCE.id, stock: 0 });
  });

  it('the shared rule gives the till\'s answer for every product', async () => {
    const shown = await tiles();
    PRODUCTS.forEach((p, i) => {
      const c = productCeiling(p, stockOf);
      expect([c.maxProducible, c.limitedBy, c.variantCeilings]).toEqual([shown[i].maxProducible, shown[i].limitedBy, shown[i].variantCeilings]);
    });
  });

  it('when the ingredient holding a dish back is a ready sauce with stock parked behind it, the till says so', async () => {
    // "needs Spaghetti Sauce" with 2 kg in the freezer: the count stays what is on the line; the hint says what to do.
    const inventory = { findMany: jest.fn(({ where }: any) => Promise.resolve(
      where.rawMaterialId.in.includes('frozen') && !where.rawMaterialId.in.includes(MILK.id)
        ? [{ rawMaterialId: 'frozen', quantity: 2000 }]
        : STOCK)) };
    const shown = await tiles({
      rawMaterialInventory: inventory,
      subRecipeItem: { findMany: jest.fn(({ where }: any) => Promise.resolve(where.parentRawMaterialId.in.includes(SAUCE.id)
        ? [{ parentRawMaterialId: SAUCE.id, quantity: 2000, parent: { batchYield: 2000, _count: { subRecipeItems: 1 } }, rawMaterial: { id: 'frozen', name: 'Spaghetti Sauce (frozen)', unit: 'g' } }]
        : [])) },
    });
    const spag: any = shown.find((t: any) => t.id === 'spag');
    expect(spag.maxProducible).toBe(0);
    expect(spag.limitedBy).toMatchObject({ rawMaterialId: SAUCE.id, backup: { name: 'Spaghetti Sauce (frozen)', unit: 'g', onHand: 2000 } });
    // Only where something is parked: milk has nothing behind it.
    expect((shown.find((t: any) => t.id === 'latte') as any).limitedBy.backup).toBeUndefined();
  });

  it('no hint for a sauce that is cooked from its base, or when less than a whole move is parked', async () => {
    const inventory = (qty: number) => ({ findMany: jest.fn(({ where }: any) => Promise.resolve(
      where.rawMaterialId.in.includes('frozen') && !where.rawMaterialId.in.includes(MILK.id) ? [{ rawMaterialId: 'frozen', quantity: qty }] : STOCK)) });
    const link = (over: object) => ({ subRecipeItem: { findMany: jest.fn().mockResolvedValue([{
      parentRawMaterialId: SAUCE.id, quantity: 2000, parent: { batchYield: 2000, _count: { subRecipeItems: 1 } },
      rawMaterial: { id: 'frozen', name: 'Spaghetti Sauce (frozen)', unit: 'g' }, ...over }]) } });
    // Cooked: made from the base plus cream, so it yields more than the base that goes in.
    const cooked = await tiles({ rawMaterialInventory: inventory(9000), ...link({ parent: { batchYield: 2400, _count: { subRecipeItems: 2 } } }) });
    expect((cooked.find((t: any) => t.id === 'spag') as any).limitedBy.backup).toBeUndefined();
    // A part tub: 1,500 g against a 2,000 g move cannot be recorded on the board.
    const part = await tiles({ rawMaterialInventory: inventory(1500), ...link({}) });
    expect((part.find((t: any) => t.id === 'spag') as any).limitedBy.backup).toBeUndefined();
  });

  it('a lookup that fails costs the hint, never the till', async () => {
    const shown = await tiles({ subRecipeItem: { findMany: jest.fn().mockRejectedValue(new Error('connection reset')) } });
    expect(shown.find((t: any) => t.id === 'latte')).toMatchObject({ maxProducible: 20, limitedBy: { name: 'Full Cream Milk' } });
  });

  it('decimal quantities give exact whole servings, not one short', () => {
    // Plain division: 1.2 / 0.4 = 2.9999999999999996, 0.6 / 0.1 = 5.999999999999999.
    expect([servingsOf(1.2, 0.4), servingsOf(0.6, 0.1), servingsOf(0.7, 0.1), servingsOf(2.3, 0.1)]).toEqual([3, 6, 7, 23]);
    expect([servingsOf(1.19, 0.4), servingsOf(0, 0.4), servingsOf(-600, 200)]).toEqual([2, 0, -3]);
    expect(servingsOf(125040, 300)).toBe(416);
    expect(ceilingOf([{ rawMaterialId: 'rice', quantity: '0.4000' }], () => 1.2).max).toBe(3);
  });

  it('a recipe whose every quantity is zero makes nothing and names nothing', () => {
    expect(ceilingOf([{ rawMaterialId: MILK.id, quantity: 0 }], stockOf)).toEqual({ max: 0, limitedBy: null });
  });
});
