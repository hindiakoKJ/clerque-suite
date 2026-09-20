import { blendCost, stockValuedEvent } from './zero-cost-blend';

/**
 * A ₱0 is not a price, and averaging one in keeps the damage.
 *
 * Opening stock was loaded for Soy sauce, Flour, Garlic powder, Ginger,
 * Butter and Salt at ₱0 -- 5,000 g of soy sauce worth nothing. The first real
 * delivery, 1,000 g at ₱0.06, was then averaged against those 5,000 free
 * grams: ₱0.01 a gram instead of ₱0.06, and every plate with soy sauce in it
 * stayed six times too cheap until the free stock was eaten through.
 *
 * The same the other way round: a delivery recorded with no price (a barista
 * who does not know what the ice cost) dragged a good average down to nothing.
 *
 * So a zero on either side is treated as "no price". Whatever gets a price for
 * the first time is booked as opening stock, so the stock account still equals
 * stock x cost afterwards.
 */
describe('the average cost when one side has no price', () => {
  it('averages normally when both sides are priced', () => {
    // 1,000 g at ₱0.10 plus 1,000 g at ₱0.20 is ₱0.15 -- unchanged behaviour.
    expect(blendCost({ qtyBefore: 1000, oldCost: 0.10, qtyIn: 1000, inCost: 0.20 }))
      .toEqual({ cost: 0.15, valued: null });
  });

  it('takes the delivery price outright when the stock on hand was loaded at ₱0', () => {
    // The real case: 5,000 g of soy sauce at ₱0, then 1,000 g at ₱0.06.
    const b = blendCost({ qtyBefore: 5000, oldCost: 0, qtyIn: 1000, inCost: 0.06 });
    expect(b.cost).toBe(0.06);
    // Averaged, it would have been 60 / 6000 = ₱0.01 -- six times too cheap.
    expect(b.cost).not.toBeCloseTo(0.01, 4);
    // And the 5,000 g that were carried at nothing are now worth ₱300.
    expect(b.valued).toEqual({ quantity: 5000, unitCost: 0.06 });
  });

  it('leaves the price on file alone when the delivery itself says ₱0', () => {
    const b = blendCost({ qtyBefore: 1000, oldCost: 0.40, qtyIn: 1000, inCost: 0 });
    expect(b.cost).toBeNull();                                   // nothing written
    expect(b.valued).toEqual({ quantity: 1000, unitCost: 0.40 }); // delivery valued at it
  });

  it('changes nothing at all when neither side has a price', () => {
    expect(blendCost({ qtyBefore: 1000, oldCost: 0, qtyIn: 500, inCost: 0 }))
      .toEqual({ cost: null, valued: null });
  });

  it('takes the delivery price when the shop holds none of it yet', () => {
    expect(blendCost({ qtyBefore: 0, oldCost: 0, qtyIn: 500, inCost: 0.30 }))
      .toEqual({ cost: 0.30, valued: null });
  });

  it('does not fall over when a count has gone negative', () => {
    // qtyBefore + qtyIn can be 0 or less after a bad adjustment; the delivery
    // price is still the best answer, and nothing is divided by zero.
    const b = blendCost({ qtyBefore: -100, oldCost: 0.10, qtyIn: 100, inCost: 0.20 });
    expect(b.cost).toBe(0.20);
    expect(Number.isFinite(b.cost as number)).toBe(true);
  });
});

describe('booking the stock that was valued for the first time', () => {
  const MATERIAL = { id: 'rm-soy', name: 'Soy sauce', category: 'INGREDIENT', unit: 'g' };
  const at = new Date('2026-09-01T02:00:00.000Z');

  it('queues opening stock for what the books had not carried', () => {
    const ev = stockValuedEvent({
      tenantId: 't1', material: MATERIAL, branchId: 'br-1',
      quantity: 5000, unitCost: 0.06, at, reference: 'DR-1',
    })!;
    expect(ev.type).toBe('INVENTORY_ADJUSTMENT');
    expect(ev.status).toBe('PENDING');
    const p = ev.payload as any;
    expect(p.rawMaterialId).toBe('rm-soy');
    expect(p.reasonCode).toBe('OPENING_BALANCE');
    expect(p.totalValue).toBe(300);
    expect(p.branchId).toBe('br-1');
  });

  it('queues nothing when it rounds to no money', () => {
    expect(stockValuedEvent({
      tenantId: 't1', material: MATERIAL, branchId: 'br-1',
      quantity: 0, unitCost: 0.06, at,
    })).toBeNull();
    expect(stockValuedEvent({
      tenantId: 't1', material: MATERIAL, branchId: 'br-1',
      quantity: 0.0001, unitCost: 0.0001, at,
    })).toBeNull();
  });
});
