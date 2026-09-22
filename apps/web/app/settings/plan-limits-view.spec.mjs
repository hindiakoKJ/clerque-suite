/**
 * Run: cd apps/web && node --test app/settings/plan-limits-view.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { isUncapped, seatUsageLabel, branchUsageLabel } = await import('./plan-limits-view.ts');

describe('isUncapped: the placeholder ceilings mean "no limit"', () => {
  test('the plan table sentinels (9,999 seats, 999 branches) and the API sentinels (-1, 0)', () => {
    for (const n of [9_999, 999, 100_000, -1, 0, null, undefined]) assert.equal(isUncapped(n), true, String(n));
  });
  test('a real ceiling is a real ceiling', () => {
    for (const n of [1, 3, 5, 10, 50, 998]) assert.equal(isUncapped(n), false, String(n));
  });
});

describe('seatUsageLabel: what the Subscription page prints', () => {
  test('never "2 of 9999 (9997 remaining)"', () => {
    assert.equal(seatUsageLabel(2, 9_999), '2 · no limit');
    assert.equal(seatUsageLabel(2, -1), '2 · no limit');
  });
  test('a real cap shows the cap and what is left, never below zero', () => {
    assert.equal(seatUsageLabel(2, 5), '2 of 5 (3 remaining)');
    assert.equal(seatUsageLabel(6, 5), '6 of 5 (0 remaining)');
  });
});

describe('branchUsageLabel: what the Branches page prints', () => {
  test('never "1 of 999 active"', () => {
    assert.equal(branchUsageLabel(1, 999), '1 active · no limit');
    assert.equal(branchUsageLabel(1, 0), '1 active · no limit');
  });
  test('a real cap shows the cap', () => {
    assert.equal(branchUsageLabel(1, 3), '1 of 3 active');
  });
});
