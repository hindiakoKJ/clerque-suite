/**
 * Run: cd apps/web && node --test "app/pos/(pos)/inventory/movements/movement-view.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  movementLabel, movementDirection, stockAfter, referenceText, manilaStamp, isStationWaste,
} from './movement-view.ts';

// The rows exactly as GET /inventory/movements sends them today.
const stationWaste = { kind: 'RAW_MATERIAL', type: 'STOCK_IN', quantity: -1, quantityBefore: null, quantityAfter: null, reference: 'WASTE-9e9258bb-1c1f-4c0e-9d7e-3a7c2a1b0f11' };
const writeOff     = { kind: 'RAW_MATERIAL', type: 'STOCK_IN', quantity: -100, quantityBefore: null, quantityAfter: null, reference: null };
const delivery     = { kind: 'RAW_MATERIAL', type: 'STOCK_IN', quantity: 2000, quantityBefore: null, quantityAfter: null, reference: 'SI-10442' };
const prepUse      = { kind: 'RAW_MATERIAL', type: 'STOCK_OUT', quantity: -760, quantityBefore: 0, quantityAfter: 0, reference: '0b1e6f0c-5a0e-4f0a-9a57-0d6f8f4f2a11' };
const sale         = { kind: 'PRODUCT', type: 'SALE_DEDUCTION', quantity: -1, quantityBefore: 5, quantityAfter: 4, reference: 'ORD-2026-000088' };

test('stock that left is never labelled Stock In', () => {
  assert.equal(movementLabel(stationWaste), 'Thrown out');
  assert.equal(movementLabel(writeOff), 'Stock Out');
  assert.equal(movementLabel(delivery), 'Stock In');
  assert.equal(movementLabel(prepUse), 'Stock Out');
  assert.equal(movementLabel(sale), 'Sale');
  assert.equal(isStationWaste(stationWaste), true);
  assert.equal(isStationWaste(delivery), false);
});

test('a type the page has not met is still readable, not SHOUTED_CODE', () => {
  assert.equal(movementLabel({ ...delivery, type: 'WRITE_OFF', quantity: -5 }), 'Write-off');
  assert.equal(movementLabel({ ...delivery, type: 'SOMETHING_NEW' }), 'Something new');
});

test('the arrow follows the quantity, the sale keeps its own colour', () => {
  assert.equal(movementDirection(stationWaste), 'out');
  assert.equal(movementDirection(delivery), 'in');
  assert.equal(movementDirection(sale), 'sale');
});

test('an unknown stock-after is blank, not 0', () => {
  assert.equal(stockAfter(prepUse), null);        // before 0, after 0, moved 760: never recorded
  assert.equal(stockAfter(writeOff), null);
  assert.equal(stockAfter(sale), 4);
  // Sold the last one: before 1, after 0 is a real zero and stays.
  assert.equal(stockAfter({ ...sale, quantityBefore: 1, quantityAfter: 0 }), 0);
});

test('the reference column shows numbers people use, not database ids', () => {
  assert.equal(referenceText('SI-10442'), 'SI-10442');
  assert.equal(referenceText('ORD-2026-000088'), 'ORD-2026-000088');
  assert.equal(referenceText(stationWaste.reference), 'Station tablet');
  assert.equal(referenceText(prepUse.reference), null);
  assert.equal(referenceText('cmuawzxzp000dvfl8rnr5bjg0'), null);
  assert.equal(referenceText(null), null);
});

test('the export is stamped with the shop\'s clock, not UTC', () => {
  // 23:30 UTC on the 21st is 07:30 on the 22nd in Manila.
  assert.equal(manilaStamp('2026-09-21T23:30:00.000Z'), '2026-09-22 07:30:00');
  assert.equal(manilaStamp('not a date'), '');
});

test('the page opens on the shop\'s dates and asks for the shop\'s day', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(page, /todayIso\(\)/);
  assert.match(page, /T00:00:00\+08:00/);
  assert.doesNotMatch(page, /from: new Date\(from\)\.toISOString\(\)/);
});
