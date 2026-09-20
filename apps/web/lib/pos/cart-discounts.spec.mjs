/**
 * Run: cd apps/web && node --test lib/pos/cart-discounts.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts file directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { oneUnitSubtotal, unclaimedVatableSubtotal, discountRemovedMessage } =
  await import('./cart-discounts.ts');

/** A cart line, the few fields these rules read. */
const line = (lineKey, unitPrice, quantity, { itemDiscount = 0, isVatable = true } = {}) =>
  ({ lineKey, unitPrice, quantity, itemDiscount, product: { isVatable } });

describe('oneUnitSubtotal — what the Senior/PWD 20% is taken on', () => {
  test('one unit of a ticked line, however many were ordered', () => {
    // 2 lattes at 150 on one line: the senior gets 20% of ONE latte (30), not 60.
    assert.equal(oneUnitSubtotal([line('a', 150, 2)], ['a']), 150);
  });

  test('ticking every line is still one unit each, never the whole cart', () => {
    // The old till took 20% of the cart subtotal (450) when every line was
    // ticked, so a 2-latte line was discounted twice over.
    const lines = [line('a', 150, 2), line('b', 60, 3)];
    assert.equal(oneUnitSubtotal(lines, ['a', 'b']), 210);
  });

  test('lines nobody ticked are left out', () => {
    assert.equal(oneUnitSubtotal([line('a', 150, 2), line('b', 60, 1)], ['a']), 150);
  });

  test('a line-level discount comes off the unit first', () => {
    assert.equal(oneUnitSubtotal([line('a', 150, 2, { itemDiscount: 20 })], ['a']), 130);
  });

  test('nothing ticked is nothing discounted', () => {
    assert.equal(oneUnitSubtotal([line('a', 150, 2)], []), 0);
  });

  test('a key for a line that is gone is ignored', () => {
    assert.equal(oneUnitSubtotal([line('a', 150, 1)], ['a', 'ghost']), 150);
  });
});

describe('unclaimedVatableSubtotal — what still carries full VAT', () => {
  test('the units past the first on a claimed line are sold at full price', () => {
    // 2 lattes, one claimed: the second still carries VAT.
    assert.equal(unclaimedVatableSubtotal([line('a', 150, 2)], new Set(['a'])), 150);
  });

  test('every unit of a line nobody claimed', () => {
    assert.equal(unclaimedVatableSubtotal([line('a', 150, 2)], new Set()), 300);
  });

  test('a claimed single-unit line leaves nothing behind', () => {
    assert.equal(unclaimedVatableSubtotal([line('a', 150, 1)], new Set(['a'])), 0);
  });

  test('non-vatable lines collect no VAT, claimed or not', () => {
    const lines = [line('a', 150, 3, { isVatable: false }), line('b', 100, 2)];
    assert.equal(unclaimedVatableSubtotal(lines, new Set(['b'])), 100);
  });

  test('a line discount comes off before VAT', () => {
    assert.equal(unclaimedVatableSubtotal([line('a', 150, 2, { itemDiscount: 50 })], new Set()), 200);
  });
});

describe('discountRemovedMessage — what the cashier is told', () => {
  test('nothing to say when the order carries no discount', () => {
    assert.equal(discountRemovedMessage(null, 0), null);
    assert.equal(discountRemovedMessage(undefined), null);
  });

  test('a senior discount is named, and asks for it again', () => {
    const msg = discountRemovedMessage({ type: 'SENIOR_CITIZEN' }, 0);
    assert.match(msg, /Senior\/PWD discount was taken off/);
    assert.match(msg, /apply it again/);
  });

  test('a PWD discount says the same', () => {
    assert.match(discountRemovedMessage({ type: 'PWD' }, 0), /Senior\/PWD/);
  });

  test("a cashier's discount is just a discount", () => {
    const msg = discountRemovedMessage({ type: 'CASHIER_APPLIED' }, 0);
    assert.match(msg, /the discount was taken off/);
    assert.doesNotMatch(msg, /Senior/);
  });

  test('a second senior on the order counts even with no first discount left', () => {
    assert.match(discountRemovedMessage(null, 1), /Senior\/PWD/);
  });

  test('plain English: no code, no jargon', () => {
    for (const msg of [
      discountRemovedMessage({ type: 'SENIOR_CITIZEN' }, 0),
      discountRemovedMessage({ type: 'CASHIER_APPLIED' }, 0),
    ]) {
      assert.doesNotMatch(msg, /orderDiscount|lineKey|null|undefined/);
    }
  });
});
