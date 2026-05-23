/**
 * Clerque Counter — ShiftProvider
 *
 * Global source of truth for "is a shift open for this branch + cashier?".
 * Counter UI uses this in two places:
 *
 *   1. PhoneCartDrawer + tablet Tendering gate the Charge CTA. If no shift
 *      is open, Confirm pops a sheet pointing the cashier at the Shift tab
 *      instead of letting them ring a sale with no opening float (which
 *      would mean Z-read variance reconciliation is impossible).
 *   2. PhoneDashboardScreen renders the "Open shift" card with live
 *      elapsed time + opening float.
 *
 * Source of truth: GET /shifts/active?branchId=X
 *   200 → ActiveShift (open shift exists)
 *   404 → null         (no open shift)
 *
 * Refresh triggers:
 *   • On mount + on branch change (refetch)
 *   • Manually via `refresh()` after ShiftOpenScreen / ZReadScreen finish
 *   • Stale-while-revalidate every 60s — the cashier rarely closes a shift
 *     from another device but the cost is one cheap query per minute.
 *
 * Why a Provider, not local state: ShiftCoordinator's old local-state model
 * meant an app restart let the cashier start ringing again with no opening
 * float. A server-backed provider survives any reload.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, ApiHttpError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useBranchContext } from '@/api/BranchContext';

/**
 * Persisted-shift key. Scoped to `<tenantId>:<branchId>:<cashierId>` so a
 * different cashier signing in on the same device doesn't inherit someone
 * else's open shift. We use AsyncStorage rather than SecureStore — this is
 * cache, not a credential, and SecureStore on Android caps payloads at 2KB.
 */
const STORAGE_PREFIX = '@clerque/counter/shift/v1/';
function storageKey(tenantId: string, branchId: string, cashierId: string): string {
  return `${STORAGE_PREFIX}${tenantId}:${branchId}:${cashierId}`;
}

interface ActiveShift {
  id:                string;
  /** ISO timestamp. */
  openedAt:          string;
  cashierId:         string;
  cashierName:       string;
  openingFloatCents: number;
  branchId:          string;
}

interface ShiftContextValue {
  /** Server-resolved open shift, or null when none. */
  active: ActiveShift | null;
  /** True after the first /shifts/active call resolves (success OR 404). */
  ready: boolean;
  /** True if a network request is in flight (background-refresh aware). */
  loading: boolean;
  /** Force a refetch — called after ShiftOpenScreen / ZReadScreen finish. */
  refresh: () => Promise<void>;
  /**
   * Optimistically set the open shift before the outbox drains to the
   * server. Counter is offline-first — `shift.open` is queued, not awaited —
   * so without this, the Cart's `useIsShiftOpen()` would keep returning false
   * until the outbox round-trip succeeds (could be minutes on bad WiFi).
   * Pass `null` to optimistically close.
   */
  setOptimistic: (shift: ActiveShift | null) => void;
}

const ShiftContext = createContext<ShiftContextValue | null>(null);

export function useShift(): ShiftContextValue {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error('useShift must be used inside <ShiftProvider>');
  return ctx;
}

/** Convenience: just the boolean. */
export function useIsShiftOpen(): boolean {
  return useShift().active !== null;
}

interface ApiActiveShiftRow {
  id?:                string;
  openedAt?:          string;
  cashierId?:         string;
  cashier?:           { id?: string; name?: string };
  cashierName?:       string;
  openingFloat?:      number | string;
  openingFloatCents?: number | string;
  branchId?:          string;
}

function toCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function adapt(row: ApiActiveShiftRow | null): ActiveShift | null {
  if (!row?.id || !row?.openedAt) return null;
  const cashierId   = row.cashierId   ?? row.cashier?.id   ?? '';
  const cashierName = row.cashierName ?? row.cashier?.name ?? 'Cashier';
  // Some endpoints return cents already (openingFloatCents), others peso (openingFloat).
  const openingFloatCents =
    typeof row.openingFloatCents === 'number'
      ? row.openingFloatCents
      : toCents(row.openingFloat);
  return {
    id:        row.id,
    openedAt:  row.openedAt,
    cashierId,
    cashierName,
    openingFloatCents,
    branchId:  row.branchId ?? '',
  };
}

