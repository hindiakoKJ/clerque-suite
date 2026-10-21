/**
 * Forgetting one shop's till on a shared device. The rules are in
 * lib/session/shop-scope.ts; sign-out (lib/session/sign-out.ts) and sign-in
 * (store/auth.ts setUser) call these.
 *
 * Deliberately NOT here: the offline sales queue. Those are paid sales; they
 * are never wiped, only kept to their own shop (lib/pos/pending-scope.ts).
 */

import type { QueryClient } from '@tanstack/react-query';
import { useCartStore } from '@/store/pos/cart';
import { useParkedSalesStore } from '@/store/pos/parkedSales';
import { useShiftStore } from '@/store/pos/shift';
import { useTillLockStore } from '@/store/pos/tillLock';
import { clearDeviceToken, readDeviceToken } from '@/lib/pos/device-token';
import {
  CUSTOMER_DISPLAY_STATE_KEY,
  DEVICE_SHOP_KEY,
  isOtherShopsPairing,
  isShopChange,
} from './shop-scope';

/*
  The screen data cache (React Query). One client lives for the whole tab and
  its query keys carry no shop, so after a client-side sign-out the next shop
  was handed the last shop's staff, customers and menu from it. Providers
  registers the client here so sign-out can empty it.
*/
let queryClient: QueryClient | null = null;

export function registerQueryClient(client: QueryClient | null): void {
  queryClient = client;
}

/*
  Other screen state kept in memory for the tab's life, which a client-side
  sign-out does not reload away: the toast history drawer (its messages name
  parked tables, customers, amounts and staff).
*/
const screenMemory = new Set<() => void>();

/** Register in-memory screen state to be emptied with the screen cache. */
export function onScreenCacheClear(clear: () => void): () => void {
  screenMemory.add(clear);
  return () => { screenMemory.delete(clear); };
}

/** Empty the screen data cache and every registered in-memory screen state. */
export function clearScreenCache(): void {
  try { queryClient?.clear(); } catch { /* nothing cached to lose */ }
  for (const clear of screenMemory) {
    try { clear(); } catch { /* one screen failing must not keep the others */ }
  }
}

/** The shop the till state on this device belongs to, or null if unknown. */
export function readDeviceShop(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(DEVICE_SHOP_KEY) || null; } catch { return null; }
}

/** Record whose till state this is; null forgets it (nothing is left to own). */
export function writeDeviceShop(tenantId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    if (tenantId) window.localStorage.setItem(DEVICE_SHOP_KEY, tenantId);
    else window.localStorage.removeItem(DEVICE_SHOP_KEY);
  } catch { /* blocked storage: the next sign-in treats the till as a stranger's */ }
}

/**
 * Empty the till: cart (with its branch and shift), parked sales (they hold
 * PWD/SC ids and names), the saved open shift, the till lock (it shows who
 * locked it) and the customer-display mirror of the cart. Each store is reset
 * through its own API so the empty state is what gets persisted.
 */
export function forgetTill(): void {
  if (typeof window === 'undefined') return;
  useCartStore.setState({
    lines: [], orderDiscount: null, additionalPwdScEntries: [], branchId: null, shiftId: null,
  });
  useParkedSalesStore.setState({ sales: [] });
  useShiftStore.getState().clearShift();
  useTillLockStore.getState().unlock();
  try { window.localStorage.removeItem(CUSTOMER_DISPLAY_STATE_KEY); } catch { /* blocked storage holds nothing */ }
}

/**
 * The offline copy of the open shift (Dexie). Loaded on demand so the
 * offline database stays out of screens that never use it.
 */
export async function forgetCachedShift(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { db } = await import('@/lib/pos/db');
    await db.activeShift.clear();
  } catch { /* IndexedDB unavailable: nothing was cached */ }
}

/**
 * Drop a screen pairing that is known to be another shop's. A pairing of this
 * shop stays: it is the shop's own customer display or kitchen screen.
 */
export function dropOtherShopsPairing(tenantId: string | null | undefined): void {
  const pairing = readDeviceToken();
  if (pairing && isOtherShopsPairing(pairing.tenantId, tenantId)) clearDeviceToken();
}

/**
 * A sign-in (password, PIN, or a cashier switch at the locked till). If the
 * till state on this device is not this shop's -- another shop's, or nobody
 * knows whose -- it goes, with the screen cache. The same shop carries on, so
 * a relief cashier keeps the open drawer and the cart.
 *
 * `previousTenantId` is the user signed in on this tab until now: it vouches
 * for the till when the device marker is missing (a cashier switch in a tab
 * opened before this marker existed).
 */
export function adoptShopOnSignIn(
  tenantId: string | null | undefined,
  previousTenantId: string | null | undefined,
): void {
  if (typeof window === 'undefined') return;
  const owner = readDeviceShop() ?? previousTenantId ?? null;
  if (isShopChange(owner, tenantId)) {
    forgetTill();
    clearScreenCache();
  }
  dropOtherShopsPairing(tenantId);
  writeDeviceShop(tenantId);
}

/**
 * A page load with a sign-in already in storage. A marker naming another shop
 * means the till left here is not this session's: forget it. No marker yet
 * (a device signed in before this marker existed): the till is this
 * session's, as it was before, so only record it.
 */
export function adoptShopOnLoad(tenantId: string | null | undefined): void {
  if (typeof window === 'undefined' || !tenantId) return;
  const owner = readDeviceShop();
  if (owner && owner !== tenantId) forgetTill();
  dropOtherShopsPairing(tenantId);
  if (owner !== tenantId) writeDeviceShop(tenantId);
}
