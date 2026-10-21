/**
 * Run: cd apps/web && node --test lib/session/sign-out.spec.mjs
 *
 * Runs the real signOut (lib/session/sign-out.ts), the real auth store's
 * sign-in (store/auth.ts setUser) and the real till stores, on a pretend
 * browser (spec-harness/). One tablet, two shops:
 *
 *   - Shop A signs out, shop B signs in: B finds nothing of A's till, screen
 *     cache or screen pairing. (S4-2, S4-3, S4-4)
 *   - The same shop carries on: a cashier switch by PIN, or a relief cashier
 *     signing in through the locked till, keeps the cart and the open drawer.
 *   - Queued offline sales are never touched by any of it. (S4-1)
 */
import { cookieWrites } from './spec-harness/browser.mjs';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

const { signOut } = await import('./sign-out.ts');
const { registerQueryClient, adoptShopOnLoad, onScreenCacheClear } = await import('./shop-state.ts');
const { DEVICE_SHOP_KEY, CUSTOMER_DISPLAY_STATE_KEY } = await import('./shop-scope.ts');
const { useAuthStore } = await import('../../store/auth.ts');
const { useCartStore } = await import('../../store/pos/cart.ts');
const { useParkedSalesStore } = await import('../../store/pos/parkedSales.ts');
const { useShiftStore } = await import('../../store/pos/shift.ts');
const { useTillLockStore } = await import('../../store/pos/tillLock.ts');
const { DEVICE_TOKEN_STORAGE_KEY } = await import('../pos/device-token.ts');
const { db, reset: resetDb } = await import('./spec-harness/fake-db.mjs');

const A = 'tenant-shop-a';
const B = 'tenant-shop-b';
const user = (sub, tenantId, branchId) => ({
  sub, tenantId, branchId, name: sub, role: 'CASHIER', isSuperAdmin: false, appAccess: [],
  taxStatus: 'UNREGISTERED', isVatRegistered: false, isBirRegistered: false,
});
const mariaOfA = user('u-maria', A, 'br-a-main');
const joyOfA   = user('u-joy',   A, 'br-a-main');
const benOfB   = user('u-ben',   B, 'br-b-main');

/** What the login page does after a successful sign-in. */
function signIn(u, tokens = `${u.sub}`) {
  useAuthStore.getState().setTokens(`acc-${tokens}`, `ref-${tokens}`);
  useAuthStore.getState().setUser(u);
}

/** Shop A's cashier mid-shift: a cart with a senior's discount, a parked table, an open drawer, a locked till. */
async function fillTill() {
  useCartStore.setState({
    lines: [{ lineKey: 'l1', product: { id: 'p-latte', name: 'Latte', price: 150, isVatable: false }, quantity: 2, unitPrice: 150, itemDiscount: 0 }],
    orderDiscount: { type: 'SENIOR_CITIZEN', idRef: 'SC-12345', idOwnerName: 'Mrs Cruz' },
    branchId: 'br-a-main',
    shiftId: 'shift-a-1',
  });
  useParkedSalesStore.getState().add({
    name: 'Table 4 - Mrs Cruz', branchId: 'br-a-main', shiftId: 'shift-a-1',
    lines: [], orderDiscount: null, totalAmount: 300, itemCount: 2,
  });
  useShiftStore.getState().setActiveShift({ id: 'shift-a-1', branchId: 'br-a-main', cashierId: 'u-maria', openingCash: 1000, openedAt: '2026-10-21T00:00:00.000Z', cashSales: 300, nonCashSales: 0, totalSales: 300, orderCount: 1, voidCount: 0, expectedCash: 1300, digitalBreakdown: {} });
  useTillLockStore.getState().lock('Maria');
  localStorage.setItem(CUSTOMER_DISPLAY_STATE_KEY, JSON.stringify({ type: 'CART_UPDATE', businessName: 'Cafe A', lines: [] }));
  await db.activeShift.put({ id: 'shift-a-1', branchId: 'br-a-main', cashierId: 'u-maria', openingCash: 1000, openedAt: 'x', cachedAt: 1 });
}

