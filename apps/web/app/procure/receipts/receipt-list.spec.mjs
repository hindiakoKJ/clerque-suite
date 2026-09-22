/**
 * Run: cd apps/web && node --test app/procure/receipts/receipt-list.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readTag, manilaDay, receiptDateFor, listsToAsk, askChoice, ASK_NONE, unitCostText, nothingToPostText, keepWorkOnList,
  closestByName,
} from './receipt-list.ts';

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

const ids = (lists) => lists.map((r) => r.id);

test('every waiting list is offered at once, shopping saved as bought before a sent list', () => {
  assert.deepEqual(ids(listsToAsk([sent, bought])), ['b1', 's1']);
});

test('sixteen waiting lists are one question, not sixteen', () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ ...sent, id: `s${i}`, requestNumber: `REQ-20260917-${String(i + 1).padStart(3, '0')}` }));
  assert.equal(listsToAsk(many).length, 16);
  // One "none of these" answers for all of them.
  assert.deepEqual(listsToAsk(many, ids(many)), []);
});

test('an order still on the way is never offered', () => {
  assert.deepEqual(listsToAsk([parcel]), []);
  assert.deepEqual(ids(listsToAsk([parcel, sent])), ['s1']);
});

test('"none of these" is remembered: the same lists are not asked about again for the next receipt', () => {
  assert.deepEqual(listsToAsk([sent, bought], ['b1', 's1']), []);
});

test('a list that turns up after "none of these" brings the question back, with every list in it', () => {
  const later = { ...sent, id: 's2', requestNumber: 'REQ-20260918-001' };
  assert.deepEqual(ids(listsToAsk([later, sent, bought], ['b1', 's1'])), ['b1', 's2', 's1']);
});

test('a list with every line already in stock is not waiting for anything', () => {
  const done = { ...bought, lines: [line('Sugar', '2026-09-16T02:00:00.000Z')] };
  assert.deepEqual(listsToAsk([done]), []);
});

test('each choice names the list, where it is up to and what is on it, in plain words', () => {
  assert.deepEqual(askChoice(bought), {
    label:  'REQ-20260916-001',
    detail: 'Saved as bought, not in stock yet: Sugar and Fresh Milk',
  });
  const long = { ...sent, lines: ['Ice', 'Water', 'Sugar', 'Milk', 'Cups'].map((n) => line(n)) };
  assert.equal(askChoice(long).detail, 'Sent out for buying: Ice, Water, Sugar and 2 more');
  assert.equal(ASK_NONE, 'None of these — it is a separate trip');
});

test('the screen asks once with every list, offers "none of these", and keeps the answer across Another receipt', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(page, /listsToAsk\(/);
  assert.match(page, /ASK_NONE/);
  // reset() is what Another receipt and Start over run: it must not forget the answer.
  const reset = page.slice(page.indexOf('function reset('), page.indexOf('function fixAndRetry('));
  assert.ok(reset.length > 0);
  assert.doesNotMatch(reset, /setNotTheseLists\(/);
});

// ── what the posted screen and the problems list say ─────────────────────────

test('a cost per millilitre keeps the decimals it lives in, and says its unit', () => {
  assert.equal(unitCostText(0.098, 'ml'), '₱0.098 / ml');
  assert.equal(unitCostText(0.0049, 'g'), '₱0.0049 / g');
  assert.equal(unitCostText(45, 'pc'), '₱45.00 / pc');
  assert.equal(unitCostText(1.5), '₱1.50');
});

test('a list whose lines all start on Skip is told what to tap, not "add a line"', () => {
  assert.equal(nothingToPostText([]), 'Add at least one line.');
  assert.equal(nothingToPostText([{ kind: 'skip' }, { kind: 'skip' }]), 'Every line is on Skip. Tap "Goes on the shelf" on what was bought.');
  assert.equal(nothingToPostText([{ kind: 'skip' }, { kind: 'stock' }]), null);
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

// ── a hand-typed line gets a short list at the top of the picker ────────────

const shelf = [
  { id: 'm1', name: 'Fresh Milk', unit: 'ml' },
  { id: 'm2', name: 'Emborg Fresh Milk', unit: 'ml' },
  { id: 'c1', name: 'Chocolate Syrup', unit: 'ml' },
  { id: 's1', name: 'Sugar', unit: 'g' },
  { id: 'i1', name: 'Ice', unit: 'g' },
];

test('a typed line puts the ingredients that share its words first, best first', () => {
  assert.deepEqual(closestByName('Emborg fresh milk 1L', shelf).map((x) => x.id), ['m2', 'm1']);
  assert.deepEqual(closestByName('CHOC SYRUP', shelf).map((x) => x.id), ['c1']);
});

test('nothing typed, or only short words, suggests nothing', () => {
  assert.deepEqual(closestByName('', shelf), []);
  assert.deepEqual(closestByName('1L x2', shelf), []);
});

test('never more than five', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, name: `Milk ${i}` }));
  assert.equal(closestByName('milk', many).length, 5);
});

test('the picker uses it when the reader gave no matches', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(page, /: r\.kind === 'stock' && !r\.createNew \? closestByName\(r\.description, ingredients\) : \[\];/);
  assert.match(page, /\{near\.map\(\(a\) => <option key=\{a\.id\} value=\{a\.id\}>/);
});
