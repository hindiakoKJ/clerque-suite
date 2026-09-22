/**
 * Run: cd apps/web && node --test components/pos/station-taps.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * The rules every recording tap on a kitchen or bar screen shares: "Made" on a
 * prep card or tile, and "Thrown out" on Today's inventory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARM_MS, armedLabel, keepTapKey, newTapKey, tapFailure, tapFailureText, tileMadeLabel } from './station-taps.ts';

const card = readFileSync(new URL('./PrepChainCard.tsx', import.meta.url), 'utf8');
const levels = readFileSync(new URL('./StationPrepLevels.tsx', import.meta.url), 'utf8');

test('Made takes two taps: the first arms the button and says what the second records', () => {
  assert.equal(armedLabel('2,000 g'), 'Tap again to record 1 batch (2,000 g)');
  assert.equal(armedLabel('1.4 L'), 'Tap again to record 1 batch (1.4 L)');
  // No yield on the recipe: still two taps, just no amount to promise.
  assert.equal(armedLabel(null), 'Tap again to record 1 batch');
  assert.equal(armedLabel(undefined), 'Tap again to record 1 batch');
  assert.equal(armedLabel(''), 'Tap again to record 1 batch');
  // Long enough to look down and tap again, short enough that a forgotten first tap does not wait for a stray second one.
  assert.ok(ARM_MS >= 4000 && ARM_MS <= 6000, `${ARM_MS}`);

  // The button itself: the first tap arms, the second records, and the POST is never on the first.
  assert.match(card, /onClick=\{tap\}/);
  assert.doesNotMatch(card, /onClick=\{record\}/);
  assert.match(card, /if \(!armed\) \{\s*setArmed\(true\);\s*armTimer\.current = setTimeout\([\s\S]*?, ARM_MS\);\s*return;\s*\}/);
  assert.match(card, /armed \? armedLabel\(makes\) : label/);
  // What the batch makes reaches every Made button: the chain's big one, a stage's small one, and a free tile's.
  assert.match(card, /makes=\{action\.makes \?\? null\}/);
  assert.match(card, /makes=\{s\.made\.makes \?\? null\}/);
  assert.match(levels, /makes=\{r\.batchYield != null && r\.batchYield > 0 \? amount\(r\.batchYield, r\.unit\) : null\}/);
});

test('an item with no station is marked in plain words, never "routed"', () => {
  assert.match(card, /export const NO_STATION_YET = 'No station set yet'/);
  assert.match(card, /Settings > Floor Layout/);
  // Block comments first, then line comments: what is left is code and the words on screen.
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const source of [card, levels]) {
    assert.equal(/routed/i.test(code(source)), false, 'no "routed" on a kitchen or bar screen');
  }
  // The full view has room for the one line that tells the owner what to do; the column only carries the mark.
  assert.match(levels, /\{NO_STATION_YET_HELP\}/);
});

/** What the server accepts as a tap key (station-waste.controller.ts, the Made route). */
const SERVER_KEY = /^[A-Za-z0-9-]{8,64}$/;

test('every tap gets its own key, in the shape the server accepts', () => {
  const keys = new Set(Array.from({ length: 200 }, () => newTapKey()));
  assert.equal(keys.size, 200);
  for (const k of keys) assert.match(k, SERVER_KEY);
});

test('a tablet on plain http has no crypto.randomUUID, and still gets a key the server takes', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    // http on the shop's own network: randomUUID is not there.
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    const keys = new Set(Array.from({ length: 200 }, () => newTapKey()));
    assert.ok(keys.size > 190, 'time plus randomness should almost never collide');
    for (const k of keys) assert.match(k, SERVER_KEY);
  } finally {
    if (real) Object.defineProperty(globalThis, 'crypto', real);
  }
});

test('a refusal recorded nothing, so the next tap is a new try', () => {
  for (const status of [400, 403, 404, 409, 422, 499]) assert.equal(keepTapKey(status), false, `${status}`);
});

test('no answer, or the server broke: the key is KEPT, so tapping again cannot record it twice', () => {
  // The signal dropped mid-request -- it may or may not have gone through.
  assert.equal(keepTapKey(undefined), true);
  for (const status of [500, 502, 503, 504]) assert.equal(keepTapKey(status), true, `${status}`);
});

test('a failed tap says the server\'s own words when it sent any', () => {
  assert.deepEqual(
    tapFailure({ response: { status: 403, data: { message: 'That item is not on the Kitchen sheet.' } } }),
    { status: 403, message: 'That item is not on the Kitchen sheet.' },
  );
  // Nest sends a list when several rules failed at once.
  assert.equal(tapFailure({ response: { status: 400, data: { message: ['a', 'b'] } } }).message, 'a b');
  assert.deepEqual(tapFailure(null), { status: undefined, message: undefined });

  assert.equal(tapFailureText({ response: { status: 400, data: { message: 'The books show no Fresh Milk here.' } } }),
    'The books show no Fresh Milk here.');
  // Both fallbacks promise the same thing: tap again, it will not be counted twice.
  assert.equal(tapFailureText({ response: { status: 500 } }), 'Could not record it. Tap again: it will not be counted twice.');
  assert.equal(tapFailureText(new Error('Network Error')), 'No connection. Tap again when it is back: it will not be counted twice.');
});

test('a prep tile offers Made only when there is enough on hand for one batch', () => {
  assert.equal(tileMadeLabel({ kind: 'MAKE', batches: 1 }), 'Made a batch');
  assert.equal(tileMadeLabel({ kind: 'MAKE', batches: 12 }), 'Made a batch');
  // Level 2 into Level 1 is moved, not made.
  assert.equal(tileMadeLabel({ kind: 'MOVE', batches: 3 }), 'Moved a batch');
  // The server would refuse the batch, so no button is drawn.
  assert.equal(tileMadeLabel({ kind: 'MAKE', batches: 0 }), null);
  assert.equal(tileMadeLabel({ kind: 'MOVE', batches: 0 }), null);
});

test('the chain card and the prep tiles record through these rules, and send no costs', () => {
  // One button component for the big action and the small made-ahead one.
  assert.match(card, /export function MadeButton\(/);
  assert.match(card, /keepTapKey, newTapKey, tapFailure, tapFailureText/);
  assert.match(card, /\/kds\/stations\/\$\{stationId\}\/prep\/\$\{rawMaterialId\}\/made/);
  // A stage that can be made gets its own small button, even with nothing to do.
  assert.match(card, /\{s\.made && \(/);
  assert.match(card, /tone="secondary"/);
  assert.match(card, /tone="primary"/);
  // A free-standing prep tile gets one too.
  assert.match(levels, /import \{ tileMadeLabel \} from '\.\/station-taps'/);
  assert.match(levels, /const madeButton = \(r: PrepRow, stationId: string/);
  for (const source of [card, levels]) {
    assert.equal(/cost|price|₱/i.test(source.replace(/^\s*(\*|\/\/).*$/gm, '')), false, 'no costs on a kitchen or bar screen');
  }
});
