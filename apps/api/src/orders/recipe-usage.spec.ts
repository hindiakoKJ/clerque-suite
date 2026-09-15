import { Prisma } from '@prisma/client';
import { recipeUsagePerUnit, recipeKey, drainLots } from './recipe-usage';

/**
 * The one recipe walk the sale, Recipe Catch-Up and the ready tap share, and
 * the guarded lot take.
 */
describe('recipe usage', () => {
  const milk = { rawMaterialId: 'milk', quantity: 200 };
  const beans = { rawMaterialId: 'beans', quantity: 18 };

  it('a size recipe replaces the product recipe; no size recipe falls back to it', () => {
    expect(recipeUsagePerUnit([milk, beans], [{ rawMaterialId: 'milk', quantity: 300 }], []).map((l) => [l.rawMaterialId, l.perUnit]))
      .toEqual([['milk', 300]]);
    expect(recipeUsagePerUnit([milk, beans], [], []).map((l) => [l.rawMaterialId, l.perUnit])).toEqual([['milk', 200], ['beans', 18]]);
  });

  it('scales by the highest add-on multiplier, nets substitutions, floors at zero', () => {
    const grande = { recipeMultiplier: 1.25, ingredients: [] };
    const venti = { recipeMultiplier: new Prisma.Decimal(1.5), ingredients: [] };
    const oat = { recipeMultiplier: null, ingredients: [{ rawMaterialId: 'milk', quantity: -400 }, { rawMaterialId: 'oat', quantity: 250 }] };
    const usage = recipeUsagePerUnit([milk, beans], null, [grande, venti, oat]);
    // 200 x 1.5 = 300 milk, minus 400 -> none; 18 x 1.5 beans; 250 oat.
    expect(usage.map((l) => [l.rawMaterialId, l.perUnit])).toEqual([['beans', 27], ['oat', 250]]);
  });

  it('a recipe key tells a Regular from a Large, and ignores add-on order', () => {
    expect(recipeKey('p', null, ['b', 'a'])).toBe(recipeKey('p', undefined, ['a', 'b', null]));
    expect(recipeKey('p', 'large', [])).not.toBe(recipeKey('p', null, []));
  });

  it('takes lot layers with a guarded relative write, and re-reads a layer another sale drained meanwhile', async () => {
    const layers = [{ id: 'old', qtyRemaining: 100, unitCost: 1 }, { id: 'new', qtyRemaining: 500, unitCost: 2 }];
    let raced = false;
    const tx: any = {
      rawMaterialLot: {
        findMany: jest.fn(() => Promise.resolve(layers.filter((l) => l.qtyRemaining > 0).map((l) => ({ ...l })))),
        updateMany: jest.fn(({ where, data }: any) => {
          const lot = layers.find((l) => l.id === where.id)!;
          // The other till takes 60 from the old layer between our read and our write, once.
          if (!raced && lot.id === 'old') { raced = true; lot.qtyRemaining -= 60; }
          if (lot.qtyRemaining < Number(where.qtyRemaining.gte)) return Promise.resolve({ count: 0 });
          lot.qtyRemaining -= Number(data.qtyRemaining.decrement);
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const out = await drainLots(tx, { branchId: 'b1', rawMaterialId: 'milk' }, 150, false);
    expect(out.qty).toBe(150);
    // The other sale's 60 stays taken: 40 left of the old layer went to us, then 110 from the new one.
    expect(out.lots).toEqual([{ lotId: 'old', qty: 40, unitCost: 1 }, { lotId: 'new', qty: 110, unitCost: 2 }]);
    expect(layers.map((l) => l.qtyRemaining)).toEqual([0, 390]);
    expect(out.cost).toBe(40 * 1 + 110 * 2);
  });
});
