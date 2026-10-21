/**
 * Run: cd apps/web && node --test lib/pos/pending-scope.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts file directly.
 *
 * Shop A's cashier rings three sales while the tablet is offline and signs
 * out. Shop B signs in on the same browser. B must not see those sales, send
 * them (the API refuses them under B's token and the sync then parks them as
 * failed, so A's paid sales never reach A's books) or delete them. They wait,
 * untouched, until a user of A signs in again. Nothing is ever dropped.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  queueOwnerFrom,
  ownsQueuedSale,
  isUnclaimedSaleOf,
  sameShop,
  splitQueue,
} = await import('./pending-scope.ts');

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const A = 'tenant-shop-a';
const B = 'tenant-shop-b';

// Sign-in tokens as decoded (JwtPayload): sub, tenantId, branchId.
const mariaOfA  = { sub: 'u-maria', tenantId: A, branchId: 'br-a-main' };
const joyOfA    = { sub: 'u-joy',   tenantId: A, branchId: 'br-a-main' };   // same shop, same branch
const ownerOfA  = { sub: 'u-owner-a', tenantId: A, branchId: null };        // spans branches
const benOfB    = { sub: 'u-ben',   tenantId: B, branchId: 'br-b-main' };

const sale = (id, extra) => ({ id, clientUuid: `uuid-${id}`, branchId: 'br-a-main', status: 'PENDING', ...extra });

describe('queueOwnerFrom: who the queue answers to', () => {
  test('a signed-in user of a shop', () => {
    assert.deepEqual(queueOwnerFrom(mariaOfA), { tenantId: A, branchId: 'br-a-main', userId: 'u-maria' });
  });

  test('nobody signed in, or a sign-in with no shop: the queue answers to no one', () => {
    assert.equal(queueOwnerFrom(null), null);
    assert.equal(queueOwnerFrom(undefined), null);
    assert.equal(queueOwnerFrom({ sub: 'admin', tenantId: null, branchId: null }), null);
  });
});

describe('ownsQueuedSale: sales tagged with the shop that rang them', () => {
  const aSale = sale(1, { tenantId: A, userId: 'u-maria' });

  test("shop B cannot see, send or delete shop A's sale", () => {
    assert.equal(ownsQueuedSale(queueOwnerFrom(benOfB), aSale), false);
  });

  test('shop A gets it back when A signs in again', () => {
    assert.equal(ownsQueuedSale(queueOwnerFrom(mariaOfA), aSale), true);
  });

  test("another cashier of the same shop still syncs it (today's same-shop flow)", () => {
    assert.equal(ownsQueuedSale(queueOwnerFrom(joyOfA), aSale), true);
    assert.equal(ownsQueuedSale(queueOwnerFrom(ownerOfA), aSale), true);
  });

  test('signed out: nobody owns anything', () => {
    assert.equal(ownsQueuedSale(null, aSale), false);
  });
});

describe('untagged sales (queued before the shop was recorded): matched by branch', () => {
  const legacy = sale(7); // no tenantId: the payload never carried one

  test('a user whose sign-in names that branch takes it: branch ids are unique across shops', () => {
    assert.equal(isUnclaimedSaleOf(queueOwnerFrom(mariaOfA), legacy), true);
    assert.equal(ownsQueuedSale(queueOwnerFrom(mariaOfA), legacy), true);
  });

  test('another shop never does, so it is never sent under the wrong token', () => {
    assert.equal(isUnclaimedSaleOf(queueOwnerFrom(benOfB), legacy), false);
    assert.equal(ownsQueuedSale(queueOwnerFrom(benOfB), legacy), false);
  });

  test('an owner whose sign-in names no branch cannot prove it: it waits for a user of that branch', () => {
    assert.equal(ownsQueuedSale(queueOwnerFrom(ownerOfA), legacy), false);
  });

  test('a sale with no branch is claimed by nobody', () => {
    assert.equal(isUnclaimedSaleOf(queueOwnerFrom(mariaOfA), sale(8, { branchId: '' })), false);
  });

  test('a tagged sale is never re-claimed, even by a user of the same branch id', () => {
    assert.equal(isUnclaimedSaleOf(queueOwnerFrom(mariaOfA), sale(9, { tenantId: A })), false);
  });
});

describe('the shared tablet, start to finish', () => {
  const queue = [
    sale(1, { tenantId: A, userId: 'u-maria' }),
    sale(2, { tenantId: A, userId: 'u-maria' }),
    sale(3, { tenantId: A, userId: 'u-maria' }),
  ];

  test("B signs in: B's list is empty and nothing of A's is said beyond 'another shop has sales waiting'", () => {
    const { own, othersWaiting } = splitQueue(queueOwnerFrom(benOfB), queue);
    assert.deepEqual(own, []);
    assert.equal(othersWaiting, true);
    assert.deepEqual(Object.keys(splitQueue(queueOwnerFrom(benOfB), queue)).sort(), ['othersWaiting', 'own']);
  });

  test('B rings its own offline sale: B sees only that one; A still sees only its three', () => {
    const withB = [...queue, sale(4, { tenantId: B, branchId: 'br-b-main', userId: 'u-ben' })];
    assert.deepEqual(splitQueue(queueOwnerFrom(benOfB), withB).own.map((s) => s.id), [4]);
    assert.deepEqual(splitQueue(queueOwnerFrom(mariaOfA), withB).own.map((s) => s.id), [1, 2, 3]);
  });

  test('A signs back in: all three are there, in order, and none was lost', () => {
    const { own, othersWaiting } = splitQueue(queueOwnerFrom(mariaOfA), queue);
    assert.deepEqual(own.map((s) => s.id), [1, 2, 3]);
    assert.equal(othersWaiting, false);
  });

  test('a sync started for A stops if the sign-in changes to B before the next batch', () => {
    assert.equal(sameShop(queueOwnerFrom(mariaOfA), queueOwnerFrom(joyOfA)), true);
    assert.equal(sameShop(queueOwnerFrom(mariaOfA), queueOwnerFrom(benOfB)), false);
    assert.equal(sameShop(queueOwnerFrom(mariaOfA), null), false, 'signed out mid-sync: stop too');
  });
});

describe('wiring', () => {
  test('the terminal tags every offline sale with the shop and the person who rang it', () => {
    const terminal = src('app/pos/(pos)/terminal/page.tsx');
    assert.match(terminal, /db\.pendingOrders\.add\(\{[\s\S]*?tenantId: tenantId \|\| undefined,[\s\S]*?userId: user\?\.sub,/);
  });

  test("the sync sends only the signed-in shop's sales and re-checks the shop before each batch", () => {
    const sync = src('lib/pos/sync.ts');
    assert.match(sync, /\.filter\(\(o\) => ownsQueuedSale\(owner, o\)\)/);
    assert.match(sync, /if \(!sameShop\(owner, signedInQueueOwner\(\)\)\) break;/);
    assert.match(sync, /if \(!owner\) return \{ synced: 0, failed: 0, abandoned: 0 \};/);
  });

  test('the Pending Sync page lists only this shop\'s sales and checks the shop again before deleting', () => {
    const page = src('app/pos/(pos)/pending/page.tsx');
    assert.match(page, /splitQueue\(/);
    // Against the stored sign-in the sync uses, not this tab's memory: a sign-in in another tab counts.
    assert.match(page, /ownsQueuedSale\(signedInQueueOwner\(\), row\)/);
    assert.doesNotMatch(page, /db\.pendingOrders\.orderBy\('queuedAt'\)\.reverse\(\)\.toArray\(\),\s*\[\],/);
  });

  test('the pending badge counts only this shop\'s sales', () => {
    assert.match(src('hooks/pos/usePendingSync.ts'), /\.filter\(\(o\) => ownsQueuedSale\(owner, o\)\)\s*\.count\(\)/);
  });

  test('sign-out never touches the offline queue: those are paid sales', () => {
    for (const p of ['lib/session/sign-out.ts', 'lib/session/shop-state.ts']) {
      assert.doesNotMatch(src(p), /pendingOrders/, `${p} must not clear or edit queued sales`);
    }
  });
});
