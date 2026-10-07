/**
 * A reorder level each shop gets without typing one.
 *
 * A typed level always wins; this only fills the gap while a shop is still
 * setting up. The level is COVER_DAYS of the ingredient's own average daily
 * use, averaged over the days the shop has actually been trading in the
 * window, so a shop that opened on Monday is not judged as if it had been
 * open for two weeks.
 */
jest.mock('../ingredient-reports/daily-usage', () => {
  const actual = jest.requireActual('../ingredient-reports/daily-usage');
  return { ...actual, usedByDay: jest.fn() };
});

import { usedByDay } from '../ingredient-reports/daily-usage';
import { learnedLevels, clearLearnedLevels, COVER_DAYS } from './learned-levels';
import { InventoryService } from './inventory.service';

const used = usedByDay as jest.Mock;
const NOW = new Date('2026-09-29T02:00:00Z');   // 10 am Manila, 29 Sep
const row = (rawMaterialId: string, total: number) => ({ rawMaterialId, name: rawMaterialId, unit: 'g', costPrice: 0, sold: total, wasted: 0, intoPreps: 0, writtenOff: 0, total, value: 0 });

beforeEach(() => { clearLearnedLevels(); used.mockReset(); });

describe('learnedLevels', () => {
  it('is COVER_DAYS of average daily use, over the days the shop has been trading', async () => {
    // First sale 7 days ago (22 Sep, Manila): 1,400 g of milk in 7 days is 200 g a day.
    used.mockResolvedValue({ days: [{ day: '2026-09-22' }], rows: [row('milk', 1400), row('sugar', 0)] });
    const levels = await learnedLevels({} as any, 't1', 'b1', NOW);
    expect(COVER_DAYS).toBe(2);
    expect(levels.get('milk')).toBe(Math.ceil((1400 / 8) * 2));   // 22 Sep 00:00 to 29 Sep 10:00 is 7.4 days: 8 counted
    expect(levels.has('sugar')).toBe(false);                     // not used: no pace to learn
  });

  it('knows nothing about a shop that has sold nothing yet', async () => {
    used.mockResolvedValue({ days: [], rows: [] });
    expect((await learnedLevels({} as any, 't1', 'b1', NOW)).size).toBe(0);
  });

  it('never blocks a screen: a usage read that fails leaves only the typed levels', async () => {
    used.mockRejectedValue(new Error('db away'));
    expect((await learnedLevels({} as any, 't1', 'b1', NOW)).size).toBe(0);
  });

  it('is read once per branch per half hour, not on every screen', async () => {
    used.mockResolvedValue({ days: [{ day: '2026-09-22' }], rows: [row('milk', 1400)] });
    await learnedLevels({} as any, 't1', 'b1', NOW);
    await learnedLevels({} as any, 't1', 'b1', new Date(NOW.getTime() + 10 * 60_000));
    expect(used).toHaveBeenCalledTimes(1);
    await learnedLevels({} as any, 't1', 'b1', new Date(NOW.getTime() + 31 * 60_000));
    expect(used).toHaveBeenCalledTimes(2);
  });
});

describe('the buy list with learned levels', () => {
  function svc(ingredients: any[], inRecipe: string[]) {
    const prisma: any = {
      inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterial: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(where?.OR
          ? ingredients.filter((r) => inRecipe.includes(r.id)).map((r) => ({ id: r.id }))   // idsInARecipe
          : ingredients.map((r) => ({ ...r, inventory: [{ quantity: r.qty }], subRecipeItems: r.prep ? [{ id: 'x' }] : [] })))),
      },
    };
    return new InventoryService(prisma, {} as any);
  }

  // The level learns from the last fourteen days counted back from "now", so
  // the test fixes now: written on 29 Sept, it began failing once 22 Sept
  // (its only day of use) fell out of the window.
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-09-29T12:00:00+08:00'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('a typed level wins; a learned one fills the gap; an ingredient out and in a recipe is low with no level at all', async () => {
    used.mockResolvedValue({ days: [{ day: '2026-09-22' }], rows: [row('milk', 1400), row('beans', 800), row('sauce', 5000)] });
    const low = await svc([
      { id: 'milk',  name: 'Fresh Milk',  unit: 'ml', lowStockAlert: null, qty: 300 },   // learned 350: low
      { id: 'beans', name: 'Coffee Beans', unit: 'g', lowStockAlert: 100,  qty: 150 },   // typed 100 wins over learned 200: not low
      { id: 'cups',  name: 'Hot Cup',      unit: 'pc', lowStockAlert: null, qty: 0 },    // no level, no pace, out, in a recipe: low
      { id: 'vinegar', name: 'Vinegar',    unit: 'ml', lowStockAlert: null, qty: 0 },    // out but no recipe uses it: left alone
      { id: 'sauce', name: 'Teriyaki (ready)', unit: 'ml', lowStockAlert: null, qty: 10, prep: true },   // a prep never gets a learned par
    ], ['milk', 'beans', 'cups', 'sauce']).getLowStock('t1', 'b1');

    const by = Object.fromEntries(low.map((r: any) => [r.id, r]));
    expect(Object.keys(by).sort()).toEqual(['cups', 'milk']);
    expect(by.milk).toMatchObject({ levelSource: 'learned', lowStockAlert: 350, shortBy: 50 });
    expect(by.cups).toMatchObject({ levelSource: 'none', lowStockAlert: 0, quantity: 0 });
  });
});
