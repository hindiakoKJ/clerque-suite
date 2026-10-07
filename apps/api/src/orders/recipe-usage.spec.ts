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

  describe('a milk swap ("Oatmilk": the drink\'s milk out, oat milk in)', () => {
    // Cafe Carolina's own amounts: hot lattes 200 ml, iced 150 ml, frappes 100 ml.
    const fresh = (ml: number) => ({ rawMaterialId: 'fresh', quantity: ml });
    const oatMilk = {
      recipeMultiplier: null,
      ingredients: [
        { rawMaterialId: 'fresh', quantity: 0, role: 'SWAP_OUT' },
        { rawMaterialId: 'breve', quantity: 0, role: 'SWAP_OUT' },
        { rawMaterialId: 'oat', quantity: 30, role: 'SWAP_IN' },
      ],
    };
    const breveMilk = {
      recipeMultiplier: null,
      ingredients: [
        { rawMaterialId: 'fresh', quantity: 0, role: 'SWAP_OUT' },
        { rawMaterialId: 'oat', quantity: 0, role: 'SWAP_OUT' },
        { rawMaterialId: 'breve', quantity: 30, role: 'SWAP_IN' },
      ],
    };
    const use = (base: Array<{ rawMaterialId: string; quantity: number }>, opts: Array<typeof oatMilk>) =>
      recipeUsagePerUnit(base, null, opts).map((l) => [l.rawMaterialId, l.perUnit]);

    it('replaces the milk at the drink\'s own amount: 200 ml hot, 150 ml iced, 100 ml frappe', () => {
      expect(use([fresh(200), beans], [oatMilk])).toEqual([['beans', 18], ['oat', 200]]);
      expect(use([fresh(150), beans], [oatMilk])).toEqual([['beans', 18], ['oat', 150]]);
      expect(use([fresh(100)], [oatMilk])).toEqual([['oat', 100]]);
    });

    it('adds its own amount to a drink with no milk (an Americano)', () => {
      expect(use([beans, { rawMaterialId: 'water', quantity: 200 }], [oatMilk]))
        .toEqual([['beans', 18], ['water', 200], ['oat', 30]]);
    });

    it('leaves a drink that already uses oat milk as it is: no second pour', () => {
      expect(use([{ rawMaterialId: 'oat', quantity: 150 }, { rawMaterialId: 'matcha', quantity: 4 }], [oatMilk]))
        .toEqual([['oat', 150], ['matcha', 4]]);
    });

    it('Breve on an oat drink takes the oat out and pours breve', () => {
      expect(use([{ rawMaterialId: 'oat', quantity: 150 }, { rawMaterialId: 'matcha', quantity: 4 }], [breveMilk]))
        .toEqual([['matcha', 4], ['breve', 150]]);
    });

    it('follows a size: a Grande at 1.25 swaps 250 ml', () => {
      const grande = { recipeMultiplier: 1.25, ingredients: [] };
      expect(recipeUsagePerUnit([fresh(200), beans], null, [grande, oatMilk]).map((l) => [l.rawMaterialId, l.perUnit]))
        .toEqual([['beans', 22.5], ['oat', 250]]);
    });

    it('also swaps milk another add-on put in ("extra milk" +50 ml)', () => {
      const extraMilk = { recipeMultiplier: null, ingredients: [{ rawMaterialId: 'fresh', quantity: 50 }] };
      expect(recipeUsagePerUnit([fresh(200), beans], null, [extraMilk, oatMilk]).map((l) => [l.rawMaterialId, l.perUnit]))
        .toEqual([['beans', 18], ['oat', 250]]);
    });
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
