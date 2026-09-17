import { stationItems, UNROUTED } from './station-items';

/**
 * Which rows each station's daily sheet shows.
 *
 * The fake database applies the active-only filters the real queries send, so
 * an inactive product, size or add-on that leaked onto a sheet shows up here.
 */
describe('stationItems -- which stocked items belong on which station', () => {
  const T = 't1';

  const stations = [
    { id: 's-kitchen', tenantId: T, name: 'Kitchen', kind: 'KITCHEN', isActive: true, sortOrder: 1 },
    { id: 's-bar', tenantId: T, name: 'Bar', kind: 'BAR', isActive: true, sortOrder: 2 },
    { id: 's-pastry', tenantId: T, name: 'Pastry', kind: 'PASTRY_PASS', isActive: true, sortOrder: 3 },
    { id: 's-cold', tenantId: T, name: 'Cold bar', kind: 'COLD_BAR', isActive: true, sortOrder: 4 },
    { id: 's-hot', tenantId: T, name: 'Hot bar', kind: 'HOT_BAR', isActive: true, sortOrder: 5 },
    { id: 's-counter', tenantId: T, name: 'Counter', kind: 'COUNTER', isActive: true, sortOrder: 6 },
    { id: 's-old', tenantId: T, name: 'Old kitchen', kind: 'KITCHEN', isActive: false, sortOrder: 7 },
    { id: 's-other-shop', tenantId: 't2', name: 'Kitchen', kind: 'KITCHEN', isActive: true, sortOrder: 1 },
  ];
  const categories: Record<string, string | null> = { 'c-food': 's-kitchen', 'c-drinks': 's-bar', 'c-misc': null, 'c-old': 's-old' };
  const products = [
    { id: 'p-pasta', tenantId: T, categoryId: 'c-food', isActive: true },
    { id: 'p-latte', tenantId: T, categoryId: 'c-drinks', isActive: true },
    { id: 'p-retired', tenantId: T, categoryId: 'c-food', isActive: false },
    { id: 'p-cookie', tenantId: T, categoryId: 'c-misc', isActive: true },
    { id: 'p-legacy', tenantId: T, categoryId: 'c-old', isActive: true },
  ];
  const bom = [
    { productId: 'p-pasta', rawMaterialId: 'rm-pasta' },
    { productId: 'p-pasta', rawMaterialId: 'rm-sauce' },
    { productId: 'p-pasta', rawMaterialId: 'rm-milk' },
    { productId: 'p-latte', rawMaterialId: 'rm-milk' },
    { productId: 'p-latte', rawMaterialId: 'rm-espresso' },
    { productId: 'p-retired', rawMaterialId: 'rm-retired-only' },
    { productId: 'p-cookie', rawMaterialId: 'rm-flour' },
    { productId: 'p-legacy', rawMaterialId: 'rm-legacy' },
  ];
  const variants = [
    { id: 'v-large', productId: 'p-pasta', isActive: true, bom: ['rm-cheese'] },
    { id: 'v-gold', productId: 'p-pasta', isActive: false, bom: ['rm-truffle'] },
  ];
  const groups = [
    // Attached to the pasta by hand.
    { id: 'g-top', tenantId: T, isActive: true, categoryId: null, products: ['p-pasta'] },
    // Bound to the whole food category.
    { id: 'g-spice', tenantId: T, isActive: true, categoryId: 'c-food', products: [] },
    { id: 'g-off', tenantId: T, isActive: false, categoryId: 'c-food', products: ['p-pasta'] },
  ];
  const addOns = [
    { groupId: 'g-top', optionActive: true, rawMaterialId: 'rm-parmesan', quantity: 10 },
    { groupId: 'g-spice', optionActive: true, rawMaterialId: 'rm-chili', quantity: 2 },
    { groupId: 'g-spice', optionActive: false, rawMaterialId: 'rm-gold-leaf', quantity: 1 },
    { groupId: 'g-top', optionActive: true, rawMaterialId: 'rm-swapped-out', quantity: -200 },
    { groupId: 'g-off', optionActive: true, rawMaterialId: 'rm-off-group', quantity: 5 },
  ];
  // Three preps deep, with a loop back to the top (a recipe mistake that must not hang the sheet).
  const recipes = [
    { parentRawMaterialId: 'rm-sauce', rawMaterialId: 'rm-base' },
    { parentRawMaterialId: 'rm-sauce', rawMaterialId: 'rm-salt' },
    { parentRawMaterialId: 'rm-base', rawMaterialId: 'rm-tomato' },
    { parentRawMaterialId: 'rm-base', rawMaterialId: 'rm-stock' },
    { parentRawMaterialId: 'rm-stock', rawMaterialId: 'rm-bones' },
    { parentRawMaterialId: 'rm-stock', rawMaterialId: 'rm-sauce' },
  ];
  const ING = (id: string, over: Partial<{ category: string; isActive: boolean }> = {}) =>
    ({ id, tenantId: T, name: id.replace('rm-', ''), unit: 'g', category: 'INGREDIENT', isActive: true, ...over });
  const rawMaterials = [
    ...['rm-pasta', 'rm-sauce', 'rm-base', 'rm-stock', 'rm-salt', 'rm-tomato', 'rm-bones', 'rm-milk', 'rm-espresso', 'rm-retired-only',
      'rm-flour', 'rm-legacy', 'rm-cheese', 'rm-truffle', 'rm-parmesan', 'rm-chili', 'rm-gold-leaf', 'rm-swapped-out', 'rm-off-group'].map((id) => ING(id)),
    ING('rm-foil', { category: 'KITCHEN_SUPPLY' }),
    ING('rm-cups', { category: 'BAR_SUPPLY' }),
    ING('rm-paper', { category: 'OFFICE_SUPPLY' }),
    ING('rm-gone', { isActive: false }),
  ];

  function build() {
    const activeProduct = (id: string, w: any) => products.some((p) => p.id === id && p.tenantId === w.tenantId && p.isActive === w.isActive);
    return {
      product: {
        findMany: jest.fn(async ({ where }: any) => products
          .filter((p) => p.tenantId === where.tenantId && p.isActive === where.isActive)
          .map((p) => ({ id: p.id, categoryId: p.categoryId, category: { stationId: categories[p.categoryId] } }))),
      },
      bomItem: { findMany: jest.fn(async ({ where }: any) => bom.filter((b) => activeProduct(b.productId, where.product))) },
      variantBomItem: {
        findMany: jest.fn(async ({ where }: any) => variants
          .filter((v) => v.isActive === where.variant.isActive && activeProduct(v.productId, where.variant.product))
          .flatMap((v) => v.bom.map((rawMaterialId) => ({ rawMaterialId, variant: { productId: v.productId } })))),
      },
      modifierOptionIngredient: {
        findMany: jest.fn(async ({ where }: any) => addOns
          .filter((a) => a.quantity > where.quantity.gt && a.optionActive === where.option.isActive)
          .map((a) => ({ a, g: groups.find((g) => g.id === a.groupId)! }))
          .filter(({ g }) => g.isActive === where.option.group.isActive && g.tenantId === where.option.group.tenantId)
          .map(({ a, g }) => ({
            rawMaterialId: a.rawMaterialId,
            option: { group: { categoryId: g.categoryId, products: g.products.map((productId) => ({ productId })) } },
          }))),
      },
      subRecipeItem: { findMany: jest.fn(async () => recipes) },
      rawMaterial: {
        findMany: jest.fn(async ({ where }: any) => rawMaterials
          .filter((r) => r.tenantId === where.tenantId && r.isActive === where.isActive)
          .map((r) => ({ ...r, subRecipeItems: recipes.some((x) => x.parentRawMaterialId === r.id) ? [{ id: 'x' }] : [] }))),
      },
      station: { findMany: jest.fn(async ({ where }: any) => stations.filter((s) => s.tenantId === where.tenantId)) },
    } as any;
  }
  const onOf = async (id: string) => [...((await stationItems(build(), T)).items.get(id)?.on ?? [])].sort();

  it('a kitchen product brings its recipe, its size\'s recipe, and add-ons attached to it or bound to its category', async () => {
    for (const id of ['rm-pasta', 'rm-sauce', 'rm-cheese', 'rm-parmesan', 'rm-chili']) expect(await onOf(id)).toEqual(['s-kitchen']);
  });

  it('walks down through pre-made items to any depth, and a recipe loop does not hang it', async () => {
    for (const id of ['rm-base', 'rm-salt', 'rm-tomato', 'rm-stock', 'rm-bones']) expect(await onOf(id)).toEqual(['s-kitchen']);
    const { items } = await stationItems(build(), T);
    expect(items.get('rm-sauce')?.isPrep).toBe(true);
    expect(items.get('rm-stock')?.isPrep).toBe(true);
    expect(items.get('rm-bones')?.isPrep).toBe(false);
  });

  it('an ingredient only the bar uses is not on the kitchen; one both use is on both', async () => {
    expect(await onOf('rm-espresso')).toEqual(['s-bar']);
    expect(await onOf('rm-milk')).toEqual(['s-bar', 's-kitchen']);
  });

  it('supplies go by their side of the shop: kitchen supplies on kitchen and pastry, bar supplies on the four bar kinds, office on none', async () => {
    expect(await onOf('rm-foil')).toEqual(['s-kitchen', 's-pastry']);
    expect(await onOf('rm-cups')).toEqual(['s-bar', 's-cold', 's-counter', 's-hot']);
    expect(await onOf('rm-paper')).toEqual([]);
  });

  it('leaves out an inactive product, size, add-on option or add-on group, an add-on that takes nothing, and an inactive item', async () => {
    for (const id of ['rm-retired-only', 'rm-truffle', 'rm-gold-leaf', 'rm-swapped-out', 'rm-off-group']) expect(await onOf(id)).toEqual([]);
    const { items } = await stationItems(build(), T);
    expect(items.has('rm-gone')).toBe(false);
  });

  it('a product whose category routes nowhere, or to a station that was switched off, is Not routed', async () => {
    expect(await onOf('rm-flour')).toEqual([UNROUTED]);
    expect(await onOf('rm-legacy')).toEqual([UNROUTED]);
  });

  it('lists only this shop\'s active stations, with their names and kinds', async () => {
    const { stations: listed } = await stationItems(build(), T);
    expect(listed.map((s) => s.id)).toEqual(['s-kitchen', 's-bar', 's-pastry', 's-cold', 's-hot', 's-counter']);
    expect(listed[0]).toEqual({ id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' });
  });
});
