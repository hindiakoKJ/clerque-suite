/**
 * Run: cd apps/web && node --test "app/ledger/(ledger)/accounts/[[]id]/ledger-filename.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerExportFilename } from './ledger-filename.ts';

test('the file is named after the account, not its database id', () => {
  assert.equal(
    ledgerExportFilename({ code: '1010', name: 'Cash on Hand' }, '2026-09-01', '2026-09-22'),
    'ledger-1010-cash-on-hand-2026-09-01_to_2026-09-22.xlsx',
  );
});

test('symbols and accents are made safe for a filename', () => {
  assert.equal(
    ledgerExportFilename({ code: '2030', name: 'SSS / PhilHealth & Pag-IBIG Payable' }, '2026-09-01', '2026-09-30'),
    'ledger-2030-sss-philhealth-and-pag-ibig-payable-2026-09-01_to_2026-09-30.xlsx',
  );
  assert.equal(
    ledgerExportFilename({ code: '4010', name: 'Café Sales' }, '2026-09-01', '2026-09-30'),
    'ledger-4010-cafe-sales-2026-09-01_to_2026-09-30.xlsx',
  );
});

test('an account that has not loaded yet still gives a sensible name', () => {
  assert.equal(ledgerExportFilename(undefined, '2026-09-01', '2026-09-22'), 'ledger-account-2026-09-01_to_2026-09-22.xlsx');
  assert.equal(ledgerExportFilename({ code: null, name: null }, '2026-09-01', '2026-09-22'), 'ledger-account-2026-09-01_to_2026-09-22.xlsx');
});
