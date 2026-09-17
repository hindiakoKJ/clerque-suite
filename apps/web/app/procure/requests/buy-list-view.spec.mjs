/**
 * Run: cd apps/web && node --test app/procure/requests/buy-list-view.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chipsInOrder, recordsOn, showsRecordBoxes, startsTicked } from './buy-list-view.ts';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

// Newest first, the way GET /procure/requests sends them.
const list = (statuses) => statuses.map((status, i) => ({ requestNumber: `REQ-${String(20 - i).padStart(2, '0')}`, status }));

test('a Shopee order still on the way is not pushed off by eight newer finished lists', () => {
  const all = list(['OPEN', ...Array(8).fill('RECEIVED'), 'BOUGHT']);
  const chips = chipsInOrder(all);
  assert.equal(chips.length, 8);
  assert.deepEqual(chips.slice(0, 2).map((r) => r.status), ['OPEN', 'BOUGHT']);
  assert.ok(chips.includes(all[9]), 'the oldest list, still bought and not in stock, keeps its chip');
});

test('still-open lists (open, sent, bought) come first, newest first; finished and cancelled after', () => {
  const all = list(['RECEIVED', 'OPEN', 'CANCELLED', 'SENT', 'RECEIVED', 'BOUGHT']);
  assert.deepEqual(
    chipsInOrder(all).map((r) => r.requestNumber),
    ['REQ-19', 'REQ-17', 'REQ-15', 'REQ-20', 'REQ-18', 'REQ-16'],
  );
});

test('with nothing past eight the chips are the same lists as before', () => {
  const all = list(['OPEN', 'RECEIVED', 'SENT']);
  assert.deepEqual(new Set(chipsInOrder(all)), new Set(all));
});

test('a recorded line starts ticked on a normal bought list, unticked on an order on the way', () => {
  assert.equal(startsTicked({ packsBought: '2' }, false), true);
  assert.equal(startsTicked({ packsBought: 2 }, true), false);
  assert.equal(startsTicked({ packsBought: null }, false), false);
  assert.equal(startsTicked({ packsBought: null }, true), false);
});

test('the page uses both, and Save still sends a recorded line that is not ticked', () => {
  assert.match(page, /chipsInOrder\(all\)\.map\(/);
  assert.doesNotMatch(page, /all\.slice\(0, 8\)/);
  assert.match(page, /const isTicked\s+= \(l: Line\) => ticked\[l\.id\] \?\? startsTicked\(l, !!req && !!onTheWay\(req\)\);/);
  assert.match(page, /\.filter\(\(l\) => !l\.receivedAt && \(isTicked\(l\) \|\| l\.packsBought != null\)\)/);
  assert.match(page, /if \(ordered\) setTicked\(\{\}\);/);
});

test('whoever may record can record on an open list too, never on a closed or cancelled one', () => {
  assert.deepEqual(['OPEN', 'SENT', 'BOUGHT', 'RECEIVED', 'CANCELLED'].map(recordsOn), [true, true, true, false, false]);
});

test('on an open list the record boxes wait for a tick; on a sent or bought list they always show', () => {
  assert.equal(showsRecordBoxes('OPEN', false), false);
  assert.equal(showsRecordBoxes('OPEN', true), true);
  assert.equal(showsRecordBoxes('SENT', false), true);
  assert.equal(showsRecordBoxes('BOUGHT', false), true);
});

test('the page records on an open list: the boxes, the footer and Save once ticked, and Add photo', () => {
  assert.match(page, /const recording = canRecord && recordsOn\(req\.status\);/);
  assert.match(page, /\{recording && !l\.receivedAt && showsRecordBoxes\(req\.status, tick\) && \(/);
  assert.match(page, /\{recording && postable\.length \+ unposted\.length > 0 && showsRecordBoxes\(req\.status, tickedAny\) && \(/);
  assert.match(page, /\{recording && \(req\.status === 'OPEN' \? tickedAny : \(req\.status === 'SENT' \|\| !canDecide\)\) && \(/);
  // Add photo: every status but cancelled, the open list included.
  assert.doesNotMatch(page, /canRecord && req\.status !== 'OPEN'/);
  assert.equal((page.match(/canRecord && req\.status !== 'CANCELLED'/g) ?? []).length, 2);
  // Posting, paying ahead and cancelling stay with the deciders.
  assert.match(page, /\{req\.status === 'BOUGHT' && canDecide && \(/);
  assert.match(page, /\{ordered && canDecide && !prepaid && \(/);
  assert.match(page, /\{canDecide && \(req\.status === 'OPEN' \|\| req\.status === 'SENT' \|\| req\.status === 'BOUGHT'\) && \(/);
});

test('screen text: shop cash is not the POS drawer, no balance promise, voucher help under on the way', () => {
  assert.match(page, /label: 'Shop cash \(not the POS drawer\)'/);
  assert.doesNotMatch(page, /From the till|Cash taken from the drawer|balance tonight/);
  assert.match(page, /Ordered — on the way\.[\s\S]{0,200}Type each price after vouchers\. Leave shipping out if it was free\./);
  assert.match(page, /v: 'CASH',/, 'the API value is unchanged');
});

test('Cash Out help says Paid Out is not for ice or water', () => {
  const modal = readFileSync(new URL('../../../components/pos/CashOutModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /Not for ingredients like ice or water; add those to stock in Procure\./);
  assert.doesNotMatch(modal, /ice run|COD payment|Bought ice/);
});
