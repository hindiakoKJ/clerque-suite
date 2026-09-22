/**
 * Run: cd apps/web && node --test app/procure/cycle-counts/count-row.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countCaption } from './count-row.ts';

test('an open count says when it was started, on the Manila calendar', () => {
  // 17:30 UTC on the 20th is 01:30 on the 21st in Manila.
  assert.equal(countCaption({ status: 'OPEN', createdAt: '2026-09-20T17:30:00.000Z', postedAt: null, notes: null }), 'Started Sep 21, 2026');
});

test('a posted count says when it was posted', () => {
  assert.equal(
    countCaption({ status: 'POSTED', createdAt: '2026-09-20T01:00:00.000Z', postedAt: '2026-09-22T02:00:00.000Z', notes: 'Monthly' }),
    'Posted Sep 22, 2026 · Monthly',
  );
});

test('a count a buy list started names the list, not the raw tag', () => {
  assert.equal(
    countCaption({ status: 'OPEN', createdAt: '2026-09-21T02:00:00.000Z', postedAt: null, notes: '[REQ:REQ-20260921-004] Counted while building the buy list' }),
    'Started Sep 21, 2026 · from buy list REQ-20260921-004',
  );
});

test('a long note is cut short', () => {
  const s = countCaption({ status: 'OPEN', createdAt: '2026-09-21T02:00:00.000Z', postedAt: null, notes: 'x'.repeat(100) });
  assert.ok(s.endsWith('…'));
  assert.ok(s.length < 90);
});

// The screen: reachable on a phone, dated, and a posted count can be opened to read.
test('the Cycle Counts screen fits a phone and lets a posted count be viewed', () => {
  const page = readFileSync(new URL('../../pos/(pos)/warehouse/cycle-counts/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /countCaption\(c\)/);
  assert.match(page, /<section className="rounded-xl border border-border bg-card overflow-x-auto">/);
  assert.match(page, /hidden sm:table-cell/);
  assert.match(page, /c\.status === 'POSTED' &&/);
  assert.match(page, /readOnly=\{!editable\}/);
});

test('Start Cycle Count picks the branch for a one-branch shop and never offers a closed one', () => {
  const page = readFileSync(new URL('../../pos/(pos)/warehouse/cycle-counts/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /activeBranches\(/);
  assert.match(page, /const defaultBranch = user\?\.branchId \|\| \(branches\.length === 1 \? branches\[0\]\.id : ''\);/);
});
