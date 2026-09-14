import { servesSummary, servesSentences, LineServes } from '@repo/shared-types';

/**
 * The words for what a buy-list item still serves. One set of words for the
 * request screen, the PDF, the copied message and the owner email, so the
 * four never disagree about the same bottle.
 */
describe('what an item still serves, in words', () => {
  const dish = (name: string, byThisItem: number, over: object = {}) => ({
    productId: name, name, perServing: 1, byThisItem, byCounted: null, sellableNow: byThisItem, limitedBy: null, ...over,
  });
  const serves = (over: Partial<LineServes>): LineServes => ({ dishes: [], addOns: [], goesInto: [], ...over });

  it('joins dishes with "or", and counts the rest in words that cannot be read as servings', () => {
    expect(servesSummary(serves({ dishes: [dish('Lasagna', 4)] }))).toBe('enough for 4 Lasagna');
    expect(servesSummary(serves({ dishes: [dish('Lasagna', 4), dish('Spaghetti', 10)] }))).toBe('enough for 4 Lasagna or 10 Spaghetti');
    expect(servesSummary(serves({ dishes: [dish('A', 1), dish('B', 2), dish('C', 3)] }))).toBe('enough for 1 A, 2 B or 3 C');
    expect(servesSummary(serves({ dishes: [dish('A', 1), dish('B', 2), dish('C', 3), dish('D', 4), dish('E', 5)] })))
      .toBe('enough for 1 A, 2 B or 3 C (2 other menu items use it too)');
    // "enough for 0 Carbonara or 1 more" read as one more plate, with Spaghetti at 0 too.
    expect(servesSummary(serves({ dishes: [dish('Carbonara', 0), dish('Spaghetti', 0)] }), 1)).toBe('enough for 0 Carbonara (1 other menu item uses it too)');
    expect(servesSummary(serves({ dishes: [dish('Latte', 1200)] }))).toBe('enough for 1,200 Latte');
  });

  it('beside a count, the short form is worked from the count, so "left" and "enough for" agree', () => {
    // Clerque says 2,000 g (20 plates); the cook counted 200 g (2 plates).
    const s = serves({ dishes: [dish('Spaghetti', 20, { byCounted: 2 }), dish('Lasagna', 8, { byCounted: 9 })] });
    expect(servesSummary(s, 1)).toBe('enough for 8 Lasagna (1 other menu item uses it too)');
    expect(servesSummary(s, 1, { fromCount: true })).toBe('enough for 2 Spaghetti (1 other menu item uses it too)');
    expect(servesSentences(s)).toEqual([
      'By this item alone: enough for 20 Spaghetti or 8 Lasagna.',
      'By the count: 2 Spaghetti or 9 Lasagna.',
    ]);
  });

  it('says what an item with no dish is for, or nothing', () => {
    expect(servesSummary(serves({ goesInto: [{ prepName: 'White Sugar Syrup', dishes: [] }] }))).toBe('goes into White Sugar Syrup');
    expect(servesSummary(serves({ addOns: ['Extra shot'] }))).toBe('used only as an add-on');
    expect(servesSummary(serves({}))).toBeNull();
    expect(servesSummary(null)).toBeNull();
  });

  it('an add-on is "only" an add-on when nothing else uses the item, and "also" one when something does', () => {
    expect(servesSentences(serves({ addOns: ['Whipped Cream'] }))).toEqual(['Used only as an add-on, not counted: Whipped Cream.']);
    expect(servesSentences(serves({ dishes: [dish('Latte', 10)], addOns: ['Extra milk'] })))
      .toEqual(['By this item alone: enough for 10 Latte.', 'Also an add-on, not counted: Extra milk.']);
    expect(servesSentences(serves({}))).toEqual(['Not in any recipe.']);
  });

  it('says what the till shows when another ingredient runs out first, and only then', () => {
    expect(servesSentences(serves({ dishes: [dish('Spaghetti', 10, { sellableNow: 3, limitedBy: 'Spaghetti Noodles' })] }))).toEqual([
      'By this item alone: enough for 10 Spaghetti.',
      'The till shows 3 Spaghetti left — Spaghetti Noodles runs out first.',
    ]);
    expect(servesSentences(serves({ dishes: [dish('Spaghetti', 10)] }))).toEqual(['By this item alone: enough for 10 Spaghetti.']);
  });

  it('never says a negative number, and never names an item below zero as what runs out first', () => {
    // A sale allowed past zero: the sauce is at -600 g, so the till's number is -3.
    expect(servesSentences(serves({ dishes: [dish('Spaghetti', 0, { sellableNow: -3, limitedBy: 'Spaghetti Sauce' })] })))
      .toEqual(['By this item alone: enough for 0 Spaghetti.']);
    expect(servesSentences(serves({ dishes: [dish('Spaghetti', 5, { sellableNow: -3, limitedBy: 'Spaghetti Noodles' })] })))
      .toEqual(['By this item alone: enough for 5 Spaghetti.', 'The till shows 0 Spaghetti left — Spaghetti Noodles runs out first.']);
  });
});
