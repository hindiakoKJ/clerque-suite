/**
 * Run: cd apps/web && node --test "app/pos/(pos)/inventory/reports/report-link.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportView, isDay } from './report-link.ts';

const link = (q) => new URLSearchParams(q);
const bell = link('from=2026-09-16&to=2026-09-16&branchId=branch-b');
const owner = { role: 'BUSINESS_OWNER', branchId: 'main' };   // signup ties the owner to Main

test('the end-of-day bell opens that branch\'s day on the Consumption tab', () => {
  assert.deepEqual(reportView(bell, owner), {
    dates: { from: '2026-09-16', to: '2026-09-16' },
    tab: 'consumption',
    branchId: 'branch-b',
  });
});

test('with no link the page opens as before: its own dates, Stock on Hand, the viewer\'s branch', () => {
  assert.deepEqual(reportView(link(''), owner), { dates: null, tab: 'on-hand', branchId: 'main' });
  assert.deepEqual(reportView(link(''), { role: 'BUSINESS_OWNER', branchId: null }), { dates: null, tab: 'on-hand', branchId: null });
});

test('a manager tied to one branch stays on it, whatever branch the link names', () => {
  const manager = { role: 'BRANCH_MANAGER', branchId: 'branch-a' };
  assert.equal(reportView(bell, manager).branchId, 'branch-a');
  assert.equal(reportView(link('from=2026-09-16&to=2026-09-16&branchId=branch-a'), manager).branchId, 'branch-a');
  // The day still opens: only the branch is held back.
  assert.equal(reportView(bell, manager).tab, 'consumption');
});

test('someone not tied to a branch may open the branch the link names', () => {
  assert.equal(reportView(bell, { role: 'BRANCH_MANAGER', branchId: null }).branchId, 'branch-b');
});

test('dates that are not real YYYY-MM-DD days, or only one of the two, fall back to the default view', () => {
  for (const q of [
    'from=2026-9-16&to=2026-09-16',
    'from=2026-02-30&to=2026-02-30',
    'from=2026-09-16',
    'to=2026-09-16',
    'from=yesterday&to=today',
  ]) {
    const v = reportView(link(q), owner);
    assert.equal(v.dates, null, q);
    assert.equal(v.tab, 'on-hand', q);
  }
  assert.equal(isDay('2028-02-29'), true);
  assert.equal(isDay('2026-02-29'), false);
  assert.equal(isDay(null), false);
});

// The page itself has no renderer here, so its wiring is pinned by what it says.
const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('the page reads the link and sends the branch it decided on', () => {
  assert.match(page, /useSearchParams\(\)/);
  assert.match(page, /reportView\(params, user\)/);
  // The old query sent the viewer's own branch no matter what the link asked for.
  assert.doesNotMatch(page, /branchId:\s*user\?\.branchId/);
  assert.match(page, /queryKey:\s*\['ingredient-report', from, to, branchId\]/);
  assert.match(page, /<Suspense>/);
});

test('the consumption total does not claim to include what went into preps', () => {
  // The API's total leaves into-preps out (the prep holds that value), so the label must not list it.
  assert.doesNotMatch(page, /put into preps, or written off/);
  assert.match(page, /What went into preps is not in this total/);
});
