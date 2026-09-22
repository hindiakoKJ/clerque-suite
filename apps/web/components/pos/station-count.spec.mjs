/**
 * Run: cd apps/web && node --test components/pos/station-count.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * The weekly count on a kitchen or bar screen: full packs plus what is loose,
 * zero as an answer, Save and next, the chips, and a blind form -- the screen
 * never shows what the books say, and a count never moves stock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  amountLabel, cleanName, countWords, firstToCount, isCounted, liveLine, looseLabel, manilaStamp, nextUncounted,
  opensSent, otherChip, packsLabel, parseCountAmount, parsePacks, progressOf, recountState, replaceNote, rowChip, saveBody,
  sendQuestion, sentHeadline, shortDay, splitPacks, stepPacks, totalOf, waitingText, withSavedRow,
} from './station-count.ts';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const panel = read('./StationCountPanel.tsx');
const button = read('./StationCountButton.tsx');
const client = read('../../lib/weekly-count-api.ts');
// Comments may name the forbidden words to say they are never shown; the code may not.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\*|\/\/).*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const row = (over = {}) => ({
  rawMaterialId: 'milk', unit: 'ml', packSize: 1000, counted: null, countedWords: null, recount: false, otherCount: null, ...over,
});

test('what the cook types reads as an amount, and zero is an answer', () => {
  assert.equal(parseCountAmount('0'), 0);
  assert.equal(parseCountAmount('0.0'), 0);
  assert.equal(parseCountAmount(' 1,500 '), 1500);
  assert.equal(parseCountAmount('.25'), 0.25);
  // The count column keeps 3 places, the same rounding the server does.
  assert.equal(parseCountAmount('1.0005'), 1.001);
  assert.equal(parseCountAmount('1000000'), 1_000_000);
  for (const t of ['', '  ', '-1', 'abc', '1.2.3', '1e3', '+2', '1000001']) {
    assert.equal(parseCountAmount(t), null, `"${t}"`);
  }
});

test('full packs are whole, and - never goes below zero', () => {
  assert.equal(parsePacks('3'), 3);
  assert.equal(parsePacks('0'), 0);
  assert.equal(parsePacks('2.5'), null);
  assert.equal(parsePacks(''), null);
  assert.equal(stepPacks('', 1), '1');
  assert.equal(stepPacks('2', 1), '3');
  assert.equal(stepPacks('2', -1), '1');
  assert.equal(stepPacks('0', -1), '0');
  assert.equal(stepPacks('', -1), '0');
  assert.equal(stepPacks('abc', 1), '1');
});

test('packs plus loose make one amount, in the item\'s own unit', () => {
  assert.equal(totalOf({ packs: '2', loose: '100' }, 1000), 2100);
  assert.equal(totalOf({ packs: '2', loose: '' }, 1000), 2000);
  assert.equal(totalOf({ packs: '', loose: '350' }, 1000), 350);
  assert.equal(totalOf({ packs: '0', loose: '' }, 1000), 0);
  // Nothing typed yet, or nonsense in either field: nothing to save.
  assert.equal(totalOf({ packs: '', loose: '' }, 1000), null);
  assert.equal(totalOf({ packs: '1.5', loose: '' }, 1000), null);
  assert.equal(totalOf({ packs: '1', loose: '-2' }, 1000), null);
  // No pack size: the one field.
  assert.equal(totalOf({ packs: '9', loose: '12' }, null), 12);
  assert.equal(totalOf({ packs: '', loose: '0' }, null), 0);
  assert.equal(totalOf({ packs: '', loose: '' }, null), null);
  // Three 0.3333 kg packs, not a rounding crumb.
  assert.equal(totalOf({ packs: '3', loose: '' }, 0.3333), 1);
});

test('a saved amount opens split back into packs and loose', () => {
  assert.deepEqual(splitPacks(2100, 1000), { packs: '2', loose: '100' });
  assert.deepEqual(splitPacks(2000, 1000), { packs: '2', loose: '' });
  assert.deepEqual(splitPacks(350, 1000), { packs: '0', loose: '350' });
  assert.deepEqual(splitPacks(0, 1000), { packs: '0', loose: '' });
  assert.deepEqual(splitPacks(12, null), { packs: '', loose: '12' });
  assert.deepEqual(splitPacks(null, 1000), { packs: '', loose: '' });
  for (const [qty, size] of [[2100, 1000], [0.9, 0.3], [1234.567, 250]]) {
    assert.equal(totalOf(splitPacks(qty, size), size), qty, `${qty} in packs of ${size}`);
  }
});

test('the amount says itself the way the sheet writes it', () => {
  assert.equal(countWords(2100, 'ml', 1000), '2 pk + 100 ml');
  assert.equal(countWords(2000, 'ml', 1000), '2 pk');
  assert.equal(countWords(350, 'g', 1000), '350 g');
  assert.equal(countWords(1500, 'g', null), '1,500 g');
  assert.equal(liveLine(2100, 'ml', 1000), 'That is 2 pk + 100 ml.');
  assert.equal(liveLine(0, 'ml', 1000), 'None left.');
  assert.equal(liveLine(null, 'ml', 1000), null);
  assert.equal(packsLabel(1000, 'ml'), 'Full packs (1,000 ml each)');
  assert.equal(looseLabel('ml'), 'Opened or loose (ml)');
  assert.equal(amountLabel('pc'), 'How much is there? (pc)');
});

test('an item another station counted lately is done, unless the owner asked for it again', () => {
  const other = { station: 'Kitchen', words: '2 pk + 100 ml', at: '2026-09-21T13:12:00.000Z' };
  assert.equal(isCounted(row()), false);
  assert.equal(isCounted(row({ counted: 0 })), true);
  assert.equal(isCounted(row({ otherCount: other })), true);
  assert.equal(isCounted(row({ otherCount: other, recount: true })), false);
  // Right after "Count again", this station's sent figures are not this count's.
  assert.equal(isCounted(row({ counted: 5 }), true), false);
  assert.deepEqual(progressOf([row({ counted: 1 }), row({ rawMaterialId: 'eggs' }), row({ rawMaterialId: 'salt', otherCount: other })]), { counted: 2, total: 3 });
});

test('Save and next goes down to the next item not counted, wraps, and skips the one just saved', () => {
  const rows = [row({ rawMaterialId: 'a', counted: 1 }), row({ rawMaterialId: 'b' }), row({ rawMaterialId: 'c', counted: 2 }), row({ rawMaterialId: 'd' })];
  assert.equal(nextUncounted(rows, 'b'), 'd');
  assert.equal(nextUncounted(rows, 'd'), 'b');
  // The screen has not caught up with the save yet: still not the same item again.
  assert.equal(nextUncounted([row({ rawMaterialId: 'b' })], 'b'), null);
  assert.equal(nextUncounted(rows.map((r) => ({ ...r, counted: 1 })), 'a'), null);
  // Opens on what the owner asked for again, then the first not counted.
  assert.equal(firstToCount([row({ rawMaterialId: 'a' }), row({ rawMaterialId: 'b', recount: true })]), 'b');
  assert.equal(firstToCount(rows), 'b');
  assert.equal(firstToCount([]), null);
});

test('a recount goes from one asked-for item to the next, and only then down the list', () => {
  const rows = [
    row({ rawMaterialId: 'eggs', recount: true }), row({ rawMaterialId: 'milk', recount: true }),
    row({ rawMaterialId: 'oat' }), row({ rawMaterialId: 'salt' }), row({ rawMaterialId: 'sugar', recount: true }),
  ];
  assert.equal(nextUncounted(rows, 'milk'), 'sugar', 'not Oat milk, the next row down');
  assert.equal(nextUncounted(rows, 'sugar'), 'eggs', 'wraps to the asked-for item at the top');
  // None asked for is left: back to the rows not counted.
  assert.equal(nextUncounted([row({ rawMaterialId: 'milk', recount: true }), row({ rawMaterialId: 'oat' })], 'milk'), 'oat');
});

test('Send on a recount asks about what was asked for, not the whole sheet', () => {
  // The running count holds only answers to the recount, and nothing asked for is left: it goes without a question.
  const done = [row({ rawMaterialId: 'milk', counted: 2100 }), row({ rawMaterialId: 'eggs', counted: 12 }), row({ rawMaterialId: 'oat' })];
  assert.deepEqual(recountState(done, ['milk', 'eggs']), { only: true, left: 0 });
  assert.equal(sendQuestion({ counted: 2, total: 25 }, recountState(done, ['milk', 'eggs'])), null);
  // One asked-for item still to count.
  const half = [row({ rawMaterialId: 'milk', counted: 2100 }), row({ rawMaterialId: 'eggs', recount: true }), row({ rawMaterialId: 'oat' })];
  assert.deepEqual(recountState(half, ['milk']), { only: true, left: 1 });
  assert.equal(sendQuestion({ counted: 1, total: 25 }, recountState(half, ['milk'])), '1 item the owner asked for is not counted yet. Send anyway?');
  // Anything else counted too: an ordinary count, asked as one.
  const more = [row({ rawMaterialId: 'milk', counted: 2100 }), row({ rawMaterialId: 'oat', counted: 900 })];
  assert.deepEqual(recountState(more, ['milk']), { only: false, left: 0 });
  assert.equal(sendQuestion({ counted: 2, total: 25 }, recountState(more, ['milk'])), '2 of 25 counted. Send anyway?');
  // Nothing of this count yet ("Count again" after a Send): not a recount.
  assert.equal(recountState(done, ['milk', 'eggs'], true).only, false);
  assert.match(panel, /sendQuestion\(progress, recount\)/);
});

test('each row\'s chip, in the kitchen\'s words', () => {
  assert.deepEqual(rowChip(row()), { text: 'Not counted', tone: 'todo' });
  assert.deepEqual(rowChip(row({ counted: 2100, countedWords: '2 pk + 100 ml' })), { text: '2 pk + 100 ml', tone: 'done' });
  assert.deepEqual(rowChip(row({ counted: 2100 })), { text: '2 pk + 100 ml', tone: 'done' });
  assert.deepEqual(rowChip(row({ recount: true })), { text: 'Count again', tone: 'again' });
  assert.deepEqual(
    rowChip(row({ otherCount: { station: 'Kitchen', words: '2 pk + 100 ml', at: '2026-09-21T13:12:00.000Z' } })),
    { text: 'Kitchen counted: 2 pk + 100 ml (Sep 21)', tone: 'other' },
  );
  assert.equal(otherChip({ station: 'Bar', words: '1 pk', at: null, message: 'Bar counted: 1 pk (Sep 22)' }), 'Bar counted: 1 pk (Sep 22)');
  assert.equal(replaceNote(row({ otherCount: { station: 'Bar', words: '1 pk', at: null } })), 'Bar already counted this. Saving replaces it.');
  assert.equal(replaceNote(row({ counted: 0, countedWords: '0 ml' })), 'Counted 0 ml. Saving again replaces it.');
  assert.equal(replaceNote(row()), null);
});

test('dates and times read on the shop\'s clock', () => {
  // 13:12 UTC is 9:12 PM in Manila.
  assert.equal(manilaStamp('2026-09-21T13:12:00.000Z'), 'Sep 21 9:12 PM');
  assert.equal(shortDay('2026-09-20T17:30:00.000Z'), 'Sep 21');
  assert.equal(manilaStamp(null), '');
  assert.equal(manilaStamp('nonsense'), '');
});

test('banners and Send say plainly what is going on', () => {
  assert.equal(waitingText(0), null);
  assert.equal(waitingText(1), '1 order is still being made. Finish them first, or count only what is on the shelf.');
  assert.equal(waitingText(3), '3 orders are still being made. Finish them first, or count only what is on the shelf.');
  assert.equal(sendQuestion({ counted: 23, total: 25 }), '23 of 25 counted. Send anyway?');
  assert.equal(sendQuestion({ counted: 25, total: 25 }), null);
  assert.equal(sentHeadline('SENT'), 'Sent. Counting again starts a new count.');
  assert.equal(sentHeadline('ALREADY_SENT'), 'Already sent. Counting again starts a new count.');
});

test('the panel opens on what was sent only when nothing new is asked of the station', () => {
  const view = { count: null, sentAt: '2026-09-21T13:12:00.000Z', due: { isDue: false }, recount: null, sections: [{ rows: [{ counted: 1 }] }] };
  assert.equal(opensSent(view), true);
  assert.equal(opensSent({ ...view, count: { countNumber: 'CC-1' } }), false);
  assert.equal(opensSent({ ...view, due: { isDue: true } }), false);
  assert.equal(opensSent({ ...view, recount: { askedFor: ['milk'] } }), false);
  assert.equal(opensSent({ ...view, sentAt: null }), false);
  assert.equal(opensSent({ ...view, sections: [{ rows: [{ counted: null }] }] }), false);
});

test('Save sends the amount and, on a paired tablet, who counted', () => {
  assert.deepEqual(saveBody({ rawMaterialId: 'milk', qty: 0 }), { rawMaterialId: 'milk', qty: 0 });
  assert.deepEqual(saveBody({ rawMaterialId: 'milk', qty: 2100, by: '  Joy  ' }), { rawMaterialId: 'milk', qty: 2100, by: 'Joy' });
  assert.equal(Object.hasOwn(saveBody({ rawMaterialId: 'milk', qty: 1, by: '   ' }), 'by'), false);
  // Brackets are how the server keeps its own tags: a name never carries one.
  assert.equal(cleanName('[DONE:x] Joy'), 'DONE:x Joy');
  assert.equal(cleanName('x'.repeat(60)).length, 40);
});

test('a save shows at once, and a save after Send starts a clean count', () => {
  const saved = { rawMaterialId: 'milk', counted: 2100, countedWords: '2 pk + 100 ml', countedBy: 'Joy', countedAt: '2026-09-21T13:00:00.000Z' };
  const base = (count) => ({
    count,
    sections: [{ rows: [
      { ...row(), countedBy: null, countedAt: null, recount: true },
      { ...row({ rawMaterialId: 'eggs', counted: 12, countedWords: '12 pc' }), countedBy: 'Joy', countedAt: null },
    ] }],
  });
  const running = withSavedRow(base({ countNumber: 'CC-1', startedOn: '2026-09-21' }), saved);
  assert.equal(running.sections[0].rows[0].counted, 2100);
  assert.equal(running.sections[0].rows[0].recount, false);
  assert.deepEqual(running.recounted, ['milk'], 'saving an item asked for again answers the recount');
  assert.equal(running.sections[0].rows[1].counted, 12, 'the running count keeps its other lines');
  const fresh = withSavedRow(base(null), saved);
  assert.ok(fresh.count, 'a count is running now');
  assert.equal(fresh.sections[0].rows[1].counted, null, 'the sent figures belong to the sent record');
  assert.deepEqual(withSavedRow(base({ countNumber: 'CC-1' }), { ...saved, rawMaterialId: 'eggs' }).recounted, []);
});

// ─── The screen ──────────────────────────────────────────────────────────────

test('the count screen never shows what the books say or what anything costs', () => {
  for (const [name, src] of [['StationCountPanel.tsx', panel], ['StationCountButton.tsx', button]]) {
    assert.equal(/\b(book|expected|variance|difference|cost|price)\b|₱/i.test(code(src)), false, name);
  }
  // The station half of the one client file carries no such field either.
  const stationHalf = client.slice(client.indexOf('// ─── Station: GET'), client.indexOf('// ─── Owner: GET'));
  assert.equal(/\b(book|expected|variance|difference|cost|price)\b/i.test(code(stationHalf)), false);
});

test('the panel is the one described: two panes on a tablet, a bottom sheet on a phone', () => {
  assert.match(panel, /md:w-\[55%\]/);
  assert.match(panel, /md:w-\[45%\]/);
  // The two fields side by side from 1024 wide, so Save and next stays above the keyboard.
  assert.match(panel, /lg:grid lg:grid-cols-2/);
  assert.match(panel, /\(min-width: 768px\)/);
  // The ThrowOutDialog shell for the entry on a phone.
  assert.match(panel, /fixed inset-0 z-\[60\] flex items-end justify-center bg-black\/70 p-0 sm:items-center sm:p-4/);
  assert.match(panel, /min-h-14/);
  assert.match(panel, />\s*Save and next\s*</);
  assert.match(panel, />\s*None left\s*</);
  assert.match(panel, /Send to the owner/);
  assert.match(panel, /Keep counting/);
  assert.match(panel, /Count again/);
  assert.match(panel, /Who is counting\?/);
  assert.match(panel, /sentHeadline\(/);
  // Every call goes through the one client file.
  assert.doesNotMatch(panel, /api\.(get|post)\(/);
  assert.match(panel, /from '@\/lib\/weekly-count-api'/);
});

test('the header button: Weekly count, a due dot, a big touch target, and its words from sm like its neighbours', () => {
  assert.match(button, /title="Weekly count"/);
  assert.match(button, /min-h-12/);
  assert.match(button, /<span className="hidden sm:inline">\{due \? 'Count due' : 'Count'\}<\/span>/);
  // A paired tablet asks for a name even with a leftover login: the server goes by the pairing once that login expires.
  assert.match(button, /askName=\{!signedIn \|\| readDeviceToken\(\) != null\}/);
  assert.match(button, /'Count due' : 'Count'/);
  assert.match(button, /5 \* 60_000/);
  const page = read('../../app/pos/station/[id]/page.tsx');
  assert.match(page, /<StationCountButton stationId=\{stationId\} enabled=\{pairState === 'ok'\} \/>/);
});
