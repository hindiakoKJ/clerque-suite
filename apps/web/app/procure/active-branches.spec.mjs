/**
 * Run: cd apps/web && node --test app/procure/active-branches.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeBranches, isMultiBranch } from './active-branches.ts';

const main   = { id: 'b1', name: 'Main', isActive: true };
const closed = { id: 'b2', name: 'zz live-check branch (delete me)', isActive: false };
const second = { id: 'b3', name: 'Annex', isActive: true };

test('a closed branch is not offered', () => {
  assert.deepEqual(activeBranches([main, closed]).map((b) => b.id), ['b1']);
});

test('one branch in use plus a closed one is still a one-branch shop', () => {
  assert.equal(isMultiBranch([main, closed]), false);
  assert.equal(isMultiBranch([main]), false);
  assert.equal(isMultiBranch([main, second]), true);
});

test('a row with no flag (an older API) counts as in use; nothing at all is nothing', () => {
  assert.deepEqual(activeBranches([{ id: 'x' }]).map((b) => b.id), ['x']);
  assert.deepEqual(activeBranches(undefined), []);
  assert.equal(isMultiBranch(null), false);
});

// The screens that read the branch list use it, so a closed branch cannot come back by a later edit.
test('Procure home and Upload a receipt filter the branch list', () => {
  const home     = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  const receipts = readFileSync(new URL('./receipts/page.tsx', import.meta.url), 'utf8');
  assert.match(home, /isMultiBranch\(branches\)/);
  assert.doesNotMatch(home, /branches\.length > 1/);
  assert.match(receipts, /activeBranches\(/);
});

test('Procure home shows Transfers only to a shop with more than one branch, and no design note', () => {
  const home = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(home, /href:\s+'\/procure\/transfers'[\s\S]{0,400}show:\s+canStock && multiBranch/);
  assert.doesNotMatch(home, /Room-to-room transfers are not built yet/);
  assert.doesNotMatch(home, /worth deciding/);
});

test('the low-stock banner opens the list being built, not whichever list outranks it', () => {
  const home = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(home, /\/procure\/requests\?view=open/);
});

// Stock on hand (re-exported from the POS inventory page): the Receive and
// Write-off dialogs open on the branch already chosen for a one-branch shop,
// offer no closed branch, and the header controls wrap on a phone.
test('Stock on hand preselects the branch, offers open branches only, and wraps its toolbar', () => {
  const inv = readFileSync(new URL('../pos/(pos)/inventory/page.tsx', import.meta.url), 'utf8');
  const openReceive = inv.slice(inv.indexOf('function openReceiveMat('), inv.indexOf('function openReceiveMat(') + 300);
  assert.doesNotMatch(openReceive, /branchId: '',/);
  assert.match(inv, /const defaultBranch = branchId \|\| \(openBranches\.length === 1 \? openBranches\[0\]\.id : ''\);/);
  assert.doesNotMatch(inv, /\{branches\.map\(\(b(r)?\) => <option/);
  assert.match(inv, /<div className="flex flex-wrap items-center gap-2">/);
});
