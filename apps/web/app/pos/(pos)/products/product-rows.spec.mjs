/**
 * Run: cd apps/web && node --test "app/pos/(pos)/products/product-rows.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchAllPages, vatBadge, isProductLow } from './product-rows.ts';

test('stock is read from every page, not only the first 50 rows', async () => {
  const asked = [];
  const rows = await fetchAllPages(async (page) => {
    asked.push(page);
    return { data: Array.from({ length: page < 3 ? 50 : 7 }, (_, i) => ({ id: `${page}-${i}` })), pages: 3 };
  });
  assert.deepEqual(asked, [1, 2, 3]);
  assert.equal(rows.length, 107);
});

test('a one-page list is asked for once', async () => {
  let calls = 0;
  const rows = await fetchAllPages(async () => { calls++; return { data: [{ id: 'a' }], pages: 1 }; });
  assert.equal(calls, 1);
  assert.equal(rows.length, 1);
});

test('a server that never says it is done cannot loop forever', async () => {
  let calls = 0;
  await fetchAllPages(async () => { calls++; return { data: [{ id: 'a' }], pages: 9999 }; }, 5);
  assert.equal(calls, 5);
  // An empty page also ends it.
  calls = 0;
  await fetchAllPages(async () => { calls++; return { data: [], pages: 9999 }; });
  assert.equal(calls, 1);
});

test('a Non-VAT shop is never told its products are EXEMPT', () => {
  assert.deepEqual(vatBadge(false, 'NON_VAT'), { label: 'NON-VAT', highlighted: false });
  assert.deepEqual(vatBadge(true,  'NON_VAT'), { label: 'NON-VAT', highlighted: false });
  assert.equal(vatBadge(false, 'UNREGISTERED').label, 'NO VAT');
});

test('a VAT shop still sees VAT and EXEMPT per product', () => {
  assert.deepEqual(vatBadge(true,  'VAT'), { label: 'VAT',    highlighted: true });
  assert.deepEqual(vatBadge(false, 'VAT'), { label: 'EXEMPT', highlighted: false });
  // Signed in before taxStatus was on the token: behaves as before.
  assert.equal(vatBadge(true, undefined).label, 'VAT');
});

test('the low-stock filter uses the same answer as the Stock column', () => {
  // Recipe-based product: no inventory row at all, the server says it is low.
  assert.equal(isProductLow({ stockQty: 2, isLowStock: true }, undefined), true);
  assert.equal(isProductLow({ stockQty: 40, isLowStock: false }, { isLowStock: true }), false);
  // Older API without stockQty: fall back to the inventory row.
  assert.equal(isProductLow({}, { isLowStock: true }), true);
  assert.equal(isProductLow({}, undefined), false);
});

test('the Products page uses these helpers', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(page, /fetchAllPages<InventoryStockRow>/);
  assert.doesNotMatch(page, /inventory\?branchId=\$\{userBranchId\}&page=1/);
  assert.match(page, /vatBadge\(p\.isVatable, user\?\.taxStatus\)/);
  assert.doesNotMatch(page, /p\.isVatable \? 'VAT' : 'EXEMPT'/);
});
