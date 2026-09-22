/**
 * Run: cd apps/web && node --test "app/ledger/(ledger)/journal/highlight.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHighlight, pinHighlighted } from './highlight.ts';

test('the entry id is read from ?highlight=', () => {
  assert.equal(readHighlight('?highlight=cmuax4zvz000fvfl8z1fvbhp0'), 'cmuax4zvz000fvfl8z1fvbhp0');
  assert.equal(readHighlight('?page=2&highlight=cmuax4zvz000fvfl8z1fvbhp0'), 'cmuax4zvz000fvfl8z1fvbhp0');
});

test('no highlight, or something that is not an id, is ignored', () => {
  assert.equal(readHighlight(''), null);
  assert.equal(readHighlight('?highlight='), null);
  assert.equal(readHighlight('?highlight=../import/template'), null);
  assert.equal(readHighlight('?highlight=a b'), null);
});

test('the asked-for entry goes on top, once, and the rest keep their order', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(pinHighlighted(rows, { id: 'b' }).map((r) => r.id), ['b', 'a', 'c']);
  // Not on this page (older than the newest 50): still shown, on top.
  assert.deepEqual(pinHighlighted(rows, { id: 'z' }).map((r) => r.id), ['z', 'a', 'b', 'c']);
  assert.equal(pinHighlighted(rows, null), rows);
});
