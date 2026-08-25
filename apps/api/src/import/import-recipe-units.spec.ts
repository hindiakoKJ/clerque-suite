import { ImportService } from './import.service';

/**
 * Recipe unit reconciliation.
 *
 * A recipe book says "200 ml milk". The Ingredients sheet may define Milk in
 * `ml` — or in `L`, because that is how the shop buys it. Writing 200 against
 * an ingredient measured in litres puts 200 LITRES of milk in one latte, and
 * nothing downstream questions it: stock drains to zero, COGS explodes, and
 * the only clue is a wrong number in a report weeks later.
 *
 * That is why a converted recipe file with the units stripped out is worse
 * than useless — the numbers are only meaningful next to their unit. The
 * Recipes template now carries an optional Unit column, and these tests pin
 * what it does with it.
 */
describe('ImportService — recipe unit reconciliation', () => {
  const svc = new ImportService({} as any);
  const convert = (qty: number, from: string | undefined, to: string) =>
    (svc as unknown as {
      convertRecipeQuantity(q: number, f: string | undefined, t: string): { value: number } | { error: string };
    }).convertRecipeQuantity(qty, from, to);

  const val = (r: { value: number } | { error: string }) => ('value' in r ? r.value : NaN);
  const err = (r: { value: number } | { error: string }) => ('error' in r ? r.error : '');

  it('takes the number as-is when no unit is written', () => {
    // Blank Unit = "already in the ingredient's own unit" — the old behaviour.
    expect(val(convert(150, undefined, 'ml'))).toBe(150);
    expect(val(convert(150, '', 'g'))).toBe(150);
  });

  it('passes through when the units already agree', () => {
    expect(val(convert(200, 'ml', 'ml'))).toBe(200);
    expect(val(convert(18, 'g', 'g'))).toBe(18);
  });

  it('converts ml to L — the case that would have poured 200 litres', () => {
    expect(val(convert(200, 'ml', 'L'))).toBe(0.2);
  });

  it('converts g to kg and back', () => {
    expect(val(convert(18, 'g', 'kg'))).toBe(0.018);
    expect(val(convert(1.5, 'kg', 'g'))).toBe(1500);
  });

  it('handles the spellings a real spreadsheet contains', () => {
    // Case, plurals, trailing dots, and long forms all normalise.
    expect(val(convert(200, 'ML', 'ml'))).toBe(200);
    expect(val(convert(2, 'Liters', 'ml'))).toBe(2000);
    expect(val(convert(500, 'grams', 'kg'))).toBe(0.5);
    expect(val(convert(1, 'Kg.', 'g'))).toBe(1000);
  });

  it('converts kitchen measures to the stocked unit', () => {
    expect(val(convert(1, 'tbsp', 'ml'))).toBeCloseTo(14.7868, 3);
    expect(val(convert(1, 'cup', 'ml'))).toBe(240);
  });

  it('REFUSES to convert weight into volume', () => {
    const r = convert(200, 'g', 'ml');
    expect(err(r)).toContain('Cannot convert mass');
    expect(err(r)).toContain('volume');
  });

  it('refuses an unknown unit rather than guessing a shop-specific measure', () => {
    // "scoop", "pump", "sachet" mean different things in different shops.
    const r = convert(2, 'scoop', 'g');
    expect(err(r)).toContain('does not match');
  });

  it('rounds to the 4 decimals the BOM column stores', () => {
    // 1 tsp in litres is 0.00492892… — stored as 0.0049.
    expect(val(convert(1, 'tsp', 'L'))).toBe(0.0049);
  });

  it('treats a count unit as itself, and rejects converting it', () => {
    expect(val(convert(1, 'pc', 'pc'))).toBe(1);
    expect(err(convert(1, 'pc', 'g'))).toContain('does not match');
  });
});
