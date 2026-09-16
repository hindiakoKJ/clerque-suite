import { availableQty, heldAcross, heldAt, heldUsage } from './held-usage';

/** What waiting tickets hold: their recipe, net of refunds, per branch. */
describe('heldUsage', () => {
  function build(lines: any[]) {
    const db: any = {
      orderItem: { findMany: jest.fn(async () => lines) },
      bomItem: {
        findMany: jest.fn(async () => [
          { productId: 'p-latte', rawMaterialId: 'rm-milk', quantity: 200, rawMaterial: null },
          { productId: 'p-latte', rawMaterialId: 'rm-espresso', quantity: 18, rawMaterial: null },
        ]),
      },
      variantBomItem: { findMany: jest.fn(async () => [{ variantId: 'v-large', rawMaterialId: 'rm-milk', quantity: 300, rawMaterial: null }]) },
      modifierOption: { findMany: jest.fn(async () => []) },
    };
    return db;
  }
  const line = (over: any) => ({ productId: 'p-latte', variantId: null, quantity: 1, refundedQty: 0, modifiers: [], order: { branchId: 'b1' }, ...over });

  it('adds up the recipes of waiting lines per branch, net of refunds, with the size recipe replacing the base', async () => {
    const db = build([
      line({ quantity: 2 }),
      line({ variantId: 'v-large' }),
      line({ quantity: 3, refundedQty: 3 }),          // refunded away: holds nothing
      line({ order: { branchId: 'b2' } }),
    ]);
    const held = await heldUsage(db, 't1', ['b1', 'b2']);
    expect(heldAt(held, 'b1', 'rm-milk')).toBe(700);       // 2 × 200 + 1 Large × 300
    expect(heldAt(held, 'b1', 'rm-espresso')).toBe(36);    // the Large's own recipe has no espresso
    expect(heldAt(held, 'b2', 'rm-milk')).toBe(200);
    expect(heldAcross(held, 'rm-milk')).toBe(900);
  });

  it('asks only for waiting lines of live orders of this shop and branches, leaving out the order being rung up', async () => {
    const db = build([]);
    await heldUsage(db, 't1', ['b1'], { excludeOrderId: 'o-now' });
    const where = db.orderItem.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      usageOnReady: true, usagePostedAt: null,
      order: { tenantId: 't1', deletedAt: null, status: { in: ['PAID', 'COMPLETED'] }, branchId: { in: ['b1'] }, id: { not: 'o-now' } },
    });
  });

  it('can be narrowed to some ingredients, and nothing waiting reads the recipes not at all', async () => {
    const narrow = build([line({})]);
    const held = await heldUsage(narrow, 't1', ['b1'], { rawMaterialIds: ['rm-espresso'] });
    expect(heldAt(held, 'b1', 'rm-milk')).toBe(0);
    expect(heldAt(held, 'b1', 'rm-espresso')).toBe(18);

    const none = build([]);
    await heldUsage(none, 't1', ['b1']);
    expect(none.bomItem.findMany).not.toHaveBeenCalled();
    expect(await heldUsage(none, 't1', [])).toEqual(new Map());
  });

  it('available never goes below zero', () => {
    expect(availableQty(100, 30)).toBe(70);
    expect(availableQty(10, 30)).toBe(0);
  });
});
