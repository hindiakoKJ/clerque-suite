/**
 * Run: cd apps/web && node --test "app/ledger/(ledger)/simple-entries/entry-payload.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntryPayload, entryProblem, paidFromOptions, paidFromFor, pocketLabel, isTransfer, reverseQuestion,
} from './entry-payload.ts';

const form = (over = {}) => ({
  type: 'EXPENSE', amount: '1500', date: '2026-09-22', paidFrom: 'CASH',
  category: 'RENT', note: '', assetName: '', ...over,
});

// ── the two new kinds ────────────────────────────────────────────────────────

test('Bought equipment: amount, date, paid from, what was bought, note', () => {
  assert.deepEqual(
    buildEntryPayload(form({
      type: 'EQUIPMENT_PURCHASE', amount: '85000', paidFrom: 'OWNER',
      assetName: '  Espresso machine ', note: ' La Marzocco, 2 group ',
    })),
    {
      type: 'EQUIPMENT_PURCHASE', amount: 85000, date: '2026-09-22',
      paidFrom: 'OWNER', assetName: 'Espresso machine', note: 'La Marzocco, 2 group',
    },
  );
});

test('Paid wages: paid from cash, bank or the owner; no category, no equipment name', () => {
  for (const paidFrom of ['CASH', 'BANK', 'OWNER']) {
    assert.deepEqual(
      buildEntryPayload(form({ type: 'WAGES_PAID', amount: '3500.50', paidFrom, assetName: 'left over from another kind' })),
      { type: 'WAGES_PAID', amount: 3500.5, date: '2026-09-22', paidFrom },
    );
  }
});

test('equipment needs a name; wages do not', () => {
  assert.match(entryProblem(form({ type: 'EQUIPMENT_PURCHASE', assetName: '   ' })), /what was bought/);
  assert.equal(entryProblem(form({ type: 'EQUIPMENT_PURCHASE', assetName: 'Grinder' })), null);
  assert.equal(entryProblem(form({ type: 'WAGES_PAID' })), null);
});

test('"Owner paid" is only offered for equipment and wages', () => {
  assert.deepEqual(paidFromOptions('EQUIPMENT_PURCHASE'), ['CASH', 'BANK', 'OWNER']);
  assert.deepEqual(paidFromOptions('WAGES_PAID'), ['CASH', 'BANK', 'OWNER']);
  assert.deepEqual(paidFromOptions('EXPENSE'), ['CASH', 'BANK']);
  assert.deepEqual(paidFromOptions('OWNER_DRAWING'), ['CASH', 'BANK']);
  assert.deepEqual(paidFromOptions('DEPOSIT_TO_BANK'), []);
});

test('switching from equipment (owner paid) to an expense falls back to cash, and the API never gets OWNER', () => {
  assert.equal(paidFromFor('EXPENSE', 'OWNER'), 'CASH');
  assert.equal(paidFromFor('WAGES_PAID', 'OWNER'), 'OWNER');
  assert.equal(paidFromFor('EXPENSE', 'BANK'), 'BANK');
  // Even if the state slipped through, the older kinds only ever send CASH or BANK.
  assert.equal(buildEntryPayload(form({ type: 'EXPENSE', paidFrom: 'OWNER' })).source, 'CASH');
  assert.equal(buildEntryPayload(form({ type: 'EXPENSE', paidFrom: 'OWNER' })).paidFrom, undefined);
});

// ── the older kinds are sent exactly as before ───────────────────────────────

test('an expense still sends source and category', () => {
  assert.deepEqual(
    buildEntryPayload(form({ paidFrom: 'BANK', note: 'September rent' })),
    { type: 'EXPENSE', amount: 1500, date: '2026-09-22', source: 'BANK', category: 'RENT', note: 'September rent' },
  );
});

test('other income, owner put in, owner took out: source only', () => {
  for (const type of ['OTHER_INCOME', 'OWNER_CONTRIBUTION', 'OWNER_DRAWING']) {
    assert.deepEqual(buildEntryPayload(form({ type })), { type, amount: 1500, date: '2026-09-22', source: 'CASH' });
  }
});

test('a cash <-> bank move has no pocket to choose', () => {
  assert.equal(isTransfer('DEPOSIT_TO_BANK'), true);
  assert.deepEqual(buildEntryPayload(form({ type: 'DEPOSIT_TO_BANK', paidFrom: 'BANK' })),
    { type: 'DEPOSIT_TO_BANK', amount: 1500, date: '2026-09-22' });
  assert.deepEqual(buildEntryPayload(form({ type: 'WITHDRAW_TO_CASH' })),
    { type: 'WITHDRAW_TO_CASH', amount: 1500, date: '2026-09-22' });
});

test('money coming in says "Received in"; money going out says "Paid from"', () => {
  assert.equal(pocketLabel('OTHER_INCOME'), 'Received in');
  assert.equal(pocketLabel('OWNER_CONTRIBUTION'), 'Received in');
  for (const t of ['EXPENSE', 'OWNER_DRAWING', 'EQUIPMENT_PURCHASE', 'WAGES_PAID']) assert.equal(pocketLabel(t), 'Paid from');
});

// ── what the form refuses ────────────────────────────────────────────────────

test('no amount, zero, a third decimal, or no date are caught before the API sees them', () => {
  assert.match(entryProblem(form({ amount: '' })), /greater than zero/);
  assert.match(entryProblem(form({ amount: '0' })), /greater than zero/);
  assert.match(entryProblem(form({ amount: '-5' })), /greater than zero/);
  assert.match(entryProblem(form({ amount: '10.555' })), /two decimal places/);
  assert.match(entryProblem(form({ date: '' })), /date/);
  assert.equal(entryProblem(form({ amount: '0.10' })), null);
  assert.equal(entryProblem(form({ amount: '1234.56' })), null);
  assert.equal(entryProblem(form({ amount: '19.99' })), null);
});

test('the reverse question names the entry, so the wrong row is not reversed', () => {
  const q = reverseQuestion({ entryNumber: 'JE-0464', description: 'Rent expense' }, '₱15,000.00');
  assert.match(q, /^Reverse JE-0464: Rent expense, ₱15,000\.00\?/);
});
