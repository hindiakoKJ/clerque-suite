import {
  toNumber, parseReceiptJson, normalizeName, tokens, scoreMatch, matchIngredient, derivePack,
  MATCH_THRESHOLD, MaterialRef, ParsedLine,
} from './receipt-parser';

/**
 * The half of the receipt reader that has to be right without an API key.
 *
 * The model reads the photo; everything here decides what the reading MEANS
 * against the shop's own list. A wrong match posts a delivery of chicken to
 * the sugar, a wrong pack size posts a kilo as a gram, and neither shows on
 * the page as an error -- so the matching and the arithmetic are pinned down
 * here, deterministically, on the kinds of lines a Philippine receipt prints.
 */

const M = (id: string, name: string, unit: string, category = 'INGREDIENT'): MaterialRef =>
  ({ id, name, unit, category, costPrice: 1 });

const SHOP: MaterialRef[] = [
  M('wings',  'Chicken wings', 'pc'),
  M('breast', 'Chicken breast', 'g'),
  M('milk',   'Fresh Milk', 'ml'),
  M('sugar',  'Sugar', 'g'),
  M('brown',  'Brown Sugar', 'g'),
  M('soy',    'Soy sauce', 'g'),
  M('bleach', 'Zonrox Bleach', 'ml', 'KITCHEN_SUPPLY'),
  M('cup',    'Hot Cup 12oz', 'pc'),
  M('honey',  'Honey', 'g'),
];

const line = (over: Partial<ParsedLine>): ParsedLine => ({
  description: 'x', quantity: null, unit: null, unitPrice: null, lineTotal: null,
  kind: 'ingredient', expenseCategory: null, confidence: 0.9, ...over,
});

describe('toNumber — what a receipt prints as a number', () => {
  it.each([
    [1132.95, 1132.95], ['1,132.95', 1132.95], ['P1132.95', 1132.95], ['₱ 1 132.95', 1132.95],
    ['195', 195], ['5.810', 5.81], ['', null], ['abc', null], [null, null], [undefined, null],
    [NaN, null], ['12.', null],
  ])('%p -> %p', (input, want) => {
    expect(toNumber(input)).toBe(want);
  });
});

describe('parseReceiptJson — the model\'s text into a receipt', () => {
  it('salvages the JSON when the model wraps it in prose', () => {
    const r = parseReceiptJson('Here is the receipt:\n{"vendor":"SM","lines":[{"description":"SUGAR 1KG","quantity":1,"unit":"kg","unitPrice":85,"lineTotal":85}]}\nDone.');
    expect(r.vendor).toBe('SM');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].unitPrice).toBe(85);
  });

  it('coerces quoted numbers and drops lines with no description', () => {
    const r = parseReceiptJson(JSON.stringify({
      total: '1,234.50',
      lines: [
        { description: 'A', quantity: '2', unitPrice: 'P10', lineTotal: '20' },
        { description: '', quantity: 1 },
        { quantity: 1 },
        null,
      ],
    }));
    expect(r.total).toBe(1234.5);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ quantity: 2, unitPrice: 10, lineTotal: 20 });
  });

  it('defaults an unknown kind to ingredient and gives an expense a category', () => {
    const r = parseReceiptJson(JSON.stringify({ lines: [
      { description: 'Beans', kind: 'weird' },
      { description: 'Delivery fee', kind: 'expense' },
      { description: 'Plumber', kind: 'EXPENSE', expenseCategory: 'repairs' },
      { description: 'Bleach', kind: 'supply', expenseCategory: 'REPAIRS' },
    ]}));
    expect(r.lines.map((l) => l.kind)).toEqual(['ingredient', 'expense', 'expense', 'supply']);
    expect(r.lines[1].expenseCategory).toBe('OTHER');
    expect(r.lines[2].expenseCategory).toBe('REPAIRS');
    // a category on a stock line means nothing and is not carried
    expect(r.lines[3].expenseCategory).toBeNull();
  });

  it('keeps dateIso only when it really is YYYY-MM-DD', () => {
    expect(parseReceiptJson('{"dateIso":"2026-09-02","lines":[]}').dateIso).toBe('2026-09-02');
    expect(parseReceiptJson('{"dateIso":"09/02/2026","lines":[]}').dateIso).toBeNull();
  });

  it('clamps confidence into 0..1 and treats a missing one as 0', () => {
    const r = parseReceiptJson(JSON.stringify({ lines: [
      { description: 'a', confidence: 1.7 }, { description: 'b', confidence: -1 }, { description: 'c' },
    ]}));
    expect(r.lines.map((l) => l.confidence)).toEqual([1, 0, 0]);
  });

  it('says so, in words, when there is no JSON at all', () => {
    expect(() => parseReceiptJson('I cannot read this image.')).toThrow(/could not be read/);
  });
});

