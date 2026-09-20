/**
 * Run: cd apps/web && node --test components/pos/station-request-amount.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_QTY, amountWords, parseAmount, stepDown, stepOf, stepUp } from './station-request-amount.ts';

const panel = readFileSync(new URL('./StationRequestPanel.tsx', import.meta.url), 'utf8');

test('a tap moves a whole pack when Clerque knows the pack, else 100 g or ml, else one of the unit', () => {
  assert.equal(stepOf('ml', 1000), 1000);
  assert.equal(stepOf('g', 250), 250);
  assert.equal(stepOf('g', null), 100);
  assert.equal(stepOf(' ML ', 0), 100);
  assert.equal(stepOf('pc', null), 1);
  assert.equal(stepOf('kg', null), 1);
  assert.equal(stepOf('roll', 12), 12);
});

test('+ and - move by whole steps, and a typed amount lands back on one', () => {
  assert.equal(stepUp(1000, 1000), 2000);
  assert.equal(stepDown(2000, 1000), 1000);
  // Typed 1,500 ml with 1,000 ml packs: + is 2 packs, - is 1 pack.
  assert.equal(stepUp(1500, 1000), 2000);
  assert.equal(stepDown(1500, 1000), 1000);
  // Never under one step, never past the server's limit.
  assert.equal(stepDown(100, 100), 100);
  assert.equal(stepDown(50, 100), 100);
  assert.equal(stepUp(MAX_QTY - 50, 100), MAX_QTY);
  // A 750.5 ml pack stepped three times sends four decimals, not 2251.4999999.
  assert.equal(stepUp(stepUp(750.5, 750.5), 750.5), 2251.5);
});

test('an amount can be typed: 2 kg of beans is one entry, not twenty taps of 100 g', () => {
  assert.equal(parseAmount('2000'), 2000);
  assert.equal(parseAmount(' 2,000 '), 2000);
  assert.equal(parseAmount('1.5'), 1.5);
  assert.equal(parseAmount('.5'), 0.5);
  for (const bad of ['', '0', '-1', 'abc', '1.2.3', '2 kg', String(MAX_QTY + 1)]) {
    assert.equal(parseAmount(bad), null, `"${bad}" is refused`);
  }
});

test('the amount in words shows packs when the pack is known', () => {
  assert.equal(amountWords(2000, 'ml', 1000), '2 packs (2,000 ml)');
  assert.equal(amountWords(1000, 'ml', 1000), '1 pack (1,000 ml)');
  assert.equal(amountWords(2000, 'g', null), '2,000 g');
});

test('the panel uses the helpers: a typed box between - and +, and no sending a refused amount', () => {
  assert.match(panel, /from '\.\/station-request-amount'/);
  assert.match(panel, /onClick=\{\(\) => setQty\(d\.key, \{ qty: stepDown\(d\.qty, step\) \}\)\}/);
  assert.match(panel, /onClick=\{\(\) => setQty\(d\.key, \{ qty: stepUp\(d\.qty, step\) \}\)\}/);
  assert.match(panel, /inputMode="decimal"\s+value=\{typing\[d\.key\] \?\? String\(d\.qty\)\}/);
  assert.match(panel, /disabled=\{drafts\.length === 0 \|\| sending \|\| badAmount\}/);
  assert.doesNotMatch(panel, /function stepOf\(/, 'one stepOf, in the helper');
});

test('first days: the panel says Clerque is still learning instead of implying all is well', () => {
  assert.match(panel, /export const LEARNING_NOTE = 'Clerque is still learning your usage\. Add what you know is low with \+\.';/);
  assert.match(panel, /\{result\.learning && \(/);
  // The "cannot see" hint is the all-is-well reading; it gives way to the learning note.
  assert.match(panel, /\{nothingToShow && !result\.learning && \(/);
});
