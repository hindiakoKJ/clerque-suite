/**
 * Run: cd apps/web && node --test "app/ledger/(ledger)/_lib/statement-rows.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasBalance, visibleRows, emptyCount, segmentRows, ASSET_BUCKETS, LIABILITY_BUCKETS, isCashOrBankCode,
  shownGroups,
} from './statement-rows.ts';

const row = (code, name, balance) => ({ id: code, code, name, balance });

test('a cafe does not see court-rental income unless it has a balance', () => {
  const revenue = [
    row('4010', 'Sales Revenue – POS', 1296),
    row('4110', 'Court Rental Income', 0),
    row('4111', 'Open Play Income', 0),
    row('4116', 'Refunds & Cancellations', 0),
  ];
  assert.deepEqual(visibleRows(revenue, false).map((r) => r.code), ['4010']);
  assert.equal(visibleRows(revenue, true).length, 4);
  assert.equal(emptyCount(revenue), 3);
  // ...and a sports club that did rent a court still sees its line.
  assert.deepEqual(visibleRows([row('4110', 'Court Rental Income', 500)], false).map((r) => r.code), ['4110']);
});

test('negative balances are kept; float dust is not', () => {
  assert.equal(hasBalance({ balance: -80 }), true);
  assert.equal(hasBalance({ balance: 0.004 }), false);
  assert.equal(hasBalance({ balance: -0.004 }), false);
  assert.equal(hasBalance({ balance: 0.01 }), true);
});

test('hiding zero rows never changes a total', () => {
  const rows = [row('6010', 'Rent', 15000), row('6020', 'Utilities', 0), row('6030', 'Wages', 8000)];
  const sum = (rs) => rs.reduce((s, r) => s + r.balance, 0);
  assert.equal(sum(visibleRows(rows, false)), sum(rows));
});

test('the seeded chart: inventory is not cash (it all used to land in the first group)', () => {
  const assets = [
    row('1010', 'Cash on Hand', -12000),
    row('1020', 'Cash in Bank – Current Account', 5000),
    row('1031', 'Digital Wallet Receivable', 1628),
    row('1040', 'Input VAT', 300),
    row('1051', 'Raw Materials Inventory', 160004.3),
    row('1062', 'Prepaid Rent', 20000),
    row('1075', 'Machinery & Equipment', 85000),
    row('1076', 'Accumulated Depreciation – Machinery', -5000),
    row('1096', 'Long-term Deposits & Guarantees', 30000),
  ];
  const { groups, overflow } = segmentRows(assets, ASSET_BUCKETS);
  assert.deepEqual(overflow, []);
  const by = Object.fromEntries(groups.map((g) => [g.label, g]));
  assert.deepEqual(by['Cash & Cash Equivalents'].rows.map((r) => r.code), ['1010', '1020']);
  assert.equal(by['Cash & Cash Equivalents'].total, -7000);
  assert.deepEqual(by['Receivables'].rows.map((r) => r.code), ['1031']);
  assert.deepEqual(by['Tax Assets'].rows.map((r) => r.code), ['1040']);
  assert.deepEqual(by['Inventory'].rows.map((r) => r.code), ['1051']);
  assert.deepEqual(by['Prepayments & Other Current'].rows.map((r) => r.code), ['1062']);
  assert.deepEqual(by['Property & Equipment'].rows.map((r) => r.code), ['1075', '1076']);
  assert.equal(by['Property & Equipment'].total, 80000);
  assert.deepEqual(by['Intangible & Other Non-Current'].rows.map((r) => r.code), ['1096']);
});

test('the seeded chart: liabilities are split, not all "Trade Payables"', () => {
  const liabilities = [
    row('2010', 'Accounts Payable – Trade', 4000),
    row('2020', 'Output VAT Payable', 100),
    row('2030', 'SSS Contributions Payable', 900),
    row('2065', 'Income Tax Payable', 50),
    row('2071', 'Bank Loans – Short-term', 10000),
    row('2074', 'Customer Deposits & Advances', 500),
    row('2081', 'Accrued Salaries & Wages', 7000),
    row('2090', 'Long-term Bank Loans', 250000),
  ];
  const { groups, overflow } = segmentRows(liabilities, LIABILITY_BUCKETS);
  assert.deepEqual(overflow, []);
  assert.deepEqual(groups.map((g) => [g.label, g.rows.map((r) => r.code)]), [
    ['Trade Payables', ['2010']],
    ['Tax & Government Payables', ['2020', '2030', '2065']],
    ['Loans, Deposits & Other Current', ['2071', '2074']],
    ['Accrued Liabilities', ['2081']],
    ['Long-term Liabilities', ['2090']],
  ]);
});

test('every seeded asset and liability code has a group; an odd code is not lost', () => {
  for (let c = 1010; c <= 1099; c++) {
    assert.equal(segmentRows([row(String(c), 'x', 1)], ASSET_BUCKETS).overflow.length, 0, `asset ${c}`);
  }
  for (let c = 2010; c <= 2096; c++) {
    assert.equal(segmentRows([row(String(c), 'x', 1)], LIABILITY_BUCKETS).overflow.length, 0, `liability ${c}`);
  }
  // A shop that numbered its own chart the older, wider way still groups sensibly.
  assert.equal(segmentRows([row('1850', 'Espresso machine', 1)], ASSET_BUCKETS).groups[0].label, 'Property & Equipment');
  // A code outside every band comes back as overflow ("Other Assets"), never dropped.
  assert.deepEqual(segmentRows([row('A-1', 'Odd', 5)], ASSET_BUCKETS).overflow.map((r) => r.code), ['A-1']);
});

test('bank reconciliation offers cash and bank accounts only', () => {
  for (const c of ['1010', '1011', '1020', '1021', '1022', '1025']) assert.equal(isCashOrBankCode(c), true, c);
  // These all start with "10" and used to be offered as bank accounts.
  for (const c of ['1030', '1031', '1032', '1040', '1051', '1071', '1099', '10', '1010-A', '']) {
    assert.equal(isCashOrBankCode(c), false, c);
  }
});

test('balance sheet groups keep the API total, so depreciation reduces Property & Equipment', () => {
  // Equipment 50,000 less Accumulated Depreciation 5,000: the API sends the
  // group at 45,000 while each row shows its own-direction balance.
  const groups = [
    { label: 'Cash & Cash Equivalents', rows: [row('1010', 'Cash on Hand', 1200), row('1015', 'Petty Cash', 0)], total: 1200 },
    { label: 'Property & Equipment', rows: [row('1075', 'Machinery & Equipment', 50000), row('1076', 'Accumulated Depreciation', 5000)], total: 45000 },
    { label: 'Receivables', rows: [row('1030', 'Accounts Receivable', 0)], total: 0 },
  ];
  const shown = shownGroups(groups, false);
  assert.deepEqual(shown.map((g) => g.label), ['Cash & Cash Equivalents', 'Property & Equipment']);
  assert.equal(shown[1].total, 45000);
  assert.deepEqual(shown[0].rows.map((r) => r.code), ['1010']);
  assert.equal(shownGroups(groups, true).length, 3);
});