function tillIsEmpty() {
  const cart = useCartStore.getState();
  assert.deepEqual(cart.lines, [], 'cart lines');
  assert.equal(cart.orderDiscount, null, 'cart discount (senior id)');
  assert.equal(cart.branchId, null, 'cart branch');
  assert.equal(cart.shiftId, null, 'cart shift');
  assert.deepEqual(useParkedSalesStore.getState().sales, [], 'parked sales');
  assert.equal(useShiftStore.getState().activeShift, null, 'saved open shift');
  assert.equal(useTillLockStore.getState().locked, false, 'till lock');
  assert.equal(useTillLockStore.getState().lockedByName, null, 'who locked it');
  assert.equal(localStorage.getItem(CUSTOMER_DISPLAY_STATE_KEY), null, 'customer-display mirror');
}

function tillIsKept() {
  assert.equal(useCartStore.getState().lines.length, 1, 'cart kept');
  assert.equal(useParkedSalesStore.getState().sales.length, 1, 'parked sale kept');
  assert.equal(useShiftStore.getState().activeShift?.id, 'shift-a-1', 'open drawer kept');
}

const pairing = (tenantId) => localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, JSON.stringify({
  deviceToken: `dev-${tenantId}`, tenantId, cashierId: 'u-x', role: 'CUSTOMER_DISPLAY', stationId: null, label: 'Front TV',
}));

let cache;
const realPost = axios.post;
let logoutCalls;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDb();
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null });
  useCartStore.setState({ lines: [], orderDiscount: null, additionalPwdScEntries: [], branchId: null, shiftId: null });
  useParkedSalesStore.setState({ sales: [] });
  useShiftStore.setState({ activeShift: null });
  useTillLockStore.setState({ locked: false, lockedByName: null });
  localStorage.clear();
  cache = { clears: 0, clear() { this.clears++; } };
  registerQueryClient(cache);
  logoutCalls = [];
  axios.post = async (url, body, config) => { logoutCalls.push({ url, body, config }); return { data: {} }; };
});
afterEach(() => { axios.post = realPost; });

describe('shop A signs out, shop B signs in on the same tablet', () => {
  test("B finds nothing of A's till, and A's screen cache is gone", async () => {
    signIn(mariaOfA);
    await fillTill();

    await signOut();

    tillIsEmpty();
    assert.equal(await db.activeShift.count(), 0, 'offline copy of the shift');
    assert.ok(cache.clears >= 1, 'screen data cache (React Query) cleared');
    assert.equal(useAuthStore.getState().accessToken, null);
    assert.equal(localStorage.getItem('app-auth'), null);
    assert.match(cookieWrites.at(-1), /^app-session=; path=\/; expires=Thu, 01 Jan 1970/);
    assert.equal(localStorage.getItem(DEVICE_SHOP_KEY), null, 'nothing left to belong to anyone');

    signIn(benOfB);
    tillIsEmpty();
    assert.equal(localStorage.getItem(DEVICE_SHOP_KEY), B);
  });

  test('the API is asked to close exactly this session, with the refresh token itself', async () => {
    signIn(mariaOfA, 'maria-1');
    await signOut();
    assert.equal(logoutCalls.length, 1);
    assert.match(logoutCalls[0].url, /\/auth\/logout$/);
    assert.deepEqual(logoutCalls[0].body, { refreshToken: 'ref-maria-1' });
    assert.equal(logoutCalls[0].config.headers.Authorization, 'Bearer acc-maria-1');
  });

  test('the API being down never stops the sign-out', async () => {
    signIn(mariaOfA);
    await fillTill();
    axios.post = async () => { throw Object.assign(new Error('Network Error'), { isAxiosError: true }); };
    await signOut();
    tillIsEmpty();
    assert.equal(useAuthStore.getState().accessToken, null);
  });

  test('session expiry (the API refused to renew): nothing is sent, the till is still forgotten', async () => {
    signIn(mariaOfA);
    await fillTill();
    await signOut({ revoke: false });
    assert.equal(logoutCalls.length, 0);
    tillIsEmpty();
  });

  test('in-memory screen history (the toast drawer) is emptied with the cache, and kept on a same-shop PIN switch', async () => {
    signIn(mariaOfA);
    let emptied = 0;
    const off = onScreenCacheClear(() => { emptied++; });
    try {
      signIn(joyOfA, 'joy-pin');            // cashier switch at the locked till
      assert.equal(emptied, 0);
      await signOut();
      assert.equal(emptied, 1);
    } finally {
      off();
    }
  });

  test('queued offline sales are never touched: they are paid sales, kept for their own shop', async () => {
    signIn(mariaOfA);
    await db.pendingOrders.add({ clientUuid: 'u1', branchId: 'br-a-main', tenantId: A, payload: {}, receiptSnapshot: {}, queuedAt: 1, retries: 0, status: 'PENDING' });
    await signOut();
    signIn(benOfB);
    assert.equal(await db.pendingOrders.count(), 1);
    assert.equal((await db.pendingOrders.get(1)).status, 'PENDING');
  });
});