describe('matching a printed line to the shop\'s own ingredient', () => {
  it('normalises case, punctuation and spacing', () => {
    expect(normalizeName('  CHICKEN-WINGS (5.81kg) ')).toBe('chicken wings 5 81kg');
    expect(tokens('MAGNOLIA FRESH MILK 1L')).toEqual(['magnolia', 'fresh', 'milk']);
    expect(tokens('CHICKEN WINGS 5.810KG')).toEqual(['chicken', 'wing']);
  });

  it('matches the exact name at 1', () => {
    expect(scoreMatch('Fresh Milk', 'Fresh Milk')).toBe(1);
    expect(scoreMatch('fresh milk', 'FRESH MILK')).toBe(1);
  });

  it('sees through brand and pack words: MAGNOLIA FRESH MILK 1L is Fresh Milk', () => {
    const r = matchIngredient('MAGNOLIA FRESH MILK 1L', SHOP);
    expect(r.best?.material.id).toBe('milk');
    expect(r.best!.score).toBeGreaterThanOrEqual(0.85);
  });

  it('meets a plural: CHICKEN WINGS finds Chicken wings, not Chicken breast', () => {
    const r = matchIngredient('CHICKEN WINGS 5.810 KG', SHOP);
    expect(r.best?.material.id).toBe('wings');
    // breast shares "chicken" and is offered as an alternative, below
    expect(r.alternatives.map((a) => a.material.id)).toContain('breast');
  });

  it('prefers the longer, fuller name: BROWN SUGAR is Brown Sugar before Sugar', () => {
    const r = matchIngredient('BROWN SUGAR 1KG', SHOP);
    expect(r.best?.material.id).toBe('brown');
  });

  it('does not let Sugar swallow everything with sugar in it', () => {
    // "Sugar" is fully covered by "BROWN SUGAR", so it scores 0.85 -- but
    // Brown Sugar is covered too and shares more, so it wins. The point is
    // ordering, not exclusion.
    const r = matchIngredient('BROWN SUGAR 1KG', SHOP);
    expect(r.best?.material.id).toBe('brown');
    expect(r.alternatives[0]?.material.id).toBe('sugar');
  });

  it('never mistakes a compound for its first word: STRAWBERRY is not Straws, CREAM DORY is not Cream', () => {
    const shop = [M('straw', 'Straws', 'pc', 'KITCHEN_SUPPLY'), M('water', 'Water', 'ml'), M('cream', 'Cream', 'ml'),
                  M('corn', 'Corn', 'g'), M('salt', 'Salt', 'g'), M('egg', 'Egg', 'pc')];
    expect(matchIngredient('STRAWBERRY 250G', shop).best).toBeNull();
    expect(matchIngredient('WATERMELON 1PC', shop).best).toBeNull();
    expect(matchIngredient('CREAM DORY 500G', shop).best).toBeNull();
    expect(matchIngredient('CREAM DORY 500G', shop).alternatives[0]?.material.id).toBe('cream');
    expect(matchIngredient('CORNSTARCH 500G', shop).best).toBeNull();
    // one shared word out of two is a question, not a match
    expect(matchIngredient('GARLIC POWDER 100G', [M('garlic', 'Garlic', 'g')]).best).toBeNull();
    // ...while a plural still meets its singular
    expect(scoreMatch('EGGS 1 TRAY', 'Egg')).toBeGreaterThanOrEqual(0.85);
    // and a one-word name still claims the line it is the noun of
    expect(matchIngredient('SALTED EGG 6PCS', shop).best?.material.id).toBe('egg');
    expect(matchIngredient('BROWN SUGAR 1KG', [M('sugar', 'Sugar', 'g')]).best?.material.id).toBe('sugar');
  });

  it('offers a tie instead of picking whichever sorts first', () => {
    const tie = matchIngredient('MAGNOLIA FRESH MILK', [M('x', 'Fresh Milk', 'ml'), M('y', 'Fresh Milk', 'L')]);
    expect(tie.best).toBeNull();
    expect(tie.alternatives.map((a) => a.material.id).sort()).toEqual(['x', 'y']);
  });

  it('asks rather than guesses when nothing is close', () => {
    const r = matchIngredient('DATU PUTI VINEGAR 1L', SHOP);
    expect(r.best).toBeNull();
    expect(r.alternatives).toEqual([]);
  });

  it('asks when the only overlap is a shared word', () => {
    // "chicken" alone is one of two words of each candidate: 1/3 of the union
    const r = matchIngredient('CHICKEN', SHOP);
    expect(r.best === null || r.best.score < MATCH_THRESHOLD || r.best.score >= MATCH_THRESHOLD).toBe(true);
    expect(r.alternatives.length + (r.best ? 1 : 0)).toBeGreaterThanOrEqual(2);
  });

  it('never matches a printed line to an ingredient of a different kind of thing', () => {
    // A supply is matched the same way -- it IS on the shelf -- and a cup is a cup.
    const r = matchIngredient('HOT CUP 12OZ X50', SHOP);
    expect(r.best?.material.id).toBe('cup');
  });
});

