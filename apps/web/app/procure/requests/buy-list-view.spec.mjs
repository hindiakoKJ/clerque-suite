/**
 * Run: cd apps/web && node --test app/procure/requests/buy-list-view.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chipsInOrder, listToOpen, recordsOn, showsRecordBoxes, startsTicked, startsTickedAsWalkIn,
  fillInWords, stillNeeds, lastPricedLines, priceCheck, firstWithoutPrice,
} from './buy-list-view.ts';

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
  assert.match(page, /const isTicked\s+= \(l: Line\) => ticked\[l\.id\]\s+\?\? \(startsTicked\(l, !!req && !!onTheWay\(req\)\) \|\| /);
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
  // Twice for Add photo, once for "Record something you bought".
  assert.equal((page.match(/canRecord && req\.status !== 'CANCELLED'/g) ?? []).length, 3);
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

// ── staff walk-in buys ──────────────────────────────────────────────────────

const req = (status, notes = null) => ({ status, notes });
const onTheWayTag = (r) => (r.notes ?? '').includes('[ONTHEWAY:');

test('staff open on the list being built when there is one; the owner keeps the old order', () => {
  // The kitchen's tap sent one list; somebody opened a fresh one since.
  const sent = req('SENT');
  const open = req('OPEN');
  const waiting = req('BOUGHT');
  const live = [open, sent, waiting];
  assert.equal(listToOpen(live, true, onTheWayTag), open, 'staff: the list they can add to');
  assert.equal(listToOpen(live, false, onTheWayTag), waiting, 'owner: the delivery waiting to be posted');
  assert.equal(listToOpen([open, sent], false, onTheWayTag), sent);
});

test('with no list being built, staff get the same list as before', () => {
  const sent = req('SENT');
  const parcel = req('BOUGHT', '[ONTHEWAY:2026-09-17]');
  assert.equal(listToOpen([parcel, sent], true, onTheWayTag), sent);
  assert.equal(listToOpen([parcel], true, onTheWayTag), parcel);
  assert.equal(listToOpen([], true, onTheWayTag), null);
  // An order still on the way never sits in front of today's list.
  const open = req('OPEN');
  assert.equal(listToOpen([parcel, open], false, onTheWayTag), open);
});

test('a line added as a walk-in buy starts ticked until something is recorded on it', () => {
  const items = new Set(['ice']);
  assert.equal(startsTickedAsWalkIn({ rawMaterialId: 'ice', packsBought: null, receivedAt: null }, items), true);
  assert.equal(startsTickedAsWalkIn({ rawMaterialId: 'milk', packsBought: null, receivedAt: null }, items), false);
  assert.equal(startsTickedAsWalkIn({ rawMaterialId: 'ice', packsBought: 2, receivedAt: null }, items), false);
  assert.equal(startsTickedAsWalkIn({ rawMaterialId: 'ice', packsBought: null, receivedAt: '2026-09-17' }, items), false);
});

test('the page: staff open on the list being built, and "Record something you bought" is one tap from any list', () => {
  assert.match(page, /const byNeed = listToOpen\(live, !canDecide, \(r\) => !!onTheWay\(r\)\);/);
  // Only for whoever may record, and never on a cancelled list: the cost-visibility rule is unchanged.
  assert.match(page, /\{canRecord && req\.status !== 'CANCELLED' && !\(walkInPicking && picking\) && \(/);
  assert.match(page, /Record something you bought<\/span>/);
  // From a sent or bought list it opens the list being built for the same branch, then the picker.
  assert.match(page, /onClick=\{\(\) => \(req\.status === 'OPEN' \? beginWalkIn\(req\) : startWalkIn\.mutate\(\)\)\}/);
  assert.match(page, /api\.post\('\/procure\/requests\/open', \{ branchId: req\?\.branch\?\.id \?\? branchId \}\)/);
  assert.match(page, /setWalkInPicking\(true\);\s+setPicking\(true\);/);
  // The walk-in flag is the screen's; it is never posted with the line.
  assert.match(page, /mutationFn: \(\{ walkIn: _walkIn, \.\.\.v \}/);
  assert.match(page, /walkIn: walkInPicking \}\);/);
  // A walk-in line starts ticked only on the list it was added to.
  assert.match(page, /walkIn === req\.id && startsTickedAsWalkIn\(l, walkInItems\)/);
});

test('staff hints no longer say the owner sends the list at cut-off, nor that only the owner records', () => {
  assert.doesNotMatch(page, /sends this list when the shift cuts off/);
  assert.match(page, /It is sent to the owner from the kitchen or bar screen, or at closing time\./);
  // KJ, 2026-09-21: staff on a shop that hides costs record too, without a price.
  assert.doesNotMatch(page, /on this account only they record purchases/);
  assert.match(page, /Bought something\? Tick it if it is on the list, or tap Record something you bought above, then save\./);
});

// ── a shop that hides purchase costs from staff (KJ, 2026-09-21) ────────────

test('staff who do not see costs are asked for packs only; everyone else for packs and price', () => {
  assert.equal(fillInWords(true), 'packs and price');
  assert.equal(fillInWords(false), 'packs');
  assert.equal(stillNeeds({ packsBought: 2, packSize: 5000 }, false), null);
  assert.equal(stillNeeds({ packsBought: 2, packSize: 5000 }, true), 'fill in packs, what one holds, and the price.');
  assert.equal(stillNeeds({ packsBought: 2, packSize: 5000, packCost: 60 }, true), null);
  assert.equal(stillNeeds({ packsBought: NaN, packSize: 5000 }, false), 'fill in packs and what one holds.');
  assert.equal(stillNeeds({ packsBought: 2, packSize: NaN }, false), 'fill in packs and what one holds.');
});

test('the owner is told which prices are from last time and which are missing', () => {
  const notes = '[ONTHEWAY:2026-09-21] [LASTPRICE:l1,l3] Ice from the corner store';
  const last = lastPricedLines(notes);
  assert.deepEqual([...last], ['l1', 'l3']);
  assert.deepEqual([...lastPricedLines(null)], []);
  assert.deepEqual([...lastPricedLines('[ONTHEWAY:2026-09-21]')], []);

  const line = (id, over = {}) => ({ id, packsBought: 2, packCost: 60, receivedAt: null, ...over });
  assert.equal(priceCheck(line('l1'), last), 'Price from last purchase — check the receipt.');
  assert.equal(priceCheck(line('l2', { packCost: null }), last), 'No price yet — add it from the receipt before posting.');
  assert.equal(priceCheck(line('l2'), last), null, 'a price somebody who sees costs typed is not questioned');
  assert.equal(priceCheck(line('l1', { receivedAt: '2026-09-21' }), last), null, 'posted: nothing to check');
  assert.equal(priceCheck(line('l4', { packsBought: null, packCost: null }), last), null, 'not bought yet');
});

test('posting stops at the first line with no price, unless one is being typed now', () => {
  const ice  = { id: 'l1', packCost: '60.0000' };
  const milk = { id: 'l2', packCost: null };
  assert.equal(firstWithoutPrice([ice, milk], () => undefined), milk);
  assert.equal(firstWithoutPrice([ice, milk], (l) => (l.id === 'l2' ? 95 : undefined)), null);
  assert.equal(firstWithoutPrice([ice], () => undefined), null);
});

test('the page: staff who do not see costs get no price box, no totals, no peso', () => {
  assert.match(page, /const canRecord = !!user;/);
  assert.match(page, /const noPrice\s+= !!req\.costsHidden;/);
  // The price box, the cost hint and the line total only for whoever sees costs.
  assert.match(page, /\{!noPrice && \(\s+<label className="text-\[11px\] text-muted-foreground">\s+Price per pack/);
  assert.match(page, /show=\{!noPrice && !!bought\[l\.id\] && !!enteredCost\[l\.id\]\}/);
  assert.match(page, /\{lineTotal > 0 && !noPrice && \(/);
  assert.match(page, /\{!noPrice && <span className="mt-0\.5 block">Type each price after vouchers\./);
  // "Spent" and the paid-ahead figure were already hidden by the same flag.
  assert.match(page, /\{estimate > 0 && !req\.costsHidden && \(/);
  // Save sends no price from them, and asks only for packs and size.
  assert.match(page, /\.\.\.\(withPrice \? \{ packCost: parseFloat\(b\.cost\) \} : \{\}\),/);
  assert.match(page, /const half = rows\.find\(\(r\) => stillNeeds\(r, withPrice\)\);/);
  assert.doesNotMatch(page, /fill in the packs and price/, 'every "packs and price" hint goes through fillInWords');
});

test('the page: the owner sees the price from last time flagged, and posting refuses a line with none', () => {
  assert.match(page, /const lastPriced = lastPricedLines\(req\.notes\);/);
  assert.match(page, /\{!noPrice && !bought\[l\.id\] && priceCheck\(l, lastPriced\) && \(/);
  assert.match(page, /if \(unpriced\) throw new Error\(`\$\{unpriced\.rawMaterial\.name\}: add the price from the receipt before posting\.`\);/);
  // Checked before the fixes are sent, so nothing posts half-way.
  assert.ok(page.indexOf('if (unpriced) throw') < page.indexOf("await api.post(`/procure/requests/${req.id}/bought`, { lines: fixes }"));
});
