import { InventoryService } from './inventory.service';
import { IN_A_RECIPE, idsInARecipe } from './recipe-use';

/**
 * Twin ingredient records, and the purchase that lands on the wrong one.
 *
 * Carolina's shop has 375 active ingredients and 281 of them are in no recipe,
 * prep, size or add-on. "Ice Cubes" (kg) and "Ice Cubes + Delivery" (kg) sit
 * beside the "Ice" (g) that 48 drinks are made with. Deliveries go onto the
 * name on the receipt, so the ice bought each morning went onto a record no
 * recipe reads: Ice never went up, and with "sell when out of stock" off the
 * till refused every iced drink while the freezer was full.
 *
 * Deactivating the twins is a data job for before day 1 -- and cannot simply
 * be "deactivate everything unused", because cups, lids, bleach and Gasul are
 * bought through the same screens. What the code can do is say which record
 * the recipes actually read, so the purchase screens offer that one first.
 */
describe('which ingredients a live recipe uses', () => {
  it('counts a recipe, a size, an add-on and a prep -- and only live ones', () => {
    // Four ways an ingredient reaches a plate. Miss one and its record looks
    // unused, gets ranked down, and the shop is pushed toward the twin.
    const ways = IN_A_RECIPE.OR as any[];
    expect(ways).toHaveLength(4);
    expect(ways[0].bomItems.some.product).toEqual({ isActive: true });
    expect(ways[1].variantBomItems.some.variant).toEqual({ isActive: true, product: { isActive: true } });
    expect(ways[2].modifierIngredientLinks.some.option).toEqual({ isActive: true });
    expect(ways[3].usedInSubRecipes.some.parent).toEqual({ isActive: true });
  });

  it('asks about one shop, and hands back a set that is quick to ask', async () => {
    const db: any = { rawMaterial: { findMany: jest.fn().mockResolvedValue([{ id: 'ice' }, { id: 'beans' }]) } };
    const ids = await idsInARecipe(db, 't1');
    expect(db.rawMaterial.findMany).toHaveBeenCalledWith({
      where:  { tenantId: 't1', ...IN_A_RECIPE },
      select: { id: true },
    });
    expect(ids.has('ice')).toBe(true);
    expect(ids.has('ice-cubes')).toBe(false);
  });

  it('can be narrowed to the few ids a caller is asking about', async () => {
    const db: any = { rawMaterial: { findMany: jest.fn().mockResolvedValue([]) } };
    await idsInARecipe(db, 't1', ['a', 'b']);
    expect(db.rawMaterial.findMany.mock.calls[0][0].where.id).toEqual({ in: ['a', 'b'] });
  });
});

describe('GET /inventory/raw-materials says which records the recipes read', () => {
  const ITEMS = [
    { id: 'ice',       name: 'Ice',       unit: 'g',  costPrice: 0.0015, lowStockAlert: null },
    { id: 'ice-cubes', name: 'Ice Cubes', unit: 'kg', costPrice: 1.5,    lowStockAlert: null },
  ];

  function build(inRecipe: string[]) {
    const prisma: any = {
      rawMaterial: {
        findMany: jest.fn(async (args: any) =>
          // The two calls are told apart by what they ask for: the list asks
          // for the shop's ingredients, the flag asks which are in a recipe.
          args.select?.id && args.where.OR
            ? inRecipe.map((id) => ({ id }))
            : ITEMS.map((m) => ({ ...m }))),
      },
    };
    return new InventoryService(prisma, { assertDateIsOpen: jest.fn() } as any) as any;
  }

  it('marks the record 48 drinks use, and leaves the twin unmarked', async () => {
    const rows = await build(['ice']).listRawMaterials('t1');
    expect(rows.map((r: any) => [r.name, r.inRecipe]))
      .toEqual([['Ice', true], ['Ice Cubes', false]]);
  });

  it('still returns every active ingredient -- the twin is ranked, not hidden', async () => {
    const rows = await build(['ice']).listRawMaterials('t1');
    expect(rows).toHaveLength(2);
  });
});
