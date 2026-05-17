/**
 * Clerque Counter — BranchContext
 *
 * Exposes `{ activeBranch, setActiveBranch, branches }` for the active
 * tenant. The selection is persisted to AsyncStorage keyed by tenant id so
 * a multi-tenant device remembers each tenant's last branch.
 *
 * Tenants with a single branch auto-select it; multi-branch tenants surface
 * a picker in the TopBar.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useBranches, type ApiBranch } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';

interface BranchContextValue {
  branches: ApiBranch[];
  activeBranch: ApiBranch | null;
  setActiveBranch: (b: ApiBranch) => void;
  /** True once we've finished hydrating from AsyncStorage. */
  ready: boolean;
}

const BranchCtx = createContext<BranchContextValue | null>(null);

function asKey(tenantId: string | undefined): string {
  return `clerque.activeBranch.${tenantId ?? 'anon'}`;
}

export function BranchProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { tenant } = useAuth();
  const branchesQuery = useBranches();
  const branches = useMemo<ApiBranch[]>(
    () => (branchesQuery.data ?? []).filter((b) => b.isActive !== false),
    [branchesQuery.data],
  );

  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Hydrate persisted selection per-tenant.
  useEffect(() => {
    let alive = true;
    setReady(false);
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(asKey(tenant?.id));
        if (!alive) return;
        setActiveBranchId(raw ?? null);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, [tenant?.id]);

  // Auto-select single branch / fall back to first when stale id no longer exists.
  useEffect(() => {
    if (!ready || branches.length === 0) return;
    const stillExists = activeBranchId && branches.some((b) => b.id === activeBranchId);
    if (!stillExists) {
      const next = branches[0];
      setActiveBranchId(next.id);
      void AsyncStorage.setItem(asKey(tenant?.id), next.id);
    }
  }, [ready, branches, activeBranchId, tenant?.id]);

  const setActiveBranch = useCallback(
    (b: ApiBranch) => {
      setActiveBranchId(b.id);
      void AsyncStorage.setItem(asKey(tenant?.id), b.id);
    },
    [tenant?.id],
  );

  const activeBranch =
    branches.find((b) => b.id === activeBranchId) ?? branches[0] ?? null;

  const value = useMemo<BranchContextValue>(
    () => ({ branches, activeBranch, setActiveBranch, ready }),
    [branches, activeBranch, setActiveBranch, ready],
  );

  return <BranchCtx.Provider value={value}>{children}</BranchCtx.Provider>;
}

export function useBranchContext(): BranchContextValue {
  const ctx = useContext(BranchCtx);
  if (!ctx) {
    // Permissive default — call sites can still render before the provider
    // is mounted (e.g. in unit tests). Real consumers always go through the
    // provider in App.tsx.
    return { branches: [], activeBranch: null, setActiveBranch: () => {}, ready: true };
  }
  return ctx;
}

/** Convenience selector — returns the active branch id or `undefined`. */
export function useActiveBranchId(): string | undefined {
  return useBranchContext().activeBranch?.id;
}
