/**
 * Run: cd apps/web && node --test "app/(portal)/select/restricted-reason.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { restrictedMessage, RESTRICTED_REASONS } = await import('./restricted-reason.ts');

describe('restrictedMessage: why someone landed on the app picker', () => {
  test('every reason the edge guard can send has a message (Procure had none)', () => {
    for (const reason of ['pos-restricted', 'procure-restricted', 'ledger-restricted']) {
      assert.ok(restrictedMessage(reason), reason);
    }
  });
  test('names the app the page belonged to and what to do next', () => {
    assert.equal(
      restrictedMessage('procure-restricted'),
      'That page is part of Procure, which your sign-in cannot open. Pick one of your apps below.',
    );
    assert.equal(
      restrictedMessage('pos-restricted', 'Procure'),
      'That page is part of Counter, which your sign-in cannot open. We brought you back to Procure.',
    );
    assert.match(restrictedMessage('ledger-restricted'), /part of Ledger/);
  });
  test('unknown, blank or missing reasons say nothing', () => {
    assert.equal(restrictedMessage('made-up'), null);
    assert.equal(restrictedMessage(''), null);
    assert.equal(restrictedMessage(null), null);
    assert.equal(restrictedMessage(undefined), null);
    assert.equal(restrictedMessage('constructor'), null); // not fooled by Object.prototype keys
  });
  test('knows exactly the reasons middleware.ts sends', () => {
    const middleware = readFileSync(new URL('../../../middleware.ts', import.meta.url), 'utf8');
    const sent = [...middleware.matchAll(/\/select\?reason=([a-z-]+)/g)].map((m) => m[1]);
    assert.ok(sent.length >= 3, 'middleware.ts should redirect with ?reason= at least three times');
    assert.deepEqual(new Set(sent), new Set(RESTRICTED_REASONS));
  });
});
