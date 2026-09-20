import { ProductsService } from './products.service';
import { LedgerMetricsService } from '../ledger-metrics/ledger-metrics.service';
import { missingCostWhere, unpricedIngredientNames } from './missing-cost';

/**
 * A plate made of free ingredients.
 *
 * The till costs a recipe line at `rawMaterial.costPrice ?? 0`, so an
 * ingredient sitting at ₱0 -- or at no price at all -- is booked as free in
 * every dish it goes into. Buffalo Wings came out at ₱28.68 with four of its
 * eleven lines free; Honey Sriracha came out at ₱0.00. Gross profit on those
 * plates reads as the whole selling price.
 *
 * Nothing said so. "Products missing a cost" looked only at Product.costPrice
 * being null, and a recipe product's cost is recomputed as a number -- ₱0 is a
 * number -- so the count stayed at zero while the menu quietly lied. Both the
 * POS list and the Ledger dashboard count now use the one rule below.
 */

/** Is this ingredient priced? Blank and ₱0 are both "no". */
const unpriced = (rm: any) => rm == null || rm.costPrice == null || Number(rm.costPrice) <= 0;

/**
 * Applies the `where` the services hand Prisma to a plain product, so these
 * tests read as what a shop would see rather than as a query shape.
 */
function flagged(where: any, p: any): boolean {
  return where.OR.some((clause: any) => {
    if ('costPrice' in clause) return p.costPrice == null;
    if (clause.inventoryMode && p.inventoryMode !== clause.inventoryMode) return false;
    if (clause.bomItems) return (p.bomItems ?? []).some((b: any) => unpriced(b.rawMaterial));
    if (clause.variants) {
      return (p.variants ?? []).some(
        (v: any) => v.isActive && v.variantBomItems.some((b: any) => unpriced(b.rawMaterial)),
      );
    }
    return false;
  });
}

const dish = (over: any = {}) => ({
  name: 'Buffalo Wings', costPrice: 28.68, inventoryMode: 'RECIPE_BASED',
  bomItems: [{ rawMaterial: { name: 'Chicken wings', costPrice: 10.98 } }],
  variants: [],
  ...over,
});

describe('which products sell at a wrong cost', () => {
  const HOUSE_RECIPES = missingCostWhere('t1', true);

  it('flags a dish whose recipe has an ingredient at ₱0', () => {
    const wings = dish({ bomItems: [
      { rawMaterial: { name: 'Chicken wings', costPrice: 10.98 } },
      { rawMaterial: { name: 'Cayenne pepper', costPrice: 0 } },
    ] });
    expect(flagged(HOUSE_RECIPES, wings)).toBe(true);
    // The rule this replaced asked only whether the PRODUCT had a cost price.
    // Buffalo Wings has one -- ₱28.68, the wrong figure -- so it saw nothing.
    expect(wings.costPrice).not.toBeNull();
  });

  it('flags a dish whose recipe has an ingredient with no price at all', () => {
    const wings = dish({ bomItems: [{ rawMaterial: { name: 'Flour', costPrice: null } }] });
    expect(flagged(HOUSE_RECIPES, wings)).toBe(true);
  });

  it('flags a size whose own recipe has a free ingredient, even when the base one is priced', () => {
    const drink = dish({ variants: [{
      isActive: true,
      variantBomItems: [{ rawMaterial: { name: 'Honey', costPrice: 0 } }],
    }] });
    expect(flagged(HOUSE_RECIPES, drink)).toBe(true);
  });

  it('leaves a fully priced recipe alone', () => {
    expect(flagged(HOUSE_RECIPES, dish())).toBe(false);
  });

  it('still flags the old case: a product with no cost price of its own', () => {
    expect(flagged(HOUSE_RECIPES, dish({ costPrice: null, inventoryMode: 'UNIT_BASED' }))).toBe(true);
  });

  it('ignores ingredient prices on a shop that does not cost from recipes', () => {
    // Recipe cost switched off, product by product and shop-wide: the
    // ingredient price never reaches the plate, so a ₱0 there is not a leak.
    const off = missingCostWhere('t1', false);
    const unitPriced = dish({ inventoryMode: 'UNIT_BASED', bomItems: [{ rawMaterial: { name: 'Flour', costPrice: 0 } }] });
    expect(flagged(off, unitPriced)).toBe(false);
    // The same product on Recipe cost is flagged.
    expect(flagged(off, { ...unitPriced, inventoryMode: 'RECIPE_BASED' })).toBe(true);
  });

  it('asks only about this shop, and only about what is still on sale', () => {
    expect(HOUSE_RECIPES.tenantId).toBe('t1');
    expect(HOUSE_RECIPES.isActive).toBe(true);
  });
});