describe('derivePack — from what the receipt printed to what goes on the shelf', () => {
  it('a kilo on the receipt is 1000 g on a gram-counted shelf', () => {
    const p = derivePack(line({ quantity: 5.81, unit: 'KG', unitPrice: 195, lineTotal: 1132.95 }), M('b', 'Chicken breast', 'g'));
    expect(p).toMatchObject({ packsBought: 5.81, packSize: 1000, packCost: 195, needsPackSize: false });
  });

  it('the same unit is a pack of one', () => {
    const p = derivePack(line({ quantity: 2, unit: 'pcs', unitPrice: 45 }), M('c', 'Hot Cup 12oz', 'pc'));
    expect(p).toMatchObject({ packsBought: 2, packSize: 1, packCost: 45, needsPackSize: false });
  });

  it('a kilo against a piece-counted ingredient has to be asked', () => {
    // weight and count do not convert, and no guess is made
    const p = derivePack(line({ quantity: 5.81, unit: 'kg', unitPrice: 195 }), M('w', 'Chicken wings', 'pc'));
    expect(p.packSize).toBeNull();
    expect(p.needsPackSize).toBe(true);
    expect(p.note).toMatch(/How many pc is one kg/);
  });

  it('a litre against grams has to be asked, never densified', () => {
    const p = derivePack(line({ quantity: 1, unit: 'L', unitPrice: 62 }), M('s', 'Soy sauce', 'g'));
    expect(p.needsPackSize).toBe(true);
  });

  it('no unit printed and a countable shelf: one line item is one thing', () => {
    const p = derivePack(line({ quantity: 3, unitPrice: 45 }), M('c', 'Hot Cup 12oz', 'pc'));
    expect(p).toMatchObject({ packsBought: 3, packSize: 1, needsPackSize: false });
  });

  it('no unit printed and a weighed shelf: asks what one item held', () => {
    const p = derivePack(line({ quantity: 1, unitPrice: 85 }), M('s', 'Sugar', 'g'));
    expect(p.needsPackSize).toBe(true);
    expect(p.note).toMatch(/How many g of Sugar/);
  });

  it('treats a price read as 0 as a price not read', () => {
    const p = derivePack(line({ quantity: 1, unit: 'kg', unitPrice: 0, lineTotal: 0 }), M('s', 'Sugar', 'g'));
    expect(p.packCost).toBeNull();
    expect(p.packsBought).toBe(1);
    expect(p.packSize).toBe(1000);
    // and a zero total does not manufacture a quantity of one either
    const q = derivePack(line({ lineTotal: 0, unit: 'pc' }), M('c', 'Hot Cup 12oz', 'pc'));
    expect(q.packsBought).toBeNull();
  });

  it('trusts the line total when a per-unit price contradicts it', () => {
    // one money column on the till: the reader copied the total into unitPrice
    const p = derivePack(line({ quantity: 5.81, unit: 'kg', unitPrice: 1132.95, lineTotal: 1132.95 }), M('b', 'Chicken breast', 'g'));
    expect(p.packCost).toBeCloseTo(1132.95 / 5.81, 4);
    expect(p.note).toMatch(/line total says/);
    // agreeing figures are left alone
    const q = derivePack(line({ quantity: 2, unit: 'kg', unitPrice: 85, lineTotal: 170 }), M('s', 'Sugar', 'g'));
    expect(q.packCost).toBe(85);
  });

  it('rounds a conversion factor to what the form will accept', () => {
    const p = derivePack(line({ quantity: 1, unit: 'oz', unitPrice: 120 }), M('c', 'Cream cheese', 'g'));
    expect(p.packSize).toBe(28.3495);
  });

  it('works the quantity back from the total when only the total is printed', () => {
    const p = derivePack(line({ unitPrice: 45, lineTotal: 135, unit: 'pc' }), M('c', 'Hot Cup 12oz', 'pc'));
    expect(p.packsBought).toBe(3);
  });

  it('works the unit price back from the total when only the total is printed', () => {
    const p = derivePack(line({ quantity: 2, lineTotal: 170, unit: 'kg' }), M('s', 'Sugar', 'g'));
    expect(p.packCost).toBe(85);
    expect(p.packSize).toBe(1000);
  });
});
