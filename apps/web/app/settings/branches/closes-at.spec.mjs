/**
 * Run: cd apps/web && node --test app/settings/branches/closes-at.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closesAtToSave } from './closes-at.ts';

const box = (badInput) => ({ validity: { badInput } });

test('a half-typed time box is refused, not saved as "no closing time"', () => {
  // e.g. 9 and 00 typed, AM/PM left as "--": the browser's value is "" but badInput is set.
  assert.deepEqual(closesAtToSave(box(true), ''), { ok: false, message: 'Finish the closing time or clear it' });
});

test('a box left blank, or emptied with Clear, saves as not set', () => {
  assert.deepEqual(closesAtToSave(box(false), ''), { ok: true, closesAt: null });
});

test('a finished time saves as HH:mm, seconds dropped', () => {
  assert.deepEqual(closesAtToSave(box(false), '21:00'), { ok: true, closesAt: '21:00' });
  assert.deepEqual(closesAtToSave(box(false), '21:00:00'), { ok: true, closesAt: '21:00' });
});

test('with no box to ask (not mounted), the value is used as it is', () => {
  assert.deepEqual(closesAtToSave(null, '07:30'), { ok: true, closesAt: '07:30' });
});

// The page itself has no renderer here, so its wiring is pinned by what it says.
const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('the page checks the box on save and Clear empties the box itself', () => {
  assert.match(page, /closesAtToSave\(closesAtRef\.current, form\.closesAt\)/);
  assert.match(page, /ref=\{closesAtRef\}/);
  assert.match(page, /closesAtRef\.current\.value = ''/);
  // Clear used to vanish once React saw "", which is exactly when a half-typed box needs it.
  assert.doesNotMatch(page, /\{form\.closesAt && \(/);
});

test('the hint says the day closes with the last shift, or 2 hours after closing', () => {
  assert.match(page, /Clerque closes the day when the last shift is closed\.\s+If nobody closes it, Clerque does it 2 hours after this time\./);
  // The old promise of a report half an hour after closing is gone.
  assert.doesNotMatch(page, /30 minutes after this time/);
});
