import { ProductsService } from '../products/products.service';
import { ProcureService } from './procure.service';

/**
 * The buy list's "the till shows N left" is the POS tile's own number.
 *
 * The other specs compare each side with the shared rule; this one gives the
 * real till (ProductsService.findForPos) and the real buy list
 * (ProcureService.get) ONE database that honours the filters each sends, so a
 * difference in what either side reads -- an inactive size, a product from
 * another shop, a switched-off product -- shows up as two different numbers.
 */
describe('buy list and till read the same menu', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const rm = (id: string, name: string, unit = 'g') => ({ id, name, unit });
  const SAUCE = rm('rm-sauce', 'Spaghetti Sauce');
  const NOODLES = rm('rm-noodle', 'Spaghetti Noodles');
  const BEANS = rm('rm-beans', 'Coffee Beans');
  const on = (x: { id: string; name: string; unit: string }, quantity: number) => ({ rawMaterialId: x.id, quantity, rawMaterial: x });
  const size = (id: string, name: string, isActive: boolean, bom: any[]) => ({ id, name, isActive, variantBomItems: bom });

  const PRODUCTS = [
    { id: 'p-spag', tenantId: TENANT, name: 'Spaghetti', isActive: true, inventoryMode: 'RECIPE_BASED', bomItems: [on(SAUCE, 200), on(NOODLES, 100)], variants: [], inventory: [] },
    { id: 'p-americano', tenantId: TENANT, name: 'Americano', isActive: true, inventoryMode: 'RECIPE_BASED', bomItems: [], inventory: [], variants: [
      size('v12', '12oz', true, [on(BEANS, 18)]),
      size('v16', '16oz', true, [on(BEANS, 36)]),
      // Switched off: a bigger ceiling if anyone read it.
      size('v8', '8oz', false, [on(BEANS, 9)]),
    ] },
    // The till counts this one as finished stock; its recipe still deducts on sale.
    { id: 'p-burger', tenantId: TENANT, name: 'Burger', isActive: true, inventoryMode: 'UNIT_BASED', bomItems: [on(SAUCE, 50)], variants: [], inventory: [{ branchId: BRANCH, quantity: 12, lowStockAlert: null }] },
    { id: 'p-old', tenantId: TENANT, name: 'Old Pasta', isActive: false, inventoryMode: 'RECIPE_BASED', bomItems: [on(SAUCE, 100)], variants: [], inventory: [] },
    { id: 'p-other', tenantId: 't2', name: 'Another Shop Spaghetti', isActive: true, inventoryMode: 'RECIPE_BASED', bomItems: [on(SAUCE, 10)], variants: [], inventory: [] },
  ];
  const STOCK = [
    { tenantId: TENANT, branchId: BRANCH, rawMaterialId: SAUCE.id, quantity: 2000 },
    { tenantId: TENANT, branchId: BRANCH, rawMaterialId: NOODLES.id, quantity: 300 },
    { tenantId: TENANT, branchId: BRANCH, rawMaterialId: BEANS.id, quantity: 900 },
    { tenantId: TENANT, branchId: 'b2', rawMaterialId: SAUCE.id, quantity: 99999 },
  ];
  const line = (id: string, x: { id: string; name: string; unit: string }, n: string) => ({
    id, lineNumber: `REQ-20260914-001-${n}`, rawMaterialId: x.id, qtyRequested: 1000, shortBy: null,
    packsBought: null, packSize: null, packCost: null, brandNote: null, receivedAt: null, rawMaterial: { ...x, costPrice: null },
  });
  const REQUEST = {
    id: 'req1', tenantId: TENANT, branchId: BRANCH, requestNumber: 'REQ-20260914-001', status: 'OPEN', notes: null,
    branch: { id: BRANCH, name: 'Main' }, lines: [line('l1', SAUCE, '01'), line('l2', BEANS, '02')],
  };

  const inList = (value: unknown, cond: any) => cond === undefined || (typeof cond === 'object' && cond && 'in' in cond ? cond.in.includes(value) : value === cond);
  const database: any = {
    tenant:   { findUnique: jest.fn().mockResolvedValue({ allowSaleWhenOutOfStock: false, showPurchaseCostsToStaff: true }) },
    customer: { findFirst: jest.fn().mockResolvedValue(null) },
    priceListItem: { findMany: jest.fn().mockResolvedValue([]) },
    modifierGroup: { findMany: jest.fn().mockResolvedValue([]) },
    product: {
      findMany: jest.fn(({ where, include, select }: any) => {
        const shape = include ?? select;
        const sizeWhere = shape.variants?.where ?? {};
        const usesAny = (p: any, or: any[]) => {
          const ids: string[] = or[0].bomItems.some.rawMaterialId.in;
          const sizeActive = or[1].variants.some.isActive;
          return p.bomItems.some((b: any) => ids.includes(b.rawMaterialId))
            || p.variants.some((v: any) => (sizeActive === undefined || v.isActive === sizeActive) && v.variantBomItems.some((b: any) => ids.includes(b.rawMaterialId)));
        };
        return Promise.resolve(PRODUCTS
          .filter((p) => p.tenantId === where.tenantId)
          .filter((p) => where.isActive === undefined || p.isActive === where.isActive)
          .filter((p) => where.inventoryMode === undefined || p.inventoryMode === where.inventoryMode)
          .filter((p) => !where.OR || usesAny(p, where.OR))
          .map((p) => ({
            ...p, price: 100, categoryId: null, category: null, modifierGroups: [],
            variants: p.variants.filter((v: any) => sizeWhere.isActive === undefined || v.isActive === sizeWhere.isActive),
            inventory: p.inventory.filter((i: any) => i.branchId === shape.inventory?.where?.branchId),
          })));
      }),
    },
    rawMaterialInventory: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(STOCK.filter((s) =>
        (where.tenantId === undefined || s.tenantId === where.tenantId) && inList(s.branchId, where.branchId) && inList(s.rawMaterialId, where.rawMaterialId)))),
    },
    purchaseRequest:          { findFirst: jest.fn(({ where }: any) => Promise.resolve(where.id === REQUEST.id && where.tenantId === TENANT ? REQUEST : null)) },
    purchaseRequestLine:      { findMany: jest.fn().mockResolvedValue([]) },
    cycleCount:               { findMany: jest.fn().mockResolvedValue([]) },
    cycleCountLine:           { findMany: jest.fn().mockResolvedValue([]) },
    subRecipeItem:            { findMany: jest.fn().mockResolvedValue([]) },
    modifierOptionIngredient: { findMany: jest.fn().mockResolvedValue([]) },
  };

  it('every recipe dish on the buy list shows the number its tile shows, and nothing the till does not sell', async () => {
    const till = await new ProductsService(database).findForPos(TENANT, BRANCH);
    const list = await new ProcureService(database, {} as any).get(TENANT, 'req1', 'BUSINESS_OWNER');
    const tileOf = (id: string) => till.find((t: any) => t.id === id)!;

    const [sauce, beans] = list.lines;
    expect(sauce.serves!.dishes.map((d) => d.name)).toEqual(['Spaghetti', 'Burger']);
    const spag = sauce.serves!.dishes.find((d) => d.name === 'Spaghetti')!;
    expect([spag.byThisItem, spag.sellableNow, spag.limitedBy]).toEqual([10, tileOf('p-spag').maxProducible, tileOf('p-spag').limitedBy!.name]);
    expect(spag.sellableNow).toBe(3);

    // Finished stock on the till (12 burgers); by its recipe the sauce still covers 40.
    const burger = sauce.serves!.dishes.find((d) => d.name === 'Burger')!;
    expect([burger.byThisItem, burger.sellableNow, burger.limitedBy]).toEqual([40, 40, null]);
    expect(tileOf('p-burger').maxProducible).toBe(12);

    // Each active size is its own dish at its own till number; the switched-off size is on neither.
    const tileSizes = tileOf('p-americano').variantCeilings;
    expect(tileSizes.map((v: any) => v.variantId)).toEqual(['v12', 'v16']);
    expect(beans.serves!.dishes.map((d) => [d.name, d.byThisItem, d.sellableNow])).toEqual([
      ['Americano (16oz)', 25, tileSizes.find((v: any) => v.variantId === 'v16')!.maxProducible],
      ['Americano (12oz)', 50, tileSizes.find((v: any) => v.variantId === 'v12')!.maxProducible],
    ]);
  });
});
