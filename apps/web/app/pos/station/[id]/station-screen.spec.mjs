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
import { queueProblem, screenLabel, stationTitle, waitLabel } from './station-screen.ts';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('the line under the title names the kind of screen: the Bar is not a "Kitchen display"', () => {
  assert.equal(screenLabel('KITCHEN'), 'Kitchen display');
  assert.equal(screenLabel('BAR'), 'Bar display');
  assert.equal(screenLabel('HOT_BAR'), 'Bar display');
  assert.equal(screenLabel('COLD_BAR'), 'Bar display');
  assert.equal(screenLabel('PASTRY_PASS'), 'Pastry display');
  assert.equal(screenLabel('COUNTER'), 'Counter display');
  // Until the station has loaded, or a kind this screen does not know.
  assert.equal(screenLabel(null), 'Station display');
  assert.equal(screenLabel(undefined), 'Station display');
  assert.equal(screenLabel('SOMETHING_NEW'), 'Station display');
  assert.match(page, /\{screenLabel\(stationKind\)\} · /);
  assert.doesNotMatch(page, /Kitchen Display ·/);
});

test('a wait is read in the biggest unit that fits: a days-old ticket is not "28549m 42s"', () => {
  assert.equal(waitLabel(0), '0s');
  assert.equal(waitLabel(42), '42s');
  assert.equal(waitLabel(60), '1m 0s');
  assert.equal(waitLabel(5 * 60 + 7), '5m 7s');
  assert.equal(waitLabel(59 * 60 + 59), '59m 59s');
  assert.equal(waitLabel(3600), '1h 0m');
  assert.equal(waitLabel(3 * 3600 + 12 * 60 + 30), '3h 12m');
  assert.equal(waitLabel(23 * 3600 + 59 * 60), '23h 59m');
  assert.equal(waitLabel(24 * 3600), '1d');
  assert.equal(waitLabel(27 * 3600 + 5 * 60), '1d 3h');
  // The 20-day-old test ticket the sweep found.
  assert.equal(waitLabel(28549 * 60 + 42), '19d 19h');
  assert.equal(waitLabel(7 * 24 * 3600), '7d');
  // Never a negative or a fraction.
  assert.equal(waitLabel(-5), '0s');
  assert.equal(waitLabel(61.9), '1m 1s');
  assert.match(page, /\{waitLabel\(oldestWait\)\}/);
});

test('the "tap once to let the bell ring" notice never sits in the flow above the tickets', () => {
  /*
    The first touch unlocks the bell and removes the notice. In the flow above
    the tickets, its going shifted every ticket up under the finger between
    pointerdown and pointerup, so the first tap on a ticket bumped nothing.
    Fixed to the screen's edge, and taps pass through it.
  */
  const notice = page.match(/\{chime\.enabled && !chime\.unlocked && \(\s*<div className="([^"]+)"/);
  assert.ok(notice, 'the notice is still drawn while the bell is locked');
  const classes = notice[1].split(/\s+/);
  assert.ok(classes.includes('fixed'), 'fixed to the screen, out of the flow');
  assert.ok(classes.includes('pointer-events-none'), 'taps pass through it');
  assert.ok(!classes.includes('border-b'), 'not the old in-flow strip under the header');
});

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

test('the display picker names each screen the same way: the Bar is not a "Kitchen Display"', () => {
  const picker = readFileSync(new URL('../../select-display/page.tsx', import.meta.url), 'utf8');
  assert.match(picker, /\{screenLabel\(station\.kind\)\}/);
  assert.doesNotMatch(picker, /Kitchen Display —/);
});

test('the bell unlocks on the finger lifting too, as Android Chrome requires, and only once audio runs', () => {
  const hook = readFileSync(new URL('../../../../hooks/pos/useKitchenChime.ts', import.meta.url), 'utf8');
  const events = hook.match(/const EVENTS = \[([^\]]+)\]/);
  assert.ok(events, 'one list of unlock events');
  for (const e of ['pointerup', 'touchend', 'click']) assert.match(events[1], new RegExp(`'${e}'`));
  // A touch-down that could not start audio does not use up the unlock.
  assert.match(hook, /if \(ctx\.state === 'running'\) finish\(\)/);
});
