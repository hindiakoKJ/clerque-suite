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

import { api, ApiHttpError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useBranchContext } from '@/api/BranchContext';

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
  const { session, cashier } = useAuth();
  const { activeBranch } = useBranchContext();
  const [active, setActive]   = useState<ActiveShift | null>(null);
  const [ready, setReady]     = useState(false);
  const [loading, setLoading] = useState(false);

  const branchId = activeBranch?.id ?? null;
  const signedIn = !!session && !!cashier?.pinVerifiedAt;

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
      setActive(adapt(row));
    } catch (err) {
      // 404 from the API = "no open shift for this branch + cashier" — that's
      // a valid state, not a failure. Bubble anything else to console for
      // diagnostics; the UI proceeds as if no shift is open (which is safer
      // than letting it silently believe a stale one is open).
      if (err instanceof ApiHttpError && err.status === 404) {
        setActive(null);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[shift] /shifts/active failed:', err);
        setActive(null);
      }
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [branchId, signedIn]);

  // Initial + branch-change fetch.
  useEffect(() => { void fetchActive(); }, [fetchActive]);

  // Background refresh every 60s so the cashier doesn't see stale state if
  // a supervisor closes the shift from another device.
  useEffect(() => {
    if (!signedIn) return;
    const id = setInterval(() => { void fetchActive(); }, 60_000);
    return () => clearInterval(id);
  }, [signedIn, fetchActive]);

  const value = useMemo<ShiftContextValue>(
    () => ({
      active,
      ready,
      loading,
      refresh: fetchActive,
    }),
    [active, ready, loading, fetchActive],
  );

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}
