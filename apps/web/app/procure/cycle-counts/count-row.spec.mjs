/**
 * Run: cd apps/web && node --test app/procure/cycle-counts/count-row.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countBadge, countCaption, isWeeklyCount, leftAloneText, postedTitle } from './count-row.ts';

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

test('a posted count shows its words, never a tag the server keeps in front of them', () => {
  assert.equal(
    countCaption({ status: 'POSTED', createdAt: '2026-09-20T01:00:00.000Z', postedAt: '2026-09-22T02:00:00.000Z', notes: '[NOTE:salt,sugar] Monthly' }),
    'Posted Sep 22, 2026 · Monthly',
  );
  assert.equal(
    countCaption({ status: 'POSTED', createdAt: '2026-09-20T01:00:00.000Z', postedAt: '2026-09-22T02:00:00.000Z', notes: '[NOTE:salt]' }),
    'Posted Sep 22, 2026',
  );
  assert.equal(
    countCaption({ status: 'POSTED', createdAt: '2026-09-21T02:00:00.000Z', postedAt: '2026-09-22T02:00:00.000Z', notes: '[REQ:REQ-20260921-004] [NOTE:salt] Counted while building the buy list' }),
    'Posted Sep 22, 2026 · from buy list REQ-20260921-004',
  );
});

test('after Post: what moved, and which items another count had already adjusted, in plain words', () => {
  const salt = { name: 'Salt', message: 'Left alone: Salt was already adjusted by count CC-2026-000009 (posted Sep 22).' };
  assert.equal(postedTitle({ warnings: [], leftAlone: [] }, false), 'Posted — variances applied.');
  assert.equal(postedTitle({ warnings: ['x'] }, false), 'Posted — the counts are saved.');
  assert.equal(postedTitle({}, true), 'Posted as opening stock — booked to Owner’s Capital.');
  assert.equal(postedTitle(undefined, false), 'Posted — variances applied.');
  // Some left alone: the rest posted as usual, and the toast after it says which and why.
  assert.equal(postedTitle({ leftAlone: [salt], message: null }, false), 'Posted — variances applied.');
  assert.equal(leftAloneText({ leftAlone: [salt] }), 'Left alone: Salt was already adjusted by count CC-2026-000009 (posted Sep 22).');
  // Every item left alone: the server says so.
  assert.equal(
    postedTitle({ leftAlone: [salt], message: 'Nothing moved: every item on this count was already adjusted or counted again by another count.' }, false),
    'Posted. Nothing moved: every item on this count was already adjusted or counted again by another count.',
  );
  assert.equal(leftAloneText({ leftAlone: [] }), null);
  assert.equal(leftAloneText(undefined), null);
  const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => ({ name: n, message: `Left alone: ${n} was already adjusted by count CC-2026-000009 (posted Sep 22).` }));
  const said = leftAloneText({ leftAlone: many });
  assert.match(said, /^Left alone: A .* Left alone: D was already adjusted by count CC-2026-000009 \(posted Sep 22\)\. And 2 more items left alone the same way\.$/);
  assert.doesNotMatch(said, /Left alone: E/);
});

test('a bell tapped while the Counts screen is open opens that review: ?review= is followed as the address changes', () => {
  const page = readFileSync(new URL('../../pos/(pos)/warehouse/cycle-counts/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /import \{ useSearchParams \} from 'next\/navigation';/);
  assert.match(page, /const wanted = useSearchParams\(\)\.get\('review'\);/);
  assert.match(page, /if \(wanted\) setReviewId\(wanted\);\s*\}, \[wanted\]\);/);
  // Read once on load, it missed every bell tapped after.
  assert.doesNotMatch(page, /new URLSearchParams\(window\.location\.search\)\.get\('review'\)/);
  // useSearchParams inside a Suspense boundary, the way the other pages do it.
  assert.match(page, /<Suspense>\s*<CycleCounts \/>\s*<\/Suspense>/);
  // A different count's review starts fresh.
  assert.match(page, /<WeeklyCountReview key=\{reviewId\}/);
  // Post says which items it left alone.
  assert.match(page, /toast\.success\(postedTitle\(d, v\.isOpeningBalance\)\)/);
  assert.match(page, /const left = leftAloneText\(d\);/);
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

// ─── Weekly counts from the kitchen and bar screens ─────────────────────────

// The notes as the server writes them (weekly-count.ts weeklyCountNotes, then Send's DONE tag and line).
const TAGS = '[WEEKLY:2026-09-21] [ST:st-kitchen] [DONE:st-kitchen=2026-09-21T13:12:00.000Z=Joy]';
const WEEKLY = `${TAGS} Weekly count, Kitchen · Kitchen sent by Joy, Sep 21 9:12 PM`;

test('a weekly count is told apart by its tag, and shows the words, not the tags', () => {
  assert.equal(isWeeklyCount(WEEKLY), true);
  assert.equal(isWeeklyCount('[WEEKLY:2026-09-21][ST:x]'), true);
  assert.equal(isWeeklyCount('[REQ:REQ-1] Counted while building the buy list'), false);
  assert.equal(isWeeklyCount('Monthly [WEEKLY:2026-09-21]'), false);
  assert.equal(isWeeklyCount(null), false);
  assert.equal(
    countCaption({ status: 'RECORDED', createdAt: '2026-09-21T02:00:00.000Z', postedAt: null, notes: WEEKLY }),
    'Started Sep 21, 2026 · weekly count, Kitchen · sent by Joy, Sep 21 9:12 PM',
  );
  assert.equal(
    countCaption({ status: 'OPEN', createdAt: '2026-09-21T02:00:00.000Z', postedAt: null, notes: '[WEEKLY:2026-09-21][ST:x]' }),
    'Started Sep 21, 2026 · weekly count',
  );
});

test('a weekly count\'s row keeps the station and who sent it when, whatever was said after', () => {
  const caption = (notes, status = 'RECORDED') => countCaption({ status, createdAt: '2026-09-21T02:00:00.000Z', postedAt: null, notes });
  // Just started: the station.
  assert.equal(caption('[WEEKLY:2026-09-21] [ST:st-kitchen] Weekly count, Kitchen', 'OPEN'), 'Started Sep 21, 2026 · weekly count, Kitchen');
  // A recount asked after the Send does not push the sender off the row.
  assert.equal(
    caption(`${WEEKLY} · Recount asked by Anne, Sep 22: Fresh Milk, Eggs`),
    'Started Sep 21, 2026 · weekly count, Kitchen · sent by Joy, Sep 21 9:12 PM',
  );
  // Left open for days and kept as a record.
  assert.equal(
    caption('[WEEKLY:2026-09-17] [ST:st-bar] Weekly count, Bar · Never sent; kept as a record.'),
    'Started Sep 21, 2026 · weekly count, Bar · Never sent; kept as a record.',
  );
  // Never "weekly count · Weekly count, …".
  assert.doesNotMatch(caption(WEEKLY), /weekly count · Weekly count/i);
  // A longer name keeps the whole time it was sent (cut at 60, it read "Sep 22 6:3…").
  assert.equal(
    caption('[WEEKLY:2026-09-22] [ST:st-kitchen] [DONE:st-kitchen=2026-09-22T10:33:38.216Z=Carolina Cook] Weekly count, Kitchen · Kitchen sent by Carolina Cook, Sep 22 6:33 PM'),
    'Started Sep 21, 2026 · weekly count, Kitchen · sent by Carolina Cook, Sep 22 6:33 PM',
  );
});

test('the badge says what a count means for the books, and a new status never breaks a row', () => {
  assert.deepEqual(countBadge({ status: 'RECORDED', notes: WEEKLY }), { label: 'Recorded - books not changed', tone: 'recorded' });
  assert.deepEqual(countBadge({ status: 'POSTED', notes: WEEKLY }), { label: 'Books adjusted', tone: 'posted' });
  assert.deepEqual(countBadge({ status: 'OPEN', notes: WEEKLY }), { label: 'Counting now', tone: 'open' });
  // Counts started here read as they always did.
  assert.deepEqual(countBadge({ status: 'OPEN', notes: null }), { label: 'open', tone: 'open' });
  assert.deepEqual(countBadge({ status: 'POSTED', notes: 'Monthly' }), { label: 'posted', tone: 'posted' });
  assert.deepEqual(countBadge({ status: 'CANCELLED', notes: null }), { label: 'cancelled', tone: 'cancelled' });
  assert.deepEqual(countBadge({ status: 'SOMETHING_NEW', notes: null }), { label: 'something_new', tone: 'other' });
});

test('the Counts screen: weekly rows open Review (from ?review= too), a recorded one never offers Count or Post', () => {
  const page = readFileSync(new URL('../../pos/(pos)/warehouse/cycle-counts/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /countBadge\(c\)/);
  assert.match(page, /isWeeklyCount\(c\.notes\)/);
  assert.match(page, /\{!weekly && c\.status === 'OPEN' && \(/);
  assert.match(page, /\{!weekly && c\.status === 'POSTED' && \(/);
  assert.match(page, /\{weekly && canReview && \(/);
  // Review is offered to the people the review routes let in; warehouse staff see the badge alone.
  assert.match(page, /const WEEKLY_REVIEW_ROLES: string\[\] = \['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SUPER_ADMIN'\];/);
  assert.match(page, /\{reviewId && canReview && <WeeklyCountReview/);
  assert.match(page, />\s*Review\s*</);
  assert.match(page, /get\('review'\)/);
  assert.match(page, /<WeeklyCountReview/);
  // Every tint the badge can ask for exists, so no row renders an undefined class.
  for (const tone of ['open', 'recorded', 'posted', 'cancelled', 'other']) assert.match(page, new RegExp(`[ {]${tone}:[ ]+'`), tone);
});
