/**
 * Run (the folder's brackets are a glob, so start inside it):
 *   cd "apps/web/app/pos/station/[id]" && node --test station-screen.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * What the kitchen or bar screen says about itself. Both of these were wrong on
 * a paired tablet: it was titled "Station", and when its orders failed to load
 * it said "All caught up" -- finished-looking, while tickets waited.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { queueProblem, stationTitle } from './station-screen.ts';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('a paired tablet is titled Kitchen or Bar, from whichever answer arrived', () => {
  // Logged in: the floor layout knows it.
  assert.equal(stationTitle({ name: 'Kitchen' }, undefined), 'Kitchen');
  // Paired: no layout (it needs a login), so the prep levels' own station.
  assert.equal(stationTitle(null, { name: 'Bar' }), 'Bar');
  assert.equal(stationTitle(undefined, { name: 'Hot Bar' }), 'Hot Bar');
  // The layout wins when both are there, and an empty name is not a name.
  assert.equal(stationTitle({ name: 'Kitchen' }, { name: 'Bar' }), 'Kitchen');
  assert.equal(stationTitle({ name: '' }, { name: 'Bar' }), 'Bar');
  // Only until one of them loads.
  assert.equal(stationTitle(null, null), 'Station');
});

test('signed out, unpaired or paired to a station that is gone: only pairing again fixes it', () => {
  for (const status of [401, 403, 404]) {
    assert.deepEqual(queueProblem({ isAxiosError: true, response: { status } }), { kind: 'unpaired', detail: null });
  }
  // The server's own words are kept, however Nest sent them.
  assert.deepEqual(
    queueProblem({ isAxiosError: true, response: { status: 403, data: { message: 'This screen is paired to another station.' } } }),
    { kind: 'unpaired', detail: 'This screen is paired to another station.' },
  );
  assert.equal(queueProblem({ response: { status: 400, data: { message: ['a', 'b'] } } }).detail, 'a b');
});

test('a paired tablet with no login to refresh comes back as a plain Error, and that is signed out too', () => {
  // lib/api.ts throws new Error('No refresh token') when a 401 cannot be refreshed.
  assert.deepEqual(queueProblem(new Error('No refresh token')), { kind: 'unpaired', detail: null });
});

test('the Wi-Fi or the server is a different sentence: nothing to pair again', () => {
  assert.deepEqual(queueProblem({ isAxiosError: true, code: 'ERR_NETWORK' }), { kind: 'failed', detail: null });
  assert.equal(queueProblem({ isAxiosError: true, response: { status: 500 } }).kind, 'failed');
  assert.equal(queueProblem({ isAxiosError: true, response: { status: 502 } }).kind, 'failed');
  assert.equal(queueProblem({ response: { status: 400 } }).kind, 'failed');
});

test('orders that loaded have no problem', () => {
  assert.equal(queueProblem(null), null);
  assert.equal(queueProblem(undefined), null);
});

test('the station page uses both, and never shows "All caught up" to a signed-out screen', () => {
  assert.match(page, /stationTitle\(station, prepInfo\?\.station\)/);
  assert.match(page, /const signedOut = problem\?\.kind === 'unpaired'/);
  // The empty list it falls back to is not the one "All caught up" is drawn from.
  assert.match(page, /const items = signedOut \? NO_ITEMS : \(queued \?\? NO_ITEMS\)/);
  assert.match(page, /This screen is signed out or unpaired/);
  assert.match(page, /Pair it again from Settings &gt; Displays/);
});
