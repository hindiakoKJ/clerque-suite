/**
 * Run: cd apps/web && node --test "app/pos/(pos)/settings/displays/station-choice.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pairedWithoutStation, stationForPairing, stationsForRole } from './station-choice.ts';

const KITCHEN = { id: 'st-kitchen', name: 'Kitchen' };
const HOT = { id: 'st-hot', name: 'Hot Bar' };
const COLD = { id: 'st-cold', name: 'Cold Bar' };

test('the only matching station is picked for staff', () => {
  assert.equal(stationForPairing([KITCHEN], ''), 'st-kitchen');
});

test('with two or more stations, nothing is picked until staff choose', () => {
  assert.equal(stationForPairing([HOT, COLD], ''), null);
  assert.equal(stationForPairing([HOT, COLD], 'st-cold'), 'st-cold');
});

test('a pick that is no longer in the list does not count', () => {
  assert.equal(stationForPairing([HOT, COLD], 'st-gone'), null);
});

test('no station with a screen means no code can be made', () => {
  assert.equal(stationForPairing([], ''), null);
});

test('the kitchen card offers kitchen stations, the bar card offers the bars', () => {
  const screens = [
    { id: 'st-kitchen', name: 'Kitchen', kind: 'KITCHEN' },
    { id: 'st-hot', name: 'Hot Bar', kind: 'HOT_BAR' },
    { id: 'st-cold', name: 'Cold Bar', kind: 'COLD_BAR' },
  ];
  assert.deepEqual(stationsForRole('KDS_KITCHEN', screens).map((s) => s.id), ['st-kitchen']);
  assert.deepEqual(stationsForRole('KDS_BAR', screens).map((s) => s.id), ['st-hot', 'st-cold']);
  assert.deepEqual(stationsForRole('CUSTOMER_DISPLAY', screens), []);
});

test('a station named the shop\'s own way still counts for the kitchen card', () => {
  const screens = [{ id: 'st-1', name: 'Main kitchen line', kind: 'COUNTER' }];
  assert.deepEqual(stationsForRole('KDS_KITCHEN', screens).map((s) => s.id), ['st-1']);
});

test('when nothing fits the card, every station with a screen is offered (never a dead end)', () => {
  const screens = [{ id: 'st-1', name: 'Line 1', kind: 'COUNTER' }];
  assert.deepEqual(stationsForRole('KDS_KITCHEN', screens).map((s) => s.id), ['st-1']);
  assert.deepEqual(stationsForRole('KDS_BAR', screens).map((s) => s.id), ['st-1']);
  // With no screens turned on there is still nothing to offer.
  assert.deepEqual(stationsForRole('KDS_KITCHEN', []), []);
});

test('old kitchen or bar pairings with no station are flagged; customer displays are not', () => {
  assert.equal(pairedWithoutStation({ role: 'KDS_KITCHEN', stationId: null }), true);
  assert.equal(pairedWithoutStation({ role: 'KDS_BAR', stationId: 'st-hot' }), false);
  assert.equal(pairedWithoutStation({ role: 'CUSTOMER_DISPLAY', stationId: null }), false);
});

test('the page never offers "Any matching station" and does not send a code without a station', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /Any matching station/);
  assert.match(page, /stationForPairing\(/);
});
