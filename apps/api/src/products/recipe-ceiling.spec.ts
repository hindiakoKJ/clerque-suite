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

  async function tiles() {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ allowSaleWhenOutOfStock: false }) },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      priceListItem: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue(PRODUCTS.map((p) => ({ ...p, price: 100, isActive: true, categoryId: null }))) },
      modifierGroup: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: { findMany: jest.fn().mockResolvedValue(STOCK) },
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
