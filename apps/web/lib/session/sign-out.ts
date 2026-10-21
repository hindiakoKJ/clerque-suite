/**
 * The one way a sign-in ends on this device: every Sign Out button, the
 * locked-till handover, and the API client when the session can no longer be
 * renewed. Each path used to clear only the token, so on a shared tablet the
 * next shop found the last shop's cart, parked sales, open shift and screen
 * cache. Callers navigate afterwards, as they always did.
 */

import axios from 'axios';
import { useAuthStore } from '@/store/auth';
import { readStoredSession, shouldKeepTill } from './shop-scope';
import {
  clearScreenCache,
  dropOtherShopsPairing,
  forgetCachedShift,
  forgetTill,
  writeDeviceShop,
} from './shop-state';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export interface SignOutOptions {
  /**
   * Ask the API to close this device's session. Default on. Off when the
   * session is already dead (the API refused to renew it).
   */
  revoke?: boolean;
  /**
   * A till handover, not a goodbye: keep the cart, parked sales and open
   * shift for the next cashier. They are still forgotten if the next sign-in
   * is another shop (store/auth.ts setUser -> adoptShopOnSignIn).
   */
  keepTill?: boolean;
}

export async function signOut({ revoke = true, keepTill = false }: SignOutOptions = {}): Promise<void> {
  if (typeof window === 'undefined') return;

  // From storage, not the store: the API client renews tokens straight into
  // storage, so the store can hold an already-rotated refresh token.
  let raw: string | null = null;
  try { raw = window.localStorage.getItem('app-auth'); } catch { /* blocked: nothing stored */ }
  const session  = readStoredSession(raw);
  const tenantId = session.tenantId ?? useAuthStore.getState().user?.tenantId ?? null;

  if (revoke && session.accessToken && session.refreshToken) {
    try {
      // Plain axios, not the shared client: a 401 here must not start the
      // renew-or-sign-out cycle of the client that is calling us. Bounded so
      // a dead connection never traps a cashier on the Sign Out button.
      await axios.post(
        `${API_URL}/auth/logout`,
        { refreshToken: session.refreshToken },
        { headers: { Authorization: `Bearer ${session.accessToken}` }, timeout: 5_000 },
      );
    } catch {
      // Best effort: this device forgets the session whatever the API said.
    }
  }

  useAuthStore.getState().clear();
  try { window.localStorage.removeItem('app-auth'); } catch { /* cleared in memory already */ }
  // Also clear the web-origin mirror cookie (server clears its own HttpOnly copy).
  document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

  clearScreenCache();
  dropOtherShopsPairing(tenantId);

  if (shouldKeepTill(keepTill, tenantId)) {
    writeDeviceShop(tenantId);
  } else {
    forgetTill();
    writeDeviceShop(null);
    await forgetCachedShift();
  }
}
