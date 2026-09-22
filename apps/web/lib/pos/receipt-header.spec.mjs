/**
 * Run: cd apps/web && node --test lib/pos/receipt-header.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts files directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { receiptBusinessName, receiptBranchLine } = await import('./receipt-header.ts');

describe('receiptBusinessName: the heading on the customer slip', () => {
  test('the COR business name wins when the owner filled it in', () => {
    assert.equal(
      receiptBusinessName({ corBusinessName: 'Carolina Food Ventures', brandingName: 'Cafe Carolina', branchName: 'Main' }),
      'Carolina Food Ventures',
    );
  });

  test('BIR & Tax box left blank: the name the account was created with, as the Settings preview shows', () => {
    // Cafe Carolina: businessName is null in the login token, tenant name is set.
    assert.equal(
      receiptBusinessName({ corBusinessName: null, brandingName: 'Cafe Carolina', branchName: 'Main Branch' }),
      'Cafe Carolina',
    );
  });

  test('till came up offline (branding never loaded): the name this device remembered at sign-in', () => {
    assert.equal(
      receiptBusinessName({ corBusinessName: null, brandingName: null, rememberedName: 'Cafe Carolina' }),
      'Cafe Carolina',
    );
  });

  test('blank and whitespace-only names are skipped, and the result is trimmed', () => {
    assert.equal(receiptBusinessName({ corBusinessName: '   ', brandingName: '', branchName: '  Main Branch ' }), 'Main Branch');
  });

  test('nothing known: an empty heading, never a made-up shop name', () => {
    assert.equal(receiptBusinessName({}), '');
    assert.equal(receiptBusinessName({ corBusinessName: null, brandingName: undefined, rememberedName: null, branchName: null }), '');
  });
});

describe('receiptBranchLine: the small line under the heading', () => {
  test('shown when it adds something', () => {
    assert.equal(receiptBranchLine('Cafe Carolina', 'Main Branch'), 'Main Branch');
  });
  test('left out when the heading already IS the branch name, or there is no heading', () => {
    assert.equal(receiptBranchLine('Main Branch', 'main branch'), '');
    assert.equal(receiptBranchLine('', 'Main Branch'), '');
    assert.equal(receiptBranchLine('Cafe Carolina', null), '');
  });
});

test('no receipt code path can print a demo shop name any more', () => {
  for (const file of ['./printer.ts', '../../components/pos/ReceiptModal.tsx']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /demo store/i, `${file} still contains a "Demo Store" fallback`);
  }
});
