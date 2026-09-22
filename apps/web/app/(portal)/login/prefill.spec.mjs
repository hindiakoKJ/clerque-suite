/**
 * Run: cd apps/web && node --test "app/(portal)/login/prefill.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { writeLoginPrefill, takeLoginPrefill, LOGIN_PREFILL_KEY } = await import('./prefill.ts');

/** A stand-in for sessionStorage. */
function fakeStore() {
  const m = new Map();
  return {
    getItem:    (k) => (m.has(k) ? m.get(k) : null),
    setItem:    (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    size:       () => m.size,
  };
}

describe('signup hands the new owner\'s Tenant ID and email to the sign-in form, once', () => {
  test('what signup writes, sign-in reads back trimmed', () => {
    const store = fakeStore();
    writeLoginPrefill({ tenantId: ' cafe-carolina ', email: ' anne@example.com ' }, store);
    assert.deepEqual(takeLoginPrefill(store), { tenantId: 'cafe-carolina', email: 'anne@example.com' });
  });
  test('it is used once: the second read finds nothing', () => {
    const store = fakeStore();
    writeLoginPrefill({ tenantId: 'cafe-carolina', email: 'anne@example.com' }, store);
    takeLoginPrefill(store);
    assert.equal(takeLoginPrefill(store), null);
    assert.equal(store.size(), 0);
  });
  test('nothing written, or junk in the slot, is nothing', () => {
    const store = fakeStore();
    assert.equal(takeLoginPrefill(store), null);
    store.setItem(LOGIN_PREFILL_KEY, 'not json');
    assert.equal(takeLoginPrefill(store), null);
    store.setItem(LOGIN_PREFILL_KEY, JSON.stringify({ tenantId: '  ', email: '' }));
    assert.equal(takeLoginPrefill(store), null);
  });
  test('storage that is blocked or throws never breaks signup or sign-in', () => {
    const broken = {
      getItem:    () => { throw new Error('blocked'); },
      setItem:    () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    assert.doesNotThrow(() => writeLoginPrefill({ tenantId: 'x', email: 'y' }, broken));
    assert.equal(takeLoginPrefill(broken), null);
    assert.doesNotThrow(() => writeLoginPrefill({ tenantId: 'x', email: 'y' }, null));
    assert.equal(takeLoginPrefill(null), null);
  });
});
