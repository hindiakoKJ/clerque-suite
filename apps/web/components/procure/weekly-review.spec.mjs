/**
 * Run: cd apps/web && node --test components/procure/weekly-review.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * The owner's review of a weekly count: a record says it moved nothing, the
 * lines read as sentences, a line counted again later is left alone, and the
 * owner is told what "Adjust the books to match" will do before tapping it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  adjustPlan, adjustedMessage, countedLine, lineTone, linesFor, manilaStamp, reviewStatusLine, stationStrip,
} from './weekly-review.ts';

const review = readFileSync(new URL('./WeeklyCountReview.tsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('./PostCountModal.tsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../lib/weekly-count-api.ts', import.meta.url), 'utf8');

const kitchen = { name: 'Kitchen', sentAt: '2026-09-21T13:12:00.000Z', countedBy: 'Joy', counted: 23, total: 25 };
const line = (over = {}) => ({
  rawMaterialId: 'milk', name: 'Milk', difference: -1.3, inPacks: '2 pk + 100 ml',
  countedBy: 'Kitchen screen (Joy)', countedAt: '2026-09-21T13:05:00.000Z', superseded: null, ...over,
});

test('the status strip says what the count is for the books', () => {
  assert.equal(
    reviewStatusLine({ status: 'RECORDED', stations: [kitchen], postedAt: null, postedBy: null }),
    'Recorded Sep 21 9:12 PM by Joy (Kitchen). Stock and the books have not changed.',
  );
  assert.equal(
    reviewStatusLine({ status: 'POSTED', stations: [kitchen], postedAt: '2026-09-22T02:05:00.000Z', postedBy: 'Anne' }),
    'Books adjusted Sep 22 10:05 AM by Anne. Stock moved by the difference this count found.',
  );
  assert.equal(
    reviewStatusLine({ status: 'OPEN', stations: [{ ...kitchen, sentAt: null }], postedAt: null, postedBy: null }),
    'Kitchen is still counting. Nothing is recorded yet.',
  );
  // A status this screen does not know yet is named, never a crash.
  assert.equal(reviewStatusLine({ status: 'SOMETHING_NEW', stations: [], postedAt: null, postedBy: null }), 'Status: something_new.');
  assert.equal(
    reviewStatusLine({ status: 'RECORDED', stations: [], postedAt: null, postedBy: null }),
    'Recorded. Stock and the books have not changed.',
  );
});

test('the station strip and each line\'s second line', () => {
  assert.equal(stationStrip(kitchen), 'Kitchen: sent by Joy, Sep 21 9:12 PM · 23 of 25');
  assert.equal(stationStrip({ ...kitchen, name: 'Bar', sentAt: null }), 'Bar: not sent yet');
  assert.equal(stationStrip({ ...kitchen, name: 'Bar', sentAt: null }, 'OPEN'), 'Bar: not sent yet');
  // Left open for days and kept as a record: it can no longer be sent.
  assert.equal(stationStrip({ ...kitchen, sentAt: null, counted: 20 }, 'RECORDED'), 'Kitchen: never sent (kept as a record) · 20 of 25');
  assert.equal(stationStrip(kitchen, 'RECORDED'), 'Kitchen: sent by Joy, Sep 21 9:12 PM · 23 of 25');
  assert.match(review, /stationStrip\(s, view\.status\)/);
  assert.equal(countedLine(line()), '2 pk + 100 ml · Kitchen screen (Joy) · Sep 21 9:05 PM');
  assert.equal(countedLine(line({ inPacks: null, countedBy: null })), 'Sep 21 9:05 PM');
  assert.equal(manilaStamp('2026-09-21T13:12:00.000Z'), 'Sep 21 9:12 PM');
});

test('short, over and a match, at the threshold posting uses', () => {
  assert.equal(lineTone(-1.3), 'short');
  assert.equal(lineTone(0.2), 'over');
  assert.equal(lineTone(0.0009), 'match');
  assert.equal(lineTone(-0.0009), 'match');
  assert.equal(lineTone(0.001), 'over');
  const lines = [line(), line({ rawMaterialId: 'eggs', difference: 0 }), line({ rawMaterialId: 'sugar', difference: 200 })];
  assert.deepEqual(linesFor(lines, 'differ').map((l) => l.rawMaterialId), ['milk', 'sugar']);
  assert.equal(linesFor(lines, 'all').length, 3);
  assert.equal(linesFor(lines, 'missing').length, 0);
});

test('Adjust says first what it will change, what it leaves alone, and what waits for a recount', () => {
  const lines = [
    line(),
    line({ rawMaterialId: 'sugar', name: 'Sugar', difference: 200 }),
    line({ rawMaterialId: 'eggs', name: 'Eggs', difference: 0 }),
    line({ rawMaterialId: 'salt', name: 'Salt', difference: -5, superseded: 'Counted again later (Bar, Sep 22). Not adjusted from this record.' }),
  ];
  const plan = adjustPlan(lines, ['sugar']);
  assert.equal(plan.move, 2);
  assert.equal(plan.leftAlone, 1);
  assert.equal(plan.waiting, 1);
  assert.equal(plan.nothing, false);
  // A move by the difference, not a jump to the counted figure: the sales since the count stay.
  assert.deepEqual(plan.notes, [
    '2 items will move by the difference this count found (sales since the count are kept).',
    '1 item was counted again later and is left alone.',
    '1 item is waiting for a recount. Adjusting now uses this count for it.',
  ]);
  // Everything matches or was counted again later: nothing to adjust (the server refuses the same way).
  assert.equal(adjustPlan([lines[2], lines[3]], []).nothing, true);
  assert.equal(adjustedMessage(2, []), 'Books adjusted: 2 items moved by the counted difference.');
  assert.equal(adjustedMessage(1, ['Salt']), 'Books adjusted: 1 item moved by the counted difference. Left alone (counted again later): Salt.');
});

test('Adjust names an item that will move and is also on another open count: posted later, that count would move it again', () => {
  const lines = [
    line({ alsoOpenIn: ['CC-2026-000010'] }),
    line({ rawMaterialId: 'sugar', name: 'Sugar', difference: 200, alsoOpenIn: [] }),
    // A match moves nothing, and a line counted again later is left alone: neither is named.
    line({ rawMaterialId: 'eggs', name: 'Eggs', difference: 0, alsoOpenIn: ['CC-2026-000010'] }),
    line({ rawMaterialId: 'salt', name: 'Salt', difference: -5, superseded: 'Counted again later.', alsoOpenIn: ['CC-2026-000011'] }),
  ];
  assert.equal(
    adjustPlan(lines, []).notes.at(-1),
    'Milk is also on open count CC-2026-000010. Post that count first: posted after this one, it would move it again.',
  );
  const two = adjustPlan([lines[0], line({ rawMaterialId: 'sugar', name: 'Sugar', difference: 200, alsoOpenIn: ['CC-2026-000011'] })], []);
  assert.equal(two.notes.at(-1), 'Milk, Sugar are also on open count CC-2026-000010, CC-2026-000011. Post those counts first: posted after this one, they would move them again.');
  assert.equal(adjustPlan([lines[1]], []).notes.some((n) => n.includes('open count')), false);
});

test('the review offers Adjust and Recount on a recorded count only, never Edit numbers', () => {
  assert.match(review, /const recorded = view\?\.status === 'RECORDED'/);
  assert.match(review, /\{view && recorded && \(/);
  assert.match(review, /Adjust the books to match/);
  assert.match(review, /Ask for a recount \(\{picked\.size\}\)/);
  assert.doesNotMatch(review, /Edit numbers/);
  // Superseded lines can not be picked for a recount and read muted.
  assert.match(review, /const canPick = recorded && !l\.superseded/);
  // Filter chips, differences first.
  assert.match(review, /useState<ReviewFilter>\('differ'\)/);
  assert.match(review, /`Differences \(\$\{differ\}\)`/);
  assert.match(review, /`All counted \(\$\{lines\.length\}\)`/);
  assert.match(review, /`Not counted \(\$\{missing\.length\}\)`/);
  // The existing Post dialog, through the weekly route.
  assert.match(review, /<PostCountModal/);
  assert.match(client, /\/procure\/weekly-counts\/\$\{id\}\/adjust/);
  assert.match(client, /\/procure\/weekly-counts\/\$\{id\}\/recount/);
  assert.doesNotMatch(review, /api\.(get|post)\(/);
  // Cards, not a wide table, so a phone never scrolls sideways.
  assert.doesNotMatch(review, /<table/);
  assert.match(review, /max-w-3xl/);
});

test('the Post dialog is the same one Cycle Counts used, with a title and notes for the weekly count', () => {
  assert.match(modal, /export function PostCountModal/);
  assert.match(modal, /title \?\? `Post \$\{count\.countNumber\}`/);
  assert.match(modal, /Routine count/);
  assert.match(modal, /Opening stock — this shop&apos;s first count/);
  assert.match(modal, /This cannot be undone\./);
});
