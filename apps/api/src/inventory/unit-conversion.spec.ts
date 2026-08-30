import { unitFactor, normUnit, resolveBuyUnit } from './unit-conversion';

/**
 * Getting from the unit a thing is BOUGHT in to the unit it is USED in.
 *
 * `RawMaterial.unit` is a label. No code converts it, and the recipe quantity
 * is taken at face value against the stock quantity — so an ingredient bought
 * by the kilo and portioned by the gram is out by a factor of a thousand in
 * every recipe that uses it.
 *
 * Drinks never exposed this: beans and milk are bought and used in the same
 * unit. A kitchen exposes it on the first sack of rice. Measured on real data
 * before the fix: a ₱220 dish came out costing ₱48,000 with 0 producible.
 *
 * The rules here are the spreadsheet importer's rules, moved somewhere the
 * app's own form can reach them. Two doors into the same field that disagree
 * is how a shop ends up with one ingredient stocked twice under two units.
 */
describe('unit conversion', () => {
  describe('unitFactor', () => {
    it('converts within a family', () => {
      expect(unitFactor('kg', 'g')).toBe(1000);
      expect(unitFactor('L', 'ml')).toBe(1000);
      expect(unitFactor('g', 'kg')).toBe(0.001);
    });

    it('refuses to cross families, because mass is not volume', () => {
      // 1 kg of oil is not 1 litre of oil, and guessing that it is would put a
      // wrong number into every recipe silently.
      expect(unitFactor('kg', 'ml')).toBeNull();
      expect(unitFactor('L', 'g')).toBeNull();
    });

    it('returns null for a container, which is not a quantity of anything', () => {
      // Only the person holding the bottle knows it is 750 ml. That is what
      // pack size is for.
      expect(unitFactor('pc', 'ml')).toBeNull();
      expect(unitFactor('pack', 'g')).toBeNull();
    });

    it('reads the way people actually write units', () => {
      expect(normUnit('Grams.')).toBe('gram');
      expect(unitFactor('Kilograms', 'grams')).toBe(1000);
      expect(unitFactor('Litre', 'mL')).toBe(1000);
    });
  });

  describe('resolveBuyUnit', () => {
    it('leaves an ordinary ingredient alone', () => {
      // Every drink ingredient, and every row created before this existed.
      const r = resolveBuyUnit({ unit: 'g', costPrice: 0.065 });
      expect(r).toEqual({ unit: 'g', costPrice: 0.065 });
    });

    it('treats the same unit written twice as nothing to do', () => {
      const r = resolveBuyUnit({ unit: 'g', costPrice: 2, recipeUnit: 'grams' });
      expect(r.error).toBeUndefined();
      expect(r.costPrice).toBe(2);
    });

    it('divides the cost when the units convert outright', () => {
      // ₱320/kg is ₱0.32/g. This is the case that was costing 1000x.
      const r = resolveBuyUnit({ unit: 'kg', costPrice: 320, recipeUnit: 'g' });
      expect(r.unit).toBe('g');
      expect(r.costPrice).toBeCloseTo(0.32, 6);
    });

    it('divides by the pack size for a countable container', () => {
      // 1 bottle = 750 ml at ₱150 is ₱0.20/ml.
      const r = resolveBuyUnit({ unit: 'pc', costPrice: 150, recipeUnit: 'ml', packSize: 750 });
      expect(r.unit).toBe('ml');
      expect(r.costPrice).toBeCloseTo(0.2, 6);
    });

    it('refuses a pack size when the units already convert', () => {
      // Given both, one of them has to be ignored, and silently picking either
      // one produces a cost that is wrong by whatever the other said.
      const r = resolveBuyUnit({ unit: 'kg', costPrice: 320, recipeUnit: 'g', packSize: 1000 });
      expect(r.error).toMatch(/leave Pack Size blank/i);
    });

    it('asks for a pack size rather than guessing one', () => {
      const r = resolveBuyUnit({ unit: 'sack', costPrice: 1400, recipeUnit: 'g' });
      expect(r.error).toMatch(/how many g are in one sack/i);
      // and nothing is silently converted on the way out
      expect(r.costPrice).toBe(1400);
      expect(r.unit).toBe('sack');
    });

    it('rejects a nonsense pack size instead of dividing by zero', () => {
      const r = resolveBuyUnit({ unit: 'pc', costPrice: 150, recipeUnit: 'ml', packSize: 0 });
      expect(r.error).toMatch(/positive number/i);
    });

    it('handles a missing cost without producing NaN', () => {
      // Cost is optional on the form; an ingredient can be created before
      // anyone knows what it costs.
      const r = resolveBuyUnit({ unit: 'kg', costPrice: null, recipeUnit: 'g' });
      expect(r.unit).toBe('g');
      expect(r.costPrice).toBe(0);
    });
  });
});