export function ShiftProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { session, cashier, tenant } = useAuth();
  const { activeBranch } = useBranchContext();
  const [active, setActive]   = useState<ActiveShift | null>(null);
  const [ready, setReady]     = useState(false);
  const [loading, setLoading] = useState(false);

  const tenantId  = tenant?.id ?? '';
  const branchId  = activeBranch?.id ?? null;
  const cashierId = cashier?.id ?? '';
  const signedIn  = !!session && !!cashier?.pinVerifiedAt;

  const persistKey = (tenantId && branchId && cashierId)
    ? storageKey(tenantId, branchId, cashierId)
    : null;

  /** Persist or clear the locally cached open shift. */
  const persistShift = useCallback(async (shift: ActiveShift | null): Promise<void> => {
    if (!persistKey) return;
    try {
      if (shift) await AsyncStorage.setItem(persistKey, JSON.stringify(shift));
      else       await AsyncStorage.removeItem(persistKey);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[shift] persist failed:', err);
    }
  }, [persistKey]);

  /** Hydrate cached shift on mount/cashier-change — this is the fix for
   *  "every app restart asks to open the shift again". The outbox may not
   *  have drained to /shifts/active yet, so the server doesn't know about
   *  this shift; the locally persisted record is the authoritative copy
   *  until sync catches up. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!persistKey) return;
      try {
        const raw = await AsyncStorage.getItem(persistKey);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as ActiveShift;
        if (parsed?.id && parsed?.openedAt) {
          setActive(parsed);
          setReady(true);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[shift] hydrate failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [persistKey]);

  const fetchActive = useCallback(async (): Promise<void> => {
    if (!branchId || !signedIn) {
      setActive(null);
      setReady(true);
      return;
    }
    setLoading(true);
    try {
      const row = await api.get<ApiActiveShiftRow | null>(
        `/shifts/active?branchId=${encodeURIComponent(branchId)}`,
      );
      const serverShift = adapt(row);
      if (serverShift) {
        // Server confirms an open shift — overwrite local cache.
        setActive(serverShift);
        void persistShift(serverShift);
      } else {
        // Server says "no shift" BUT the outbox may still be holding an
        // unsynced shift.open. Trust the locally persisted record if it
        // exists; the next outbox drain will reconcile. Only clear when
        // we have no cached shift either (truly clean state).
        const cachedRaw = persistKey ? await AsyncStorage.getItem(persistKey) : null;
        if (!cachedRaw) {
          setActive(null);
        }
      }
    } catch (err) {
      // 404 from the API = "no open shift for this branch + cashier" — see
      // the same outbox-may-be-stale reasoning above; preserve local cache.
      if (err instanceof ApiHttpError && err.status === 404) {
        const cachedRaw = persistKey ? await AsyncStorage.getItem(persistKey) : null;
        if (!cachedRaw) setActive(null);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[shift] /shifts/active failed:', err);
        // Network blip — keep current state (likely the persisted shift).
      }
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [branchId, signedIn, persistKey, persistShift]);

  // Initial + branch-change fetch.
  useEffect(() => { void fetchActive(); }, [fetchActive]);

  // Background refresh every 60s so the cashier doesn't see stale state if
  // a supervisor closes the shift from another device.
  useEffect(() => {
    if (!signedIn) return;
    const id = setInterval(() => { void fetchActive(); }, 60_000);
    return () => clearInterval(id);
  }, [signedIn, fetchActive]);

  const setOptimistic = useCallback((shift: ActiveShift | null) => {
    setActive(shift);
    setReady(true);
    void persistShift(shift);
  }, [persistShift]);

  const value = useMemo<ShiftContextValue>(
    () => ({
      active,
      ready,
      loading,
      refresh: fetchActive,
      setOptimistic,
    }),
    [active, ready, loading, fetchActive, setOptimistic],
  );

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}
