/**
 * Run: cd apps/web && node --test lib/pos/sync.spec.mjs
 *
 * Runs the real offline sync (lib/pos/sync.ts) against an in-memory queue and
 * a pretend API that, like the real one, refuses a sale whose branch is not
 * in the caller's shop (orders.service.ts). One tablet, two shops: B's sync
 * must never send A's sales -- before this, they were refused, parked at the
 * retry cap and later abandoned, so A's paid sales never reached A's books.
 */
import '../session/spec-harness/browser.mjs';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { syncPendingOrders, claimUnclaimedOrders, signedInQueueOwner } = await import('./sync.ts');
const { queueOwnerFrom } = await import('./pending-scope.ts');
const { useAuthStore } = await import('../../store/auth.ts');
const { db, reset: resetDb } = await import('../session/spec-harness/fake-db.mjs');
const { calls, onRequest, resetApi } = await import('../session/spec-harness/fake-api.mjs');

const A = 'tenant-shop-a';
const B = 'tenant-shop-b';
const SHOP_OF_BRANCH = { 'br-a-main': A, 'br-b-main': B };

const user = (sub, tenantId, branchId) => ({
  sub, tenantId, branchId, name: sub, role: 'CASHIER', isSuperAdmin: false, appAccess: [],
  taxStatus: 'UNREGISTERED', isVatRegistered: false, isBirRegistered: false,
});
const mariaOfA = user('u-maria', A, 'br-a-main');
const joyOfA   = user('u-joy',   A, 'br-a-main');
const benOfB   = user('u-ben',   B, 'br-b-main');

function signIn(u) {
  useAuthStore.getState().setTokens(`acc-${u.sub}`, `ref-${u.sub}`);
  useAuthStore.getState().setUser(u);
}
function signOutLocally() {
  useAuthStore.getState().clear();
}

/** A sale queued at the till while offline. `tenantId` absent = queued by an older build. */
async function queue(uuid, branchId, extra = {}) {
  return db.pendingOrders.add({
    clientUuid: uuid, branchId,
    payload: { clientUuid: uuid, branchId },
    receiptSnapshot: { totalAmount: 100 },
    queuedAt: Date.now(), retries: 0, status: 'PENDING',
    ...extra,
  });
}

/** The API: creates sales of the caller's own shop, refuses any other branch. */
function realisticServer(onCall) {
  onRequest(async (entry) => {
    onCall?.(entry);
    const results = entry.body.orders.map((o) => (SHOP_OF_BRANCH[o.branchId] === entry.shop
      ? { clientUuid: o.clientUuid, orderId: `ord-${o.clientUuid}` }
      : { clientUuid: o.clientUuid, error: 'branchId does not belong to your organization' }));
    return { data: { results, firstFailureIndex: null, successCount: 0, failureCount: 0 } };
  });
}

const sent = () => calls.flatMap((c) => c.body.orders.map((o) => ({ uuid: o.clientUuid, shop: c.shop })));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDb();
  resetApi();
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null });
  realisticServer();
});

