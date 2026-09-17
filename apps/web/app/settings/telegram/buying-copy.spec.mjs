/**
 * Run: cd apps/web && node --test app/settings/telegram/buying-copy.spec.mjs
 *
 * The end-of-day ingredients sheet goes out under the Buying topic, so turning
 * Buying off also stops it on Telegram. The switch has to say so.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('the Buying switch mentions the daily ingredients sheet', () => {
  const buying = page.slice(page.indexOf('>Buying</span>'));
  assert.ok(buying.length < page.length, 'Buying switch not found');
  const description = buying.slice(0, buying.indexOf('</label>'));
  assert.match(description, /ingredients used for the day, sent when the day is closed/);
});
