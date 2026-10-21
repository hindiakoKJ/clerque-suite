/**
 * Run: cd apps/web && node --test lib/session/shop-scope.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts file directly.
 *
 * A tablet shared by two shops. Shop A signs out (or its sign-in runs out) and
 * shop B signs in on the same browser. B must not get A's cart, parked sales,
 * open shift or screen cache, and a leftover screen pairing of A must never
 * answer for B's customer display. Same-shop handovers keep working.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  readStoredSession,
  isShopChange,
  shouldKeepTill,
  refreshFailureKeepsTill,
  isOtherShopsPairing,
  shouldSendDeviceToken,
  TILL_STORE_KEYS,
  CUSTOMER_DISPLAY_STATE_KEY,
} = await import('./shop-scope.ts');

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const src = (p) => readFileSync(join(WEB, p), 'utf8');

const A = 'tenant-shop-a';
const B = 'tenant-shop-b';

/** 'app-auth' exactly as the zustand store persists it. */
const stored = (state) => JSON.stringify({ state, version: 0 });

describe('readStoredSession: the sign-in as the API client sees it', () => {
  test('a signed-in cashier: tokens, shop, branch and user', () => {
    const raw = stored({
      accessToken: 'acc-1', refreshToken: 'ref-1',
      user: { sub: 'u-maria', tenantId: A, branchId: 'br-a1', role: 'CASHIER' },
    });
    assert.deepEqual(readStoredSession(raw), {
      accessToken: 'acc-1', refreshToken: 'ref-1', tenantId: A, branchId: 'br-a1', userId: 'u-maria',
    });
  });

  test('the refresh token is the token itself, not the whole stored entry (sign-out used to post the JSON, so no session was ever closed)', () => {
    const raw = stored({ accessToken: 'acc-1', refreshToken: 'ref-1', user: { sub: 'u', tenantId: A } });
    assert.equal(readStoredSession(raw).refreshToken, 'ref-1');
    assert.notEqual(readStoredSession(raw).refreshToken, raw);
  });

  test('signed out, missing or corrupt: nobody', () => {
    const nobody = { accessToken: null, refreshToken: null, tenantId: null, branchId: null, userId: null };
    assert.deepEqual(readStoredSession(null), nobody);
    assert.deepEqual(readStoredSession(''), nobody);
    assert.deepEqual(readStoredSession('{not json'), nobody);
    assert.deepEqual(readStoredSession(stored({ accessToken: null, refreshToken: null, user: null })), nobody);
  });

  test('a platform admin (no shop): signed in, but no shop', () => {
    const s = readStoredSession(stored({ accessToken: 'acc', refreshToken: 'ref', user: { sub: 'admin', tenantId: null } }));
    assert.equal(s.accessToken, 'acc');
    assert.equal(s.tenantId, null);
  });
});

describe('isShopChange: does this sign-in forget the till left on the device?', () => {
  test('the same shop signs in again (a relief cashier): the till carries on', () => {
    assert.equal(isShopChange(A, A), false);
  });

  test('another shop signs in: forget it', () => {
    assert.equal(isShopChange(A, B), true);
  });

  test('nobody knows whose it is (left by an older build, storage cleared): treat as a stranger', () => {
    assert.equal(isShopChange(null, A), true);
    assert.equal(isShopChange(undefined, A), true);
  });

  test('a sign-in with no shop (platform admin) never inherits a shop till', () => {
    assert.equal(isShopChange(A, null), true);
  });
});

describe('shouldKeepTill: what a sign-out keeps', () => {
  test('an ordinary sign-out keeps nothing', () => {
    assert.equal(shouldKeepTill(false, A), false);
    assert.equal(shouldKeepTill(undefined, A), false);
  });

  test('a locked-till handover keeps the till for the same shop', () => {
    assert.equal(shouldKeepTill(true, A), true);
  });

  test('a handover whose shop is unknown keeps nothing: the next sign-in could not check it', () => {
    assert.equal(shouldKeepTill(true, null), false);
  });
});

describe('refreshFailureKeepsTill: the sign-in could not be renewed', () => {
  const http = (status) => ({ isAxiosError: true, response: status === undefined ? undefined : { status } });

  test('the API said no (expired or revoked): a full sign-out, till forgotten', () => {
    assert.equal(refreshFailureKeepsTill(http(401)), false);
    assert.equal(refreshFailureKeepsTill(http(403)), false);
  });

  test('no refresh token, or one that could not be read: the session is over', () => {
    assert.equal(refreshFailureKeepsTill(new Error('No refresh token')), false);
    assert.equal(refreshFailureKeepsTill(undefined), false);
  });

  test('the API did not answer (offline, mid-deploy 5xx, rate limit): keep the sale in her hands for this shop', () => {
    assert.equal(refreshFailureKeepsTill(http(undefined)), true);
    assert.equal(refreshFailureKeepsTill(http(502)), true);
    assert.equal(refreshFailureKeepsTill(http(503)), true);
    assert.equal(refreshFailureKeepsTill(http(429)), true);
  });
});

