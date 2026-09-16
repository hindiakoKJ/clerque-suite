import { bookedUnitCost, recordWaste, recipeCostedProductIds, wasMade } from './waste';
import { recipeKey } from './recipe-usage';

/** A made item voided or refunded is waste, at what its cost-of-goods entry booked. */
describe('waste', () => {
  const item = (over: any = {}) => ({
    id: 'li1', productId: 'p-latte', variantId: null, costPrice: 60,
    usageOnReady: false, usagePostedAt: null, ingredientsDeductedAt: new Date(), modifiers: [], ...over,
  });
  const saleEvent = { payload: { lines: [
    { productId: 'p-latte', lineKey: recipeKey('p-latte', null, []), quantity: 2, unitCost: 62.345, totalCost: 124.69, costMethod: 'RECIPE_WAC' },
    { productId: 'p-water', lineKey: recipeKey('p-water', null, []), quantity: 1, unitCost: 12, totalCost: 12, costMethod: 'WAC' },
  ] } };
  const confirmEvent = { payload: { orderItemId: 'li9', lines: [{ productId: 'p-latte', orderItemId: 'li9', quantity: 1, unitCost: 70, totalCost: 70, costMethod: 'RECIPE_WAC' }] } };

  it('finds what 5010 was debited: the line\'s own confirm, else the sale by recipe key, else by product, else the line cost', () => {
    expect(bookedUnitCost([confirmEvent, saleEvent], item({ id: 'li9', usageOnReady: true, usagePostedAt: new Date() }))).toEqual({ unitCost: 70, costMethod: 'RECIPE_WAC' });
    expect(bookedUnitCost([confirmEvent, saleEvent], item())).toEqual({ unitCost: 62.345, costMethod: 'RECIPE_WAC' });
    const legacy = { payload: { lines: [{ productId: 'p-latte', quantity: 1, unitCost: 50, totalCost: 50, costMethod: 'RECIPE_WAC' }] } };
    expect(bookedUnitCost([legacy], item())).toEqual({ unitCost: 50, costMethod: 'RECIPE_WAC' });
    // Written before keys were kept, with a Regular and a Large of one product: the first line would be a guess, the line's own cost is not.
    const twoSizes = { payload: { lines: [
      { productId: 'p-latte', quantity: 1, unitCost: 30, totalCost: 30, costMethod: 'RECIPE_WAC' },
      { productId: 'p-latte', quantity: 1, unitCost: 45, totalCost: 45, costMethod: 'RECIPE_WAC' },
    ] } };
    expect(bookedUnitCost([twoSizes], item({ costPrice: 45 }))).toEqual({ unitCost: 45, costMethod: 'RECIPE_WAC' });
    expect(bookedUnitCost([twoSizes], item({ costPrice: null }))).toEqual({ unitCost: 30, costMethod: 'RECIPE_WAC' });
    expect(bookedUnitCost([], item())).toEqual({ unitCost: 60, costMethod: 'SNAPSHOT' });
    // Waited and never confirmed: nothing was booked.
    expect(bookedUnitCost([saleEvent], item({ usageOnReady: true, usagePostedAt: null }))).toBeNull();
  });

  it('made means its ingredients were used; still waiting is never made', () => {
    expect(wasMade([saleEvent], item())).toBe(true);
    expect(wasMade([saleEvent], item({ usageOnReady: true, usagePostedAt: null, ingredientsDeductedAt: null }))).toBe(false);
    // A bottled water: no recipe, nothing used, not waste.
    expect(wasMade([saleEvent], item({ id: 'lw', productId: 'p-water', ingredientsDeductedAt: null }))).toBe(false);
  });

  it('records one WASTE entry at the booked cost, and nothing when nothing was made', async () => {
    const created: any[] = [];
    const tx: any = { accountingEvent: { create: jest.fn(async ({ data }: any) => { created.push(data); return data; }) } };
    const total = await recordWaste(tx, 't1', { id: 'o1', orderNumber: 'ORD-1' }, [
      { item: item(), units: 2 },
      { item: item({ id: 'lw', productId: 'p-water', ingredientsDeductedAt: null }), units: 1 },
      { item: item({ id: 'lwait', usageOnReady: true, usagePostedAt: null, ingredientsDeductedAt: null }), units: 1 },
    ], 'VOID', 'Customer left', [saleEvent]);
    expect(total).toBe(124.69);
    expect(created).toEqual([expect.objectContaining({
      type: 'COGS_ADJUSTMENT', orderId: 'o1',
      payload: expect.objectContaining({ kind: 'WASTE', source: 'VOID', lines: [expect.objectContaining({ orderItemId: 'li1', quantity: 2, totalCost: 124.69 })] }),
    })]);

    const none = await recordWaste(tx, 't1', { id: 'o2', orderNumber: 'ORD-2' }, [{ item: item({ usageOnReady: true, usagePostedAt: null, ingredientsDeductedAt: null }), units: 1 }], 'REFUND', 'x', []);
    expect(none).toBe(0);
    expect(created).toHaveLength(1);
  });

  it('recipe-costed products come from every cost entry of the order, confirms included', () => {
    expect(recipeCostedProductIds([saleEvent, confirmEvent])).toEqual(new Set(['p-latte']));
  });
});
