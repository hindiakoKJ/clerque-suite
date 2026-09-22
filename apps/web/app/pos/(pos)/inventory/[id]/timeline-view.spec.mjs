/**
 * Run: cd apps/web && node --test "app/pos/(pos)/inventory/[id]/timeline-view.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowTitle, rowTone, summarize, onHandOf, orderHref, perUnitPeso } from './timeline-view.ts';

// The rows as GET /inventory/raw-materials/:id/movements sends them.
const delivery = { kind: 'RECEIPT',     quantity: 2000, totalValue: 2800,   reference: 'SI-10442' };
const batchOf  = { kind: 'RECEIPT',     quantity: 1400, totalValue: 126,    reference: 'BATCH-2026-09-19-a1b2c3' };
const sale     = { kind: 'CONSUMPTION', quantity: -30,  totalValue: -45,    reference: '2× Latte', orderId: 'o1' };
const prep     = { kind: 'PREP',        quantity: -300, totalValue: -445.8, reference: 'Teriyaki Sauce (2 batches)' };
const writeOff = { kind: 'WRITE_OFF',   quantity: -100, totalValue: -148.6, reference: null };
const missing  = { kind: 'COUNT',       quantity: -20,  totalValue: -29.72, reference: 'CC-0003' };
const found    = { kind: 'COUNT',       quantity: 5,    totalValue: 7.43,   reference: 'CC-0004' };

test('every kind of row has a heading in plain words', () => {
  assert.equal(rowTitle(delivery), 'Stock received');
  assert.equal(rowTitle(batchOf),  'Batch made');
  assert.equal(rowTitle(sale),     'Used by a sale');
  assert.equal(rowTitle(prep),     'Used in a prep batch');
  assert.equal(rowTitle(writeOff), 'Written off');
  assert.equal(rowTitle(missing),  'Missing at count');
  assert.equal(rowTitle(found),    'Found at count');
  assert.equal(rowTitle({ kind: 'SOMETHING_NEW', quantity: 1 }), 'Stock moved');
});

test('a write-off is coloured as a loss, a prep as a prep, a sale as a sale', () => {
  assert.equal(rowTone(delivery), 'in');
  assert.equal(rowTone(sale),     'sale');
  assert.equal(rowTone(prep),     'prep');
  assert.equal(rowTone(writeOff), 'out');
  assert.equal(rowTone(missing),  'count');
});

test('the range figures come from the same rows, write-offs and preps included', () => {
  const s = summarize([delivery, batchOf, sale, prep, writeOff, missing, found]);
  assert.equal(s.purchasesQty, 3400);
  assert.equal(s.purchasesValue, 2926);
  // Left the shelf: 30 sold + 300 into a prep + 100 written off + 20 missing. The 5 found is neither.
  assert.equal(s.usedQty, 450);
  assert.equal(+s.usedValue.toFixed(2), 669.12);
  assert.equal(s.writtenOffQty, 100);
  assert.equal(s.writtenOffValue, 148.6);
});

test('on hand is the stock book\'s figure, and the lots only when the API has nothing better', () => {
  const lots = [{ qtyRemaining: 1200, valueRemaining: 1680 }, { qtyRemaining: 769, valueRemaining: 1140 }];
  assert.deepEqual(onHandOf({ onHand: { quantity: 1829, value: 2743.5 }, lots }), { quantity: 1829, value: 2743.5, fromBook: true });
  assert.deepEqual(onHandOf({ lots }), { quantity: 1969, value: 2820, fromBook: false });
  assert.deepEqual(onHandOf(undefined), { quantity: 0, value: 0, fromBook: false });
});

test('the order number opens the order\'s own page', () => {
  assert.equal(orderHref('ord_1'), '/pos/orders/ord_1');
});

test('the page uses the helpers, opens on the shop\'s dates and never links to ?focus=', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /\/pos\/orders\?focus=/);
  assert.match(page, /orderHref\(/);
  assert.doesNotMatch(page, /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(page, /todayIso\(\)/);
  assert.match(page, /isoDaysFromToday\(-30\)/);
  assert.match(page, /onHandOf\(/);
  assert.match(page, /summarize\(/);
});

test('a cost per ml or per gram keeps its small decimals; the page uses it', () => {
  assert.equal(perUnitPeso(0.098), '₱0.098');     // was "₱0.10"
  assert.equal(perUnitPeso(0.0912), '₱0.0912');   // was "₱0.09"
  assert.equal(perUnitPeso(12.5), '₱12.50');
  assert.equal(perUnitPeso(1234.5), '₱1,234.50');
  const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(src, /WAC \{perUnitPeso\(/);
  assert.match(src, /@ \{perUnitPeso\(m\.unitCost\)\}/);
  assert.match(src, /\{perUnitPeso\(lot\.unitCost\)\}/);
});