describe('naming the ingredients that have no price', () => {
  it('lists them once each, in order, from the recipe and its sizes', () => {
    expect(unpricedIngredientNames({
      inventoryMode: 'RECIPE_BASED',
      bomItems: [
        { rawMaterial: { name: 'Sriracha' } },
        { rawMaterial: { name: 'Cayenne pepper' } },
        { rawMaterial: { name: 'Sriracha' } },
      ],
      variants: [{ variantBomItems: [{ rawMaterial: { name: 'Honey' } }] }],
    }, true)).toEqual(['Cayenne pepper', 'Honey', 'Sriracha']);
  });

  it('names nothing when the plate is not costed from its recipe', () => {
    expect(unpricedIngredientNames({
      inventoryMode: 'UNIT_BASED',
      bomItems: [{ rawMaterial: { name: 'Flour' } }],
    }, false)).toEqual([]);
  });
});

describe('ProductsService.findMissingCost', () => {
  function build(tenant: any) {
    const seen: any[] = [];
    const prisma: any = {
      tenant:  { findUnique: jest.fn().mockResolvedValue(tenant) },
      product: {
        findMany: jest.fn(async (args: any) => {
          seen.push(args);
          return [{
            id: 'p1', name: 'Buffalo Wings', sku: 'BW', price: 150,
            category: { name: 'Wings' },
            inventoryMode: 'RECIPE_BASED',
            bomItems: [
              { rawMaterial: { name: 'Sriracha' } },
              { rawMaterial: { name: 'Cayenne pepper' } },
            ],
            variants: [],
          }];
        }),
      },
    };
    return { svc: new ProductsService(prisma) as any, prisma, seen };
  }

  it('names the free ingredients on the dish it flags', async () => {
    const { svc } = build({ businessType: 'FOOD_BEVERAGE', inventoryMode: 'RECIPE_BASED' });
    const res = await svc.findMissingCost('t1');

    expect(res.count).toBe(1);
    expect(res.products[0].unpricedIngredients).toEqual(['Cayenne pepper', 'Sriracha']);
    // The query shape is not the owner's business; the screen gets a name and a list.
    expect(res.products[0].bomItems).toBeUndefined();
    expect(res.products[0].variants).toBeUndefined();
    expect(res.products[0].inventoryMode).toBeUndefined();
  });

  it('asks for exactly the shared rule', async () => {
    const { svc, seen } = build({ businessType: 'FOOD_BEVERAGE', inventoryMode: 'RECIPE_BASED' });
    await svc.findMissingCost('t1');
    expect(seen[0].where).toEqual(missingCostWhere('t1', true));
  });

  it('says nothing to a shop that sells no goods', async () => {
    const { svc, prisma } = build({ businessType: 'SERVICE', inventoryMode: 'UNIT_BASED' });
    expect(await svc.findMissingCost('t1')).toEqual({ count: 0, products: [] });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

describe('the Ledger dashboard counts the same products the POS list shows', () => {
  /*
    Two numbers for one question is worse than one wrong number: the owner
    sees "0 products missing a cost" on the dashboard, opens the POS list and
    finds four, and stops trusting both.
  */
  it('counts with the shared rule, on the shop\'s own costing mode', async () => {
    const counts: any[] = [];
    const prisma: any = {
      accountingEvent:  { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      aRInvoice:        { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: {} }) },
      aPBill:           { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: {} }) },
      accountingPeriod: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
      journalLine:      { findMany: jest.fn().mockResolvedValue([]) },
      journalEntry:     { count: jest.fn().mockResolvedValue(0) },
      order:            { count: jest.fn().mockResolvedValue(0) },
      expenseClaim:     { count: jest.fn().mockResolvedValue(0) },
      auditLog:         { count: jest.fn().mockResolvedValue(0) },
      tenant:           { findUnique: jest.fn().mockResolvedValue({ inventoryMode: 'RECIPE_BASED' }) },
      product:          { count: jest.fn(async (args: any) => { counts.push(args); return 4; }) },
    };
    const metrics = await new LedgerMetricsService(prisma).getProcessMetrics('t1');

    expect(counts).toHaveLength(1);
    expect(counts[0].where).toEqual(missingCostWhere('t1', true));
    expect(metrics.control.productsMissingCost).toBe(4);
  });
});
