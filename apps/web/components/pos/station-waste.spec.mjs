/**
 * Run: cd apps/web && node --test components/pos/station-waste.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * "Thrown out" on a kitchen or bar screen's Today's inventory: the amount the
 * cook types in the item's own unit, the pack helper, the reasons, and what
 * Save sends. Waste used to need Anne or a manager in Procure > Stock, so the
 * kitchen wrote it on paper and the stock stayed too high.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WASTE_REASONS, addPack, inPacks, packButtonLabel, parseWasteAmount, wasteNumber, wasteRequest,
} from './station-waste.ts';

const sheet = readFileSync(new URL('./StationInventorySheet.tsx', import.meta.url), 'utf8');
const KEY = 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

test('what the cook types reads as an amount, and nonsense does not', () => {
  assert.equal(parseWasteAmount('500'), 500);
  assert.equal(parseWasteAmount(' 1,500 '), 1500);
  assert.equal(parseWasteAmount('1.5'), 1.5);
  assert.equal(parseWasteAmount('.25'), 0.25);
  assert.equal(parseWasteAmount('2.'), 2);
  // Stock is kept to 4 decimal places, so that is where an amount lands -- the
  // same rounding the server does, so what is sent is what is recorded.
  assert.equal(parseWasteAmount('1.00005'), 1.0001);
  assert.equal(parseWasteAmount('0.00004'), null);
  assert.equal(parseWasteAmount('0.00005'), 0.0001);
  // Nothing to record.
  for (const t of ['', '   ', '0', '0.0', '-5', 'abc', '1.2.3', '1e3', '+2', '½']) {
    assert.equal(parseWasteAmount(t), null, `"${t}"`);
  }
});

test('an amount reads back the way the rest of the screen writes numbers', () => {
  assert.equal(wasteNumber(1000), '1,000');
  assert.equal(wasteNumber(1.5), '1.5');
  assert.equal(wasteNumber(0.25), '0.25');
});

test('a whole pack soured is one tap, and it adds to what is typed already', () => {
  assert.equal(packButtonLabel(1000, 'ml'), '+ 1 pack (1,000 ml)');
  assert.equal(packButtonLabel(250, 'g'), '+ 1 pack (250 g)');
  // Nothing Clerque knows a pack size for: no button.
  assert.equal(packButtonLabel(null, 'g'), null);
  assert.equal(packButtonLabel(0, 'g'), null);

  assert.equal(addPack('', 1000), '1000');
  assert.equal(addPack('250', 1000), '1250');
  assert.equal(addPack('1,000', 1000), '2000');
  // Whatever was half-typed is not lost to a crash: it counts as nothing.
  assert.equal(addPack('abc', 1000), '1000');
  // Three taps of a 750.5 ml pack, not 2251.4999999.
  assert.equal(addPack(addPack(addPack('', 750.5), 750.5), 750.5), '2251.5');
});

test('the amount says itself in packs once it is more than one', () => {
  assert.equal(inPacks(2000, 'ml', 1000), '2 pk');
  assert.equal(inPacks(1250, 'ml', 1000), '1 pk + 250 ml');
  assert.equal(inPacks(1000, 'ml', 1000), '1 pk');
  // Under one pack, or no pack to count in: nothing to say.
  assert.equal(inPacks(500, 'ml', 1000), null);
  assert.equal(inPacks(500, 'ml', null), null);
  assert.equal(inPacks(500, 'ml', 0), null);
  // 3 × 0.3333 is a whole pack, not two and a rounding crumb.
  assert.equal(inPacks(0.9999, 'kg', 0.3333), '3 pk');
});

test('the four reasons are the ones the server books, in the kitchen\'s words', () => {
  assert.deepEqual(WASTE_REASONS.map((r) => r.code), ['SPOILED', 'EXPIRED', 'DROPPED', 'OTHER']);
  assert.deepEqual(WASTE_REASONS.map((r) => r.label), ['Spoiled', 'Past its date', 'Dropped or spilled', 'Other']);
});

test('Save sends the amount, the reason and the tap key -- and nothing at all until both are there', () => {
  const base = { rawMaterialId: 'milk', amount: '500', reason: 'SPOILED', note: '', key: KEY };
  assert.deepEqual(wasteRequest(base), { rawMaterialId: 'milk', qty: 500, reason: 'SPOILED', key: KEY });
  // A note only when there is one, trimmed.
  assert.deepEqual(wasteRequest({ ...base, note: '  left out overnight  ' }),
    { rawMaterialId: 'milk', qty: 500, reason: 'SPOILED', note: 'left out overnight', key: KEY });
  assert.equal(Object.hasOwn(wasteRequest({ ...base, note: '   ' }), 'note'), false);
  // Half-filled in: the button stays off.
  assert.equal(wasteRequest({ ...base, reason: null }), null);
  assert.equal(wasteRequest({ ...base, amount: '' }), null);
  assert.equal(wasteRequest({ ...base, amount: '0' }), null);
  assert.equal(wasteRequest({ ...base, amount: '-1' }), null);
});

test('the sheet records it through the station route, only on the running day, with no costs', () => {
  assert.match(sheet, /\/kds\/stations\/\$\{stationId\}\/waste/);
  // Only this station's own running sheet offers it; the owner's copy draws the same tables with no buttons.
  assert.match(sheet, /const recordable = !!sheet && sheet\.status === 'LIVE' && !!sheet\.station && sheet\.day === sheet\.today/);
  assert.match(sheet, /onThrowOut=\{recordable \? setThrowOut : undefined\}/);
  assert.match(sheet, /\{onThrowOut && \(/);
  assert.match(sheet, />\s*Thrown out\s*</);
  // A double-tap or a retry takes the milk off once.
  assert.match(sheet, /keepTapKey\(tapFailure\(e\)\.status\)/);
  // The Waste column and the prep levels both move after it is recorded.
  assert.match(sheet, /queryKey: \['station-sheet', stationId\]/);
  assert.match(sheet, /queryKey: \['kds-prep', stationId\]/);
  const code = sheet.replace(/^\s*(\*|\/\/).*$/gm, '');
  assert.equal(/cost|price|₱/i.test(code), false, 'no costs reach a kitchen or bar screen');
});
