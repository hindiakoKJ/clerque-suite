/**
 * Run: cd apps/web && node --test app/procure/receipts/receipt-list.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTag, manilaDay, receiptDateFor, listToAsk, askText, keepWorkOnList } from './receipt-list.ts';

// ── the receipt date ─────────────────────────────────────────────────────────

test('a typed "Bought on" day (Manila midnight, 16:00 UTC the day before) is that day, not the day before', () => {
  assert.equal(receiptDateFor({ boughtAt: '2026-09-15T16:00:00.000Z', notes: null }, '2026-09-17'), '2026-09-16');
});

test('a list saved as bought before 08:00 in Manila keeps its Manila day', () => {
  // 07:30 on 16 Sep in Manila is 23:30 UTC on 15 Sep.
  assert.equal(receiptDateFor({ boughtAt: '2026-09-15T23:30:00.000Z' }, '2026-09-17'), '2026-09-16');
});

test('an order still on the way starts on today: it is arriving now', () => {
  const r = { boughtAt: '2026-09-10T16:00:00.000Z', notes: '[ONTHEWAY:2026-09-11] [PREPAID:OWNER_FUNDED] Shopee' };
  assert.equal(receiptDateFor(r, '2026-09-17'), '2026-09-17');
});

test('a list not bought yet, or with a broken date, starts on today', () => {
  assert.equal(receiptDateFor({ boughtAt: null }, '2026-09-17'), '2026-09-17');
  assert.equal(receiptDateFor({ boughtAt: 'not a date' }, '2026-09-17'), '2026-09-17');
  assert.equal(manilaDay('not a date'), null);
});

test('only the tags at the front are tags; a person\'s words further along are not', () => {
  assert.equal(readTag('[RCPT:k1] [ONTHEWAY:2026-09-11] note', 'ONTHEWAY'), '2026-09-11');
  assert.equal(readTag('Bought at Puregold [ONTHEWAY:2026-09-11]', 'ONTHEWAY'), null);
  assert.equal(receiptDateFor({ boughtAt: '2026-09-15T16:00:00.000Z', notes: 'said [ONTHEWAY:x]' }, '2026-09-17'), '2026-09-16');
});

// ── which list to ask about ──────────────────────────────────────────────────

const line = (name, receivedAt = null) => ({ receivedAt, rawMaterial: { name } });
const sent   = { id: 's1', requestNumber: 'REQ-20260917-002', status: 'SENT',   notes: null, lines: [line('Ice'), line('Water')] };
const bought = { id: 'b1', requestNumber: 'REQ-20260916-001', status: 'BOUGHT', notes: 'Puregold', lines: [line('Sugar'), line('Fresh Milk')] };
const parcel = { id: 'p1', requestNumber: 'REQ-20260912-001', status: 'BOUGHT', notes: '[ONTHEWAY:2026-09-12] [PREPAID:OWNER_FUNDED]', lines: [line('Matcha')] };

test('shopping saved as bought is asked about before a sent list', () => {
  assert.equal(listToAsk([sent, bought])?.id, 'b1');
});

test('an order still on the way is never asked about', () => {
  assert.equal(listToAsk([parcel]), null);
  assert.equal(listToAsk([parcel, sent])?.id, 's1');
});

test('a list the person said no to is not asked about again; the next one is', () => {
  assert.equal(listToAsk([sent, bought], ['b1'])?.id, 's1');
  assert.equal(listToAsk([sent, bought], ['b1', 's1']), null);
});

test('a list with every line already in stock is not waiting for anything', () => {
  const done = { ...bought, lines: [line('Sugar', '2026-09-16T02:00:00.000Z')] };
  assert.equal(listToAsk([done]), null);
});

test('the question names the list and what is on it, in plain words', () => {
  assert.deepEqual(askText(bought), {
    question: 'Is this the shopping for REQ-20260916-001?',
    detail:   'That list is saved as bought but is not in stock yet: Sugar and Fresh Milk. If yes, this receipt goes onto that list, so nothing is added twice.',
  });
  const long = { ...sent, lines: ['Ice', 'Water', 'Sugar', 'Milk', 'Cups'].map((n) => line(n)) };
  assert.equal(askText(long).detail, 'That list was sent out for buying: Ice, Water, Sugar and 2 more. If yes, this receipt goes onto that list, so nothing is added twice.');
});

// ── picking the list after lines are already on screen ──────────────────────

const row = (over) => ({
  kind: 'stock', rawMaterialId: '', createNew: false, description: '', packs: '1', size: '', cost: '', brand: '', amount: '', fromLine: false, ...over,
});

test('lines already on screen are kept: one for an ingredient on the list lands on that row', () => {
  const listRows = [
    row({ rawMaterialId: 'sugar', description: 'Sugar', kind: 'skip', packs: '2', size: '1000', cost: '80', fromLine: true }),
    row({ rawMaterialId: 'milk',  description: 'Fresh Milk', kind: 'skip', packs: '1', size: '1000', cost: '95', fromLine: true }),
  ];
  const onScreen = [
    row({ rawMaterialId: 'sugar', description: 'WHITE SUGAR 1KG', packs: '3', size: '', cost: '85', fromReader: true, fromPhoto: 1 }),
    row({ kind: 'expense', description: 'Parking', amount: '40' }),
    row({}),                                                   // the blank row a photo adds
  ];
  const out = keepWorkOnList(listRows, onScreen, () => false);
  assert.equal(out.length, 3);
  assert.deepEqual(
    { ...out[0] },
    { ...onScreen[0], kind: 'stock', packs: '3', size: '1000', cost: '85', brand: '', fromLine: true },
  );
  assert.equal(out[1], listRows[1]);                          // not on the receipt: still the list's own row
  assert.equal(out[2].description, 'Parking');
});

test('packs a shopper recorded on the list are not overwritten by the receipt', () => {
  const listRows = [row({ rawMaterialId: 'sugar', kind: 'stock', packs: '2', size: '1000', cost: '80', fromLine: true })];
  const onScreen = [row({ rawMaterialId: 'sugar', description: 'SUGAR', packs: '5', cost: '85' })];
  const out = keepWorkOnList(listRows, onScreen, (id) => id === 'sugar');
  assert.equal(out[0].packs, '2');
  assert.equal(out[0].cost, '85');
});

test('with nothing on screen the list\'s rows are exactly what shows', () => {
  const listRows = [row({ rawMaterialId: 'sugar', fromLine: true })];
  assert.deepEqual(keepWorkOnList(listRows, [], () => false), listRows);
});

test('a second screen line of the same ingredient stays its own line; a new ingredient is never landed', () => {
  const listRows = [row({ rawMaterialId: 'sugar', fromLine: true })];
  const onScreen = [
    row({ rawMaterialId: 'sugar', description: 'SUGAR A', cost: '85' }),
    row({ rawMaterialId: 'sugar', description: 'SUGAR B', cost: '90' }),
    row({ createNew: true, description: 'Oat milk', cost: '150' }),
  ];
  const out = keepWorkOnList(listRows, onScreen, () => false);
  assert.deepEqual(out.map((r) => r.description), ['SUGAR A', 'SUGAR B', 'Oat milk']);
  assert.equal(out[0].fromLine, true);
  assert.equal(out[1].fromLine, false);
});
