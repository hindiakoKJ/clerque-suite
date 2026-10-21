/**
 * What a shared tablet must forget about one shop before the next shop uses it.
 *
 * Two shops can share one browser: a tablet lent between stalls, a laptop at a
 * bookkeeper's desk. Everything the browser keeps for a shop -- the cart, the
 * parked sales, the open shift, the screen data cache, the customer-display
 * mirror, a screen pairing -- has to belong to the shop that is signed in, or
 * the next shop sees it. This file holds the rules; lib/session/shop-state.ts
 * and lib/session/sign-out.ts carry them out.
 *
 * No imports, so `node --test lib/session/shop-scope.spec.mjs` loads it as is.
 */

/**
 * The shop the till state on this device belongs to (its tenant id, nothing
 * else). Written at every sign-in. Kept across a till handover so the next
 * sign-in can tell "same shop, carry on" from "another shop, forget it".
 */
export const DEVICE_SHOP_KEY = 'clerque.deviceShop';

/** The customer-display mirror of the cart (lib/pos/customer-display-channel.ts). */
export const CUSTOMER_DISPLAY_STATE_KEY = 'clerque-customer-display-state';

/**
 * The persisted stores that hold one shop's till, by their storage names.
 * Sign-out resets them through their stores; the names are listed so a spec
 * can check nothing was renamed out from under the reset.
 */
export const TILL_STORE_KEYS = {
  cart:        'clerque-cart',           // sessionStorage (store/pos/cart.ts)
  parkedSales: 'clerque-parked-sales',   // localStorage   (store/pos/parkedSales.ts)
  shift:       'pos-shift',              // localStorage   (store/pos/shift.ts)
  tillLock:    'clerque-till-lock',      // localStorage   (store/pos/tillLock.ts)
} as const;

/** The signed-in session as the API client sees it: the 'app-auth' entry. */
export interface StoredSession {
  accessToken:  string | null;
  refreshToken: string | null;
  tenantId:     string | null;
  branchId:     string | null;
  userId:       string | null;
}

const NO_SESSION: StoredSession = {
  accessToken: null, refreshToken: null, tenantId: null, branchId: null, userId: null,
};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Read the raw 'app-auth' value. Never throws: a corrupt entry reads as signed out.
 *
 * Callers used to post the whole JSON string as the refresh token on sign-out,
 * so the API never found the session and never closed it.
 */
export function readStoredSession(raw: string | null | undefined): StoredSession {
  if (!raw) return NO_SESSION;
  try {
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> } | null;
    const state = parsed?.state;
    if (!state || typeof state !== 'object') return NO_SESSION;
    const user = (state.user && typeof state.user === 'object') ? state.user as Record<string, unknown> : {};
    return {
      accessToken:  str(state.accessToken),
      refreshToken: str(state.refreshToken),
      tenantId:     str(user.tenantId),
      branchId:     str(user.branchId),
      userId:       str(user.sub),
    };
  } catch {
    return NO_SESSION;
  }
}

/**
 * Does signing in as `nextTenantId` mean the till state on this device must go?
 *
 * Yes when it belonged to another shop, and also when nobody knows whose it is
 * (no marker: state left by a build before this one, or storage cleared). An
 * unknown owner is treated as a stranger: losing a parked cart once is better
 * than showing one shop's customers to another.
 */
export function isShopChange(
  previousTenantId: string | null | undefined,
  nextTenantId: string | null | undefined,
): boolean {
  if (!previousTenantId || !nextTenantId) return true;
  return previousTenantId !== nextTenantId;
}

/**
 * A till handover keeps the cart, parked sales and open shift for the next
 * cashier -- but only when we know which shop they belong to, so the next
 * sign-in can check it is the same shop.
 */
export function shouldKeepTill(
  keepTill: boolean | undefined,
  tenantId: string | null | undefined,
): boolean {
  return !!keepTill && !!tenantId;
}

/**
 * The sign-in could not be renewed, so this device signs out. Was the session
 * really over, or did the server just not answer?
 *
 * Over -- the API said no (401/403), or there was no usable refresh token --
 * means a full sign-out: the till is forgotten. Not answering -- no response,
 * a 5xx while the API redeploys, a 429 -- still signs out as before, but keeps
 * the cart, parked sales and open shift for this shop's next sign-in (another
 * shop's sign-in still clears them), so a network blip does not cost a cashier
 * the sale in her hands.
 */
export function refreshFailureKeepsTill(err: unknown): boolean {
  const e = err as { isAxiosError?: boolean; response?: { status?: number } } | null | undefined;
  if (!e || e.isAxiosError !== true) return false;
  const status = e.response?.status;
  if (status === undefined) return true;
  return status !== 401 && status !== 403;
}

/** A stored screen pairing known to be another shop's. Unknown is not "other". */
export function isOtherShopsPairing(
  pairingTenantId: string | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  return !!pairingTenantId && !!tenantId && pairingTenantId !== tenantId;
}

/**
 * Should a request carry the stored screen pairing (X-Device-Token)?
 *
 * A paired screen with nobody signed in: yes, the pairing is its only key.
 * Somebody signed in: only when the pairing is their own shop's. The API falls
 * back to the pairing when the sign-in token fails, so a leftover pairing of
 * another shop would answer as that shop the moment this shop's sign-in
 * expired.
 */
export function shouldSendDeviceToken(
  pairingTenantId: string | null | undefined,
  session: { signedIn: boolean; tenantId: string | null | undefined },
): boolean {
  if (!session.signedIn) return true;
  return !!pairingTenantId && !!session.tenantId && pairingTenantId === session.tenantId;
}
