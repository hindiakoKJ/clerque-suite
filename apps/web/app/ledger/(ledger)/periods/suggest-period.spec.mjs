/**
 * Run: cd apps/web && node --test "app/ledger/(ledger)/periods/suggest-period.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

process.env.TZ = 'Asia/Manila';

// suggest-period.ts imports '@/lib/today' (Next resolves the alias); teach Node the same.
const webRoot = path.resolve(import.meta.dirname, '../../../..');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
      return next(pathToFileURL(path.join(webRoot, `${specifier.slice(2)}.ts`)).href, context);
    }
    return next(specifier, context);
  },
});

const { suggestNextPeriod, daysLeftText } = await import('./suggest-period.ts');

test('no period yet: September 2026 is Sep 1 to Sep 30 (it used to be Aug 31 to Sep 29)', () => {
  assert.deepEqual(suggestNextPeriod(null, '2026-09-22'), {
    name: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30',
  });
});

test('after a period: the next one starts the day after and runs to the end of that month', () => {
  // The API sends the typed day at UTC midnight.
  assert.deepEqual(suggestNextPeriod('2026-09-30T00:00:00.000Z', '2026-09-22'), {
    name: 'October 2026', startDate: '2026-10-01', endDate: '2026-10-31',
  });
  assert.deepEqual(suggestNextPeriod('2026-12-31T00:00:00.000Z', '2027-01-02'), {
    name: 'January 2027', startDate: '2027-01-01', endDate: '2027-01-31',
  });
  assert.deepEqual(suggestNextPeriod('2028-01-31T00:00:00.000Z', '2028-02-01'), {
    name: 'February 2028', startDate: '2028-02-01', endDate: '2028-02-29',
  });
});

test('a period that ended mid-month is followed by the rest of that month, no gap and no overlap', () => {
  assert.deepEqual(suggestNextPeriod('2026-09-15T00:00:00.000Z', '2026-09-22'), {
    name: 'September 2026', startDate: '2026-09-16', endDate: '2026-09-30',
  });
});

test('the badge never says "-51d left"', () => {
  assert.equal(daysLeftText(5), '5d left');
  assert.equal(daysLeftText(1), '1d left');
  assert.equal(daysLeftText(0), 'ended 1 day ago');
  assert.equal(daysLeftText(-0), 'ended 1 day ago');
  assert.equal(daysLeftText(-51), 'ended 52 days ago');
});
