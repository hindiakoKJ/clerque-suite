/**
 * Run: cd apps/web && node --test "app/pos/(pos)/branch-options.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRANCHES_ROUTE, activeBranchesOnly, defaultBranchId } from './branch-options.ts';

const here = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the branch list comes from the route the API really has', () => {
  assert.equal(BRANCHES_ROUTE, '/tenant/branches');
});

test('no POS page asks for GET /branches, which does not exist', () => {
  for (const page of [
    './pre-orders/page.tsx',
    './rentals/page.tsx',
    './serialized-units/page.tsx',
    './fuel/pumps/page.tsx',
    './fuel/tank-dips/page.tsx',
  ]) {
    const src = here(page);
    assert.doesNotMatch(src, /api\.get\(['"`]\/branches['"`]\)/, page);
    assert.match(src, /api\.get\(BRANCHES_ROUTE\)/, page);
  }
});

test('a switched-off branch is not offered for a new record', () => {
  const rows = [
    { id: 'main', name: 'Main', isActive: true },
    { id: 'old',  name: 'zz closed', isActive: false },
    { id: 'legacy', name: 'No flag' },              // older payload without the flag
  ];
  assert.deepEqual(activeBranchesOnly(rows).map((b) => b.id), ['main', 'legacy']);
  assert.deepEqual(activeBranchesOnly(null), []);
  assert.deepEqual(activeBranchesOnly({ data: [] }), []);   // not an array: nothing, not a crash
});

test('a form opens on the person\'s own branch, else the shop\'s only branch', () => {
  const one = [{ id: 'main', isActive: true }, { id: 'old', isActive: false }];
  const two = [{ id: 'a', isActive: true }, { id: 'b', isActive: true }];
  assert.equal(defaultBranchId('mine', two), 'mine');
  assert.equal(defaultBranchId(null, one), 'main');       // the switched-off one does not count
  assert.equal(defaultBranchId('', two), '');             // several branches: the person chooses
  assert.equal(defaultBranchId(undefined, undefined), '');
});
