/**
 * Run: cd apps/web && node --test app/procure/requests/low-stock-toast.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lowStockToast } from './low-stock-toast.ts';

const sugar = { name: 'White Sugar', unit: 'g', coming: 8000 };

test('low but already coming is not "nothing is below its reorder level"', () => {
  const t = lowStockToast({ added: 0, unmonitored: 0, toMake: [], onTheWay: [sugar] });
  assert.equal(t.kind, 'warning');
  assert.equal(t.message, 'Nothing new to add. White Sugar (8,000 g) is low but already on a sent or bought list.');
});

test('names the list when the API says which one', () => {
  const t = lowStockToast({ added: 0, onTheWay: [{ ...sugar, requestNumber: 'REQ-20260915-001' }] });
  assert.equal(t.message, 'Nothing new to add. White Sugar (8,000 g on REQ-20260915-001) is low but already on a sent or bought list.');
});

test('items added and items already coming are both said', () => {
  const t = lowStockToast({ added: 2, unmonitored: 1, onTheWay: [sugar] });
  assert.equal(t.kind, 'success');
  assert.equal(
    t.message,
    'Added 2 items that are below their reorder level. White Sugar (8,000 g) is low but already on a sent or bought list.' +
    ' 1 ingredient has no reorder level, so it can never show up here.',
  );
});

test('a long list is cut at three', () => {
  const many = ['Milk', 'Sugar', 'Rice', 'Oil', 'Salt'].map((name) => ({ name, unit: 'kg', coming: 1.5 }));
  const t = lowStockToast({ added: 0, unmonitored: 2, onTheWay: many });
  assert.equal(
    t.message,
    'Nothing new to add. Milk (1.5 kg), Sugar (1.5 kg), Rice (1.5 kg) and 2 more are low but already on a sent or bought list.' +
    ' 2 ingredients have no reorder level, so they can never show up here.',
  );
});

test('the messages from before onTheWay are unchanged', () => {
  assert.deepEqual(lowStockToast({ added: 0, unmonitored: 0 }), { kind: 'success', message: 'Nothing is below its reorder level right now.' });
  assert.deepEqual(lowStockToast({ added: 0, onTheWay: [] }), { kind: 'success', message: 'Nothing is below its reorder level right now.' });
  // One item is "that is below its", not "that are below their".
  assert.deepEqual(lowStockToast({ added: 1 }), { kind: 'success', message: 'Added 1 item that is below its reorder level.' });
  assert.deepEqual(
    lowStockToast({ added: 0, unmonitored: 3 }),
    { kind: 'warning', message: 'Nothing is below its reorder level. 3 ingredients have no reorder level, so they can never show up here.' },
  );
});

test('the Check stock handler uses it', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(page, /onSuccess: \(d: PullLowStockResult\) => \{[\s\S]{0,400}lowStockToast\(d\)/);
});