describe("shop B's sync on a tablet holding shop A's offline sales", () => {
  test("sends only B's sale; A's three are not sent, not touched, not failed", async () => {
    for (const u of ['a1', 'a2', 'a3']) await queue(u, 'br-a-main', { tenantId: A, userId: 'u-maria' });
    await queue('b1', 'br-b-main', { tenantId: B, userId: 'u-ben' });
    signIn(benOfB);

    const result = await syncPendingOrders();

    assert.deepEqual(sent(), [{ uuid: 'b1', shop: B }]);
    assert.deepEqual(result, { synced: 1, failed: 0, abandoned: 0 });
    const left = await db.pendingOrders.toArray();
    assert.deepEqual(left.map((o) => o.clientUuid).sort(), ['a1', 'a2', 'a3']);
    for (const o of left) {
      assert.equal(o.status, 'PENDING');
      assert.equal(o.retries, 0, 'no retry burnt on a sale that was never sent');
      assert.equal(o.lastError, undefined);
    }
  });

  test('then A signs back in: its three reach A\'s books, under A\'s own token', async () => {
    for (const u of ['a1', 'a2', 'a3']) await queue(u, 'br-a-main', { tenantId: A, userId: 'u-maria' });
    signIn(benOfB);
    await syncPendingOrders();
    signOutLocally();

    signIn(mariaOfA);
    const result = await syncPendingOrders();

    assert.deepEqual(sent(), ['a1', 'a2', 'a3'].map((uuid) => ({ uuid, shop: A })));
    assert.deepEqual(result, { synced: 3, failed: 0, abandoned: 0 });
    assert.equal(await db.pendingOrders.count(), 0);
  });

  test("another cashier of the same shop syncs them (today's same-shop flow)", async () => {
    await queue('a1', 'br-a-main', { tenantId: A, userId: 'u-maria' });
    signIn(joyOfA);
    const result = await syncPendingOrders();
    assert.deepEqual(sent(), [{ uuid: 'a1', shop: A }]);
    assert.equal(result.synced, 1);
  });

  test("B's sync never abandons A's sale that is already at the retry cap", async () => {
    await queue('a1', 'br-a-main', { tenantId: A, retries: 5, status: 'FAILED', lastError: 'timeout' });
    signIn(benOfB);
    const result = await syncPendingOrders();
    assert.equal(result.abandoned, 0);
    assert.equal((await db.pendingOrders.get(1)).lastError, 'timeout');
  });

  test('nobody signed in: nothing is sent and nothing changes', async () => {
    await queue('a1', 'br-a-main', { tenantId: A });
    const result = await syncPendingOrders();
    assert.equal(calls.length, 0);
    assert.deepEqual(result, { synced: 0, failed: 0, abandoned: 0 });
    assert.equal((await db.pendingOrders.get(1)).status, 'PENDING');
  });

  test('the sign-in changes shops mid-sync: the next batch is not sent under the new shop', async () => {
    for (let i = 1; i <= 12; i++) await queue(`a${i}`, 'br-a-main', { tenantId: A });
    signIn(mariaOfA);
    realisticServer(() => {
      // While the first batch is in flight, A signs out and B signs in.
      if (calls.length === 1) { signOutLocally(); signIn(benOfB); }
    });

    const result = await syncPendingOrders();

    assert.equal(calls.length, 1, 'only the batch already in flight went out');
    assert.ok(sent().every((s) => s.shop === A));
    assert.equal(result.synced, 10);
    const left = await db.pendingOrders.toArray();
    assert.deepEqual(left.map((o) => o.clientUuid), ['a11', 'a12']);
    for (const o of left) {
      assert.equal(o.status, 'PENDING');
      assert.equal(o.retries, 0);
    }
  });
});

describe('sales queued before the shop was recorded', () => {
  test("claimed by a user of the sale's branch, stamped with the shop, and sent", async () => {
    await queue('old-1', 'br-a-main');            // no tenantId
    signIn(mariaOfA);
    const result = await syncPendingOrders();
    assert.deepEqual(sent(), [{ uuid: 'old-1', shop: A }]);
    assert.equal(result.synced, 1);
  });

  test('another shop never claims or sends them; they wait for their own branch', async () => {
    await queue('old-1', 'br-a-main');
    signIn(benOfB);
    assert.equal(await claimUnclaimedOrders(signedInQueueOwner()), 0);
    await syncPendingOrders();
    assert.equal(calls.length, 0);
    const row = await db.pendingOrders.get(1);
    assert.equal(row.tenantId, undefined);
    assert.equal(row.status, 'PENDING');
  });

  test('an owner whose sign-in names no branch leaves them for a user of that branch', async () => {
    await queue('old-1', 'br-a-main');
    signIn(user('u-owner', A, null));
    await syncPendingOrders();
    assert.equal(calls.length, 0);
    assert.equal(await claimUnclaimedOrders(queueOwnerFrom(mariaOfA)), 1, 'a cashier of the branch then claims it');
    assert.equal((await db.pendingOrders.get(1)).tenantId, A);
  });
});
