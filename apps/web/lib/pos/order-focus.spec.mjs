/**
 * Run: cd apps/web && node --test lib/pos/order-focus.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts file directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { resolveOrderFocus } = await import('./order-focus.ts');

const orders = [
  { id: 'cmt_a', orderNumber: 'ORD-2026-000088' },
  { id: 'cmt_b', orderNumber: 'ORD-2026-000089' },
];

test('the order is on screen: open that row', () => {
  assert.deepEqual(resolveOrderFocus('cmt_b', orders), { kind: 'expand', orderId: 'cmt_b' });
});

test('an order number works as well as an id', () => {
  assert.deepEqual(resolveOrderFocus('ORD-2026-000088', orders), { kind: 'expand', orderId: 'cmt_a' });
});

test('older than the list, or another branch: go to the order page instead of leaving her on an unfiltered list', () => {
  assert.deepEqual(resolveOrderFocus('cmt_old', orders), { kind: 'open', href: '/pos/orders/cmt_old' });
});

test('"?focus=" with nothing after it (a stock movement with no order) does nothing', () => {
  assert.equal(resolveOrderFocus('', orders), null);
  assert.equal(resolveOrderFocus('   ', orders), null);
  assert.equal(resolveOrderFocus(null, orders), null);
  assert.equal(resolveOrderFocus(undefined, orders), null);
});

test('an odd value cannot break out of the /pos/orders path', () => {
  assert.deepEqual(resolveOrderFocus('../settings?x=1', []), { kind: 'open', href: '/pos/orders/..%2Fsettings%3Fx%3D1' });
});

test('the Orders page really reads ?focus=', () => {
  const src = readFileSync(new URL('../../app/pos/(pos)/orders/page.tsx', import.meta.url), 'utf8');
  assert.match(src, /resolveOrderFocus\(/);
  assert.match(src, /\.get\('focus'\)/);
});
