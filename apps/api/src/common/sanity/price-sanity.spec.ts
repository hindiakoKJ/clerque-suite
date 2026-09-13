import {
  judgeCost, judgePrice, judgeMargin, isMagnitudeOff, isPackChanged, sanityValueKey,
} from '@repo/shared-types';

/**
 * The rules behind "are you sure this is the correct cost?".
 *
 * Pinned to the owner's own example: full cream milk that has cost ₱85 to ₱90 a
 * pack for months, typed today as ₱190. That must ask. An ordinary move — ₱90 to
 * ₱95, even a real jump to ₱115 — must not, or people learn to click through
 * the question and it protects nothing.
 */
describe('Does this number make sense?', () => {
  const MILK = [90, 90, 89, 88, 88, 87, 86, 85]; // newest first, ₱ per 1,000 ml pack

  describe('an ingredient cost against its recent deliveries', () => {
    it('asks about ₱190 for milk that usually costs ₱85 to ₱90', () => {
      const v = judgeCost({ typed: 190, history: MILK });
      expect(v.unusual).toBe(true);
      expect(v.direction).toBe('high');
      expect(v.basis).toBe('trend');
      expect(v.points).toBe(8);
      expect(v.median).toBe(88);
      expect(v.ratio).toBeCloseTo(2.16, 2);
    });

    it('stays quiet about an ordinary move', () => {
      expect(judgeCost({ typed: 95, history: MILK }).unusual).toBe(false);
      expect(judgeCost({ typed: 80, history: MILK }).unusual).toBe(false);
    });

    it('stays quiet about a real but believable jump', () => {
      expect(judgeCost({ typed: 115, history: MILK }).unusual).toBe(false);
    });

    it('asks about a dropped digit too', () => {
      const v = judgeCost({ typed: 19, history: MILK });
      expect(v.unusual).toBe(true);
      expect(v.direction).toBe('low');
    });

    it('shows the middle of the range as "usually", not the extremes', () => {
      const v = judgeCost({ typed: 190, history: MILK });
      expect(v.usualLow).toBeGreaterThanOrEqual(86);
      expect(v.usualHigh).toBeLessThanOrEqual(90);
    });

    it('does not let one confirmed wrong price open the band for every typo after it', () => {
      // Somebody said yes to ₱190 once. A later ₱200 should still ask.
      const polluted = [190, 90, 89, 88, 88, 87, 86, 85];
      expect(judgeCost({ typed: 200, history: polluted }).unusual).toBe(true);
    });

    it('with three or four deliveries uses no padding at all', () => {
      const few = [88, 88, 190];
      // median 88: the confirmed 190 does not widen anything
      expect(judgeCost({ typed: 200, history: few }).unusual).toBe(true);
      expect(judgeCost({ typed: 110, history: few }).unusual).toBe(false);
    });

    it('with one or two deliveries asks only at a bigger jump', () => {
      expect(judgeCost({ typed: 150, history: [90] }).unusual).toBe(false);   // 1.67x
      expect(judgeCost({ typed: 160, history: [90] }).unusual).toBe(true);    // 1.78x
      expect(judgeCost({ typed: 160, history: [90] }).basis).toBe('thin');
    });

    it('falls back to the cost on file when nothing has been delivered', () => {
      const v = judgeCost({ typed: 190, history: [], reference: 88 });
      expect(v.basis).toBe('thin');
      expect(v.unusual).toBe(true);
    });

    it('says nothing at all about an ingredient with no history and no cost', () => {
      const v = judgeCost({ typed: 190, history: [], reference: null });
      expect(v.basis).toBe('none');
      expect(v.unusual).toBe(false);
    });

    it('asks about a free delivery of something that normally costs money', () => {
      const v = judgeCost({ typed: 0, history: MILK });
      expect(v.unusual).toBe(true);
      expect(v.direction).toBe('low');
    });

    it('is more forgiving when the pack is a very different size from usual', () => {
      // An emergency 1 kg bag costs more per gram than the usual 50 kg sack.
      const sugar = [0.05, 0.05, 0.05, 0.05, 0.05]; // per g
      expect(judgeCost({ typed: 0.075, history: sugar }).unusual).toBe(true);
      expect(judgeCost({ typed: 0.075, history: sugar, packChanged: true }).unusual).toBe(false);
    });

    it('ignores deliveries with no cost', () => {
      const v = judgeCost({ typed: 190, history: [0, 0, 90, 88, 86] });
      expect(v.points).toBe(3);
      expect(v.unusual).toBe(true);
    });
  });

  describe('the order-of-magnitude question', () => {
    it('is true at ten times either way, and only then', () => {
      expect(isMagnitudeOff(0.9, 0.09)).toBe(true);    // pack size typed as 100 instead of 1,000
      expect(isMagnitudeOff(0.009, 0.09)).toBe(true);
      expect(isMagnitudeOff(0.19, 0.09)).toBe(false);
      expect(isMagnitudeOff(0.9, null)).toBe(false);
    });
  });

  describe('a pack that is a different size', () => {
    it('counts as changed at twice or half the usual size', () => {
      expect(isPackChanged(1000, 50000)).toBe(true);
      expect(isPackChanged(1000, 1000)).toBe(false);
      expect(isPackChanged(1500, 1000)).toBe(false);
      expect(isPackChanged(1000, null)).toBe(false);
    });
  });

  describe('a selling price against the one it replaces', () => {
    it('asks when a price jumps by a third or more', () => {
      expect(judgePrice({ prior: 150, typed: 1500 }).unusual).toBe(true);
      expect(judgePrice({ prior: 150, typed: 210 }).unusual).toBe(true);
      expect(judgePrice({ prior: 150, typed: 15 }).unusual).toBe(true);
    });

    it('stays quiet about an ordinary price change', () => {
      expect(judgePrice({ prior: 150, typed: 160 }).unusual).toBe(false);
      expect(judgePrice({ prior: 150, typed: 180 }).unusual).toBe(false);
    });

    it('asks when a priced item would ring up free', () => {
      const v = judgePrice({ prior: 150, typed: 0 });
      expect(v.unusual).toBe(true);
      expect(v.free).toBe(true);
    });

    it('says nothing about the first price a product is given', () => {
      expect(judgePrice({ prior: null, typed: 999 }).unusual).toBe(false);
    });
  });

  describe('what it costs to make against what it sells for', () => {
    it('flags a drink that costs more to make than it sells for', () => {
      const v = judgeMargin({ cost: 210, price: 150, vatable: true, vatTenant: false });
      expect(v.losesMoney).toBe(true);
      expect(v.marginShare).toBeLessThan(0);
    });

    it('takes VAT out of the shelf price before comparing, for a VAT-registered shop', () => {
      // ₱112 shelf price is ₱100 net. A ₱105 recipe loses money there,
      // though it would look profitable against the gross price.
      const vat = judgeMargin({ cost: 105, price: 112, vatable: true, vatTenant: true });
      expect(vat.netPrice).toBeCloseTo(100, 6);
      expect(vat.losesMoney).toBe(true);
      const nonVat = judgeMargin({ cost: 105, price: 112, vatable: true, vatTenant: false });
      expect(nonVat.losesMoney).toBe(false);
    });

    it('flags a recipe so cheap it is almost certainly in the wrong unit', () => {
      const v = judgeMargin({ cost: 0.5, price: 150, vatable: false, vatTenant: false });
      expect(v.suspiciouslyCheap).toBe(true);
    });

    it('stays quiet about an ordinary margin', () => {
      const v = judgeMargin({ cost: 45, price: 150, vatable: false, vatTenant: false });
      expect(v.losesMoney).toBe(false);
      expect(v.suspiciouslyCheap).toBe(false);
      expect(v.marginShare).toBeCloseTo(0.7, 6);
    });

    it('says nothing when there is no cost to compare', () => {
      const v = judgeMargin({ cost: null, price: 150, vatable: false, vatTenant: false });
      expect(v.marginShare).toBeNull();
      expect(v.losesMoney).toBe(false);
    });
  });

  describe('the value a person confirms', () => {
    it('keeps nearby per-gram prices apart', () => {
      expect(sanityValueKey(0.068)).not.toBe(sanityValueKey(0.0684));
      expect(sanityValueKey(190)).toBe(sanityValueKey(190.0000001));
    });
  });
});
