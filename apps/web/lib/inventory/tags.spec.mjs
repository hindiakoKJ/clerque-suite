/**
 * Run: cd apps/web && node --test lib/inventory/tags.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isTagCode, cleanCode, numberFieldFor, needsNamedBuyer, tagLineNote, statusWords, photoApiPath, apiErrorText, PAID_FROM,
} from './tags.ts';

test('only a 6-digit code is a tag: retail barcodes (8, 12, 13, 14) never are', () => {
  assert.equal(isTagCode('000457'), true);
  assert.equal(isTagCode(' 000457 '), true);
  for (const c of ['00457', '0004570', '12345678', '480000000001', '4800000000012', 'ABC123', '', null, undefined]) {
    assert.equal(isTagCode(c), false, String(c));
  }
  assert.equal(cleanCode('Tag 000457\n'), '000457');
});

test('the SKU prefix says which number a part needs (the API rule)', () => {
  assert.equal(numberFieldFor('ENG-2NZ'), 'ENGINE');
  assert.equal(numberFieldFor('eng-2nz'), 'ENGINE');
  assert.equal(numberFieldFor('HC-VIOS'), 'CHASSIS');
  assert.equal(numberFieldFor('FRM-NZE141'), 'CHASSIS');
  assert.equal(numberFieldFor('HL-VIOS-A'), null);
  assert.equal(numberFieldFor(null), null);
  assert.equal(needsNamedBuyer('FRM-1'), true);
  assert.equal(needsNamedBuyer('HL-VIOS-A'), false);
});

test('the receipt line says Tag 000457, with the engine or chassis number', () => {
  assert.equal(tagLineNote({ number: '000457', engineNumber: null, chassisNumber: null }), 'Tag 000457');
  assert.equal(tagLineNote({ number: '000457', engineNumber: '2NZ-1234567', chassisNumber: null }), 'Tag 000457 · Engine No. 2NZ-1234567');
  assert.equal(tagLineNote({ number: '000510', engineNumber: null, chassisNumber: 'NZE141-6048723' }), 'Tag 000510 · Chassis No. NZE141-6048723');
});

test('statuses and money sources are in plain words', () => {
  assert.match(statusWords('WAITING_FOR_COST'), /cost/);
  assert.equal(statusWords('RETIRED'), 'Written off');
  assert.deepEqual(PAID_FROM.map((p) => p.value), ['OWNER_FUNDED', 'BANK', 'CASH']);
  assert.deepEqual(PAID_FROM.map((p) => p.label), ['Owner\'s money', 'Bank / GCash', 'Cash drawer']);
});

test('a photo URL becomes a path for the api client (its base already ends in /api/v1)', () => {
  assert.equal(photoApiPath('/tags/photos/abc'), '/tags/photos/abc');
  assert.equal(photoApiPath('/api/v1/tags/photos/abc'), '/tags/photos/abc');
  assert.equal(photoApiPath('https://api.clerque.cc/api/v1/tags/photos/abc'), '/tags/photos/abc');
  assert.equal(photoApiPath('tags/photos/abc'), '/tags/photos/abc');
});

test('a refusal shows the server\'s own words; no answer at all says so', () => {
  assert.equal(apiErrorText({ response: { data: { message: 'Tag 000457 was already sold' } } }, 'x'), 'Tag 000457 was already sold');
  assert.equal(apiErrorText({ response: { data: { message: ['a', 'b'] } } }, 'x'), 'a b');
  assert.equal(apiErrorText({ response: { data: {} } }, 'fallback'), 'fallback');
  assert.match(apiErrorText(new Error('Network Error'), 'x'), /Could not reach Clerque/);
});

// The till: the tag travels to the server on its line, and a tag line is one piece.
test('the order payload sends serializedUnitId, and the cart keys a tag line by its tag', () => {
  const page = readFileSync(new URL('../../app/pos/(pos)/terminal/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /serializedUnitId: l\.serializedUnitId/);
  const cart = readFileSync(new URL('../../store/pos/cart.ts', import.meta.url), 'utf8');
  assert.match(cart, /`tag:\$\{tag\.id\}`/);
  assert.match(cart, /line\.serializedUnitId && qty > 1/);
});
