/**
 * Run: cd apps/web && node "app/pos/(pos)/manila-dates.spec.mjs"
 *
 * The POS report and stock pages open on the shop's date, never the UTC one.
 * `new Date().toISOString().slice(0, 10)` is the UTC date: before 8 AM in
 * Manila it is still yesterday, so a page opened at 7 AM showed yesterday's
 * figures and "today" left out the morning's deliveries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const here = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const PAGES = [
  './dashboard/page.tsx',
  './reports/sales/page.tsx',
  './reports/unified/page.tsx',
  './products/page.tsx',
  './inventory/page.tsx',
  './inventory/[id]/page.tsx',
  './inventory/movements/page.tsx',
  './inventory/recipe-catchup/page.tsx',
  './inventory/reports/page.tsx',
];

// "Today" or "N days ago" taken straight from the UTC clock.
const UTC_DAY = [
  /new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\(['"]T['"]\)\[0\])/,
  /new Date\(Date\.now\(\)[^)]*\)\.toISOString\(\)\.slice\(0, ?10\)/,
];

test('no POS report or stock page takes its default date from the UTC clock', () => {
  for (const page of PAGES) {
    const src = here(page);
    for (const re of UTC_DAY) assert.doesNotMatch(src, re, page);
  }
});

test('the recipe catch-up opens on the shop\'s today', () => {
  const src = here('./inventory/recipe-catchup/page.tsx');
  assert.match(src, /import \{ todayIso \} from '@\/lib\/today'/);
  assert.match(src, /const today = todayIso\(\);/);
});