describe('the same shop carries on', () => {
  test('a cashier switch by PIN at the locked till keeps the cart and the open drawer', async () => {
    signIn(mariaOfA);
    await fillTill();
    const clearsBefore = cache.clears;
    signIn(joyOfA, 'joy-pin');
    tillIsKept();
    assert.equal(cache.clears, clearsBefore, 'the screen cache is not thrown away mid-shift');
  });

  test('a relief cashier of the same shop signing in through the locked till keeps the drawer', async () => {
    signIn(mariaOfA);
    await fillTill();
    await signOut({ keepTill: true });
    tillIsKept();
    assert.equal(localStorage.getItem(DEVICE_SHOP_KEY), A);
    assert.equal(useAuthStore.getState().accessToken, null, 'the outgoing cashier is signed out');

    signIn(joyOfA);
    tillIsKept();
  });

  test('...but if whoever signs in next is of another shop, the kept till is forgotten', async () => {
    signIn(mariaOfA);
    await fillTill();
    await signOut({ keepTill: true });
    const clearsBefore = cache.clears;

    signIn(benOfB);
    tillIsEmpty();
    assert.ok(cache.clears > clearsBefore, 'screen cache cleared on the shop change');
    assert.equal(localStorage.getItem(DEVICE_SHOP_KEY), B);
  });
});

describe('a till nobody can vouch for', () => {
  test('left by an older build (no marker, nobody signed in): the next sign-in treats it as a stranger\'s', async () => {
    await fillTill();          // as if left behind before this change
    signIn(benOfB);
    tillIsEmpty();
  });

  test('first page load after this change, already signed in: the till is the session\'s own, so it is only recorded', async () => {
    await fillTill();
    adoptShopOnLoad(A);
    tillIsKept();
    assert.equal(localStorage.getItem(DEVICE_SHOP_KEY), A);
  });

  test('a page load whose session is not the shop the till belongs to: forgotten', async () => {
    await fillTill();
    localStorage.setItem(DEVICE_SHOP_KEY, A);
    adoptShopOnLoad(B);
    tillIsEmpty();
  });
});

describe('screen pairing (customer display) never answers as another shop', () => {
  test("shop B signs in on a tablet once paired as shop A's display: A's pairing is dropped", () => {
    pairing(A);
    signIn(benOfB);
    assert.equal(localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY), null);
  });

  test("the shop's own display pairing survives its own sign-in and sign-out", async () => {
    pairing(A);
    signIn(mariaOfA);
    await signOut();
    assert.ok(localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY), 'still paired to its own shop');
  });

  test("a pairing of another shop left from before is dropped at this shop's sign-out", async () => {
    signIn(benOfB);
    pairing(A);                 // e.g. written before this change, while B was signed in
    await signOut();
    assert.equal(localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY), null);
  });
});