describe('screen pairing: never answers as another shop', () => {
  test('a paired screen with nobody signed in sends its pairing (its only key)', () => {
    assert.equal(shouldSendDeviceToken(A, { signedIn: false, tenantId: null }), true);
  });

  test("shop B signed in on a tablet still holding shop A's pairing: B's requests never carry it, so B's expired sign-in cannot fall back to A's live cart", () => {
    assert.equal(shouldSendDeviceToken(A, { signedIn: true, tenantId: B }), false);
  });

  test("the shop's own pairing still rides along with its own sign-in (kitchen tablet with the owner signed in)", () => {
    assert.equal(shouldSendDeviceToken(A, { signedIn: true, tenantId: A }), true);
  });

  test('a pairing whose shop is unknown is not sent while someone is signed in', () => {
    assert.equal(shouldSendDeviceToken(undefined, { signedIn: true, tenantId: A }), false);
    assert.equal(shouldSendDeviceToken(A, { signedIn: true, tenantId: null }), false);
  });

  test("isOtherShopsPairing: drop only a pairing known to be another shop's", () => {
    assert.equal(isOtherShopsPairing(A, B), true);
    assert.equal(isOtherShopsPairing(A, A), false);
    assert.equal(isOtherShopsPairing(undefined, B), false, 'unknown pairing: kept, but the header rule above still holds it back');
    assert.equal(isOtherShopsPairing(A, null), false, 'unknown user: a paired screen is not unpaired by a 401');
  });
});

describe('the storage names sign-out resets are the ones the stores use', () => {
  test('cart, parked sales, saved shift and till lock', () => {
    assert.match(src('store/pos/cart.ts'), new RegExp(`name:\\s*'${TILL_STORE_KEYS.cart}'`));
    assert.match(src('store/pos/parkedSales.ts'), new RegExp(`name:\\s*'${TILL_STORE_KEYS.parkedSales}'`));
    assert.match(src('store/pos/shift.ts'), new RegExp(`name:\\s*'${TILL_STORE_KEYS.shift}'`));
    assert.match(src('store/pos/tillLock.ts'), new RegExp(`name:\\s*'${TILL_STORE_KEYS.tillLock}'`));
  });

  test('the customer-display mirror of the cart', () => {
    assert.match(
      src('lib/pos/customer-display-channel.ts'),
      new RegExp(`STORAGE_KEY\\s*=\\s*'${CUSTOMER_DISPLAY_STATE_KEY}'`),
    );
  });
});

describe('wiring: one sign-out, used by every way a session ends', () => {
  const signOutSrc = src('lib/session/sign-out.ts');
  const stateSrc   = src('lib/session/shop-state.ts');

  test('signOut empties the screen cache, forgets the till and drops another shop\'s pairing', () => {
    assert.match(signOutSrc, /clearScreenCache\(\)/);
    assert.match(signOutSrc, /forgetTill\(\)/);
    assert.match(signOutSrc, /forgetCachedShift\(\)/);
    assert.match(signOutSrc, /dropOtherShopsPairing\(tenantId\)/);
    assert.match(stateSrc, /useCartStore\.setState\(/);
    assert.match(stateSrc, /useParkedSalesStore\.setState\(\{ sales: \[\] \}\)/);
    assert.match(stateSrc, /clearShift\(\)/);
    assert.match(stateSrc, /removeItem\(CUSTOMER_DISPLAY_STATE_KEY\)/);
  });

  test('the remembered business on the login page is a convenience and is kept', () => {
    assert.doesNotMatch(signOutSrc + stateSrc, /lastBusiness|LAST_BUSINESS_KEY/);
  });

  test('the query client and the toast history are registered so signOut can clear them', () => {
    assert.match(src('app/providers.tsx'), /registerQueryClient\(queryClient\)/);
    assert.match(src('components/debug/ToastHistoryDrawer.tsx'), /onScreenCacheClear\(\(\) => \{\s*buffer\.length = 0;/);
  });

  test('session expiry in the API client runs the same signOut, without revoking a dead session', () => {
    const api = src('lib/api.ts');
    assert.match(api, /await signOut\(\{ revoke: false, keepTill: refreshFailureKeepsTill\(err\) \}\)/);
    assert.match(api, /shouldSendDeviceToken\(parsed\.tenantId/);
  });

  test('every sign-in passes the shop check before the user is set', () => {
    const auth = src('store/auth.ts');
    assert.match(auth, /adoptShopOnSignIn\(user\.tenantId, get\(\)\.user\?\.tenantId\);\s*set\(\{ user \}\)/);
    assert.match(auth, /adoptShopOnLoad\(/);
  });

  test('each sign-out button calls signOut', () => {
    for (const p of [
      'app/pos/(pos)/layout.tsx',
      'app/ledger/(ledger)/layout.tsx',
      'app/payroll/(payroll)/layout.tsx',
      'app/admin/(admin)/layout.tsx',
      'app/(portal)/select/page.tsx',
      'app/pos/select-display/page.tsx',
      'components/pos/ShiftGate.tsx',
      'components/demo/DemoBanner.tsx',
    ]) {
      assert.match(src(p), /await signOut\(\)|void signOut\(\)/, `${p} should sign out through signOut()`);
    }
    assert.match(src('components/pos/TillLockOverlay.tsx'), /signOut\(\{ keepTill: true \}\)/);
  });

  test('nothing else ends a session by hand: no other POST /auth/logout, no bare auth-store clear', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const rel = relative(WEB, full).split(sep).join('/');
        if (rel === 'lib/session/sign-out.ts' || rel.startsWith('lib/demo/') || rel.startsWith('app/demo/')) continue;
        const text = readFileSync(full, 'utf8');
        if (/['"`]\/auth\/logout['"`]/.test(text)) offenders.push(`${rel}: posts /auth/logout`);
        if (/useAuthStore\.getState\(\)\.clear\b/.test(text)) offenders.push(`${rel}: clears the auth store itself`);
      }
    };
    walk(WEB);
    assert.deepEqual(offenders, []);
  });
});
