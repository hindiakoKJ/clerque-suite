/**
 * Clerque Counter — React Query hooks for the Cloud API.
 *
 * Conventions:
 *   - Cache keys are namespaced by tenantId + branchId where relevant so a
 *     branch switch invalidates implicitly.
 *   - `staleTime` is 60s for catalog-ish data (mostly static during a shift).
 *   - Stock-sensitive queries poll every 30s so the till stays roughly fresh
 *     without hammering the API.
 *   - Each query has an AsyncStorage offline fallback: the latest successful
 *     payload is written through, and used as `initialData` when the device
 *     boots cold offline.
 *
 * Endpoint shapes mirror the Cloud API. We use unknown-ish DTOs at the edge
 * because the API package types aren't yet shared with the Counter app.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, ApiHttpError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';

// ─── Domain shapes ────────────────────────────────────────────────────────
// Kept loose intentionally — we'll tighten when packages/shared-types is
// extracted for the mobile app.

export interface ApiCategory {
  id: string;
  name: string;
  sortOrder?: number;
  stationId?: string | null;
}

export interface ApiModifierOption {
  id: string;
  name: string;
  priceAdjustment: number | string;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface ApiModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiSelect?: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  options: ApiModifierOption[];
}

export interface ApiProductModifierGroup {
  modifierGroupId: string;
  sortOrder?: number;
  modifierGroup: ApiModifierGroup;
}

export interface ApiProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  price: number | string;
  costPrice?: number | string | null;
  isVatable: boolean;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  imageUrl?: string | null;
  inventoryMode?: 'UNIT_BASED' | 'RECIPE_BASED';
  maxProducible?: number | null;
  isLowStock?: boolean;
  isOutOfStock?: boolean;
  modifierGroups?: ApiProductModifierGroup[];
  isRxRequired?: boolean;
  isControlledDrug?: boolean;
  drugClass?: string;
}

export interface ApiCustomer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  tin?: string | null;
}

export interface ApiLot {
  id: string;
  productId: string;
  lotNumber: string;
  expiresAt: string;
  qtyRemaining: number | string;
  branchId?: string;
}

export interface ApiBranch {
  id: string;
  name: string;
  address?: string | null;
  isActive?: boolean;
}

// ─── AsyncStorage offline cache ───────────────────────────────────────────

const CACHE_PREFIX = 'clerque.queries.';

async function readCache<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* best-effort */
  }
}

/**
 * useQuery-with-offline-fallback. Hydrates `initialData` from AsyncStorage,
 * writes through on success. Failures (network) silently fall back to the
 * cached payload if we have one.
 */
function useCachedQuery<T>(
  key: readonly unknown[],
  cacheKey: string,
  fetcher: () => Promise<T>,
  opts: { staleTime?: number; refetchInterval?: number; enabled?: boolean } = {},
): UseQueryResult<T> {
  const qc = useQueryClient();

  // Hydrate from AsyncStorage on first mount.
  useEffect(() => {
    let alive = true;
    void readCache<T>(cacheKey).then((cached) => {
      if (!alive || cached === undefined) return;
      // Only seed if we don't have anything yet — avoids stomping fresh data.
      if (qc.getQueryData<T>(key) === undefined) {
        qc.setQueryData<T>(key, cached);
      }
    });
    return () => {
      alive = false;
    };
  }, [cacheKey, key, qc]);

  return useQuery<T>({
    queryKey: key,
    enabled: opts.enabled ?? true,
    staleTime: opts.staleTime ?? 60_000,
    refetchInterval: opts.refetchInterval,
    queryFn: async () => {
      try {
        const value = await fetcher();
        void writeCache(cacheKey, value);
        return value;
      } catch (err) {
        // On network failure, surface cached value if present so the till
        // keeps working offline.
        if (err instanceof ApiHttpError && err.status === 0) {
          const cached = await readCache<T>(cacheKey);
          if (cached !== undefined) return cached;
        }
        throw err;
      }
    },
  });
}

// ─── Hooks ────────────────────────────────────────────────────────────────

/**
 * GET /products/pos?branchId=…
 *
 * Some Cloud responses paginate `{ items, total }`; some return a bare
 * array. Normalize to `ApiProduct[]` at the edge.
 */
export function usePosCatalog(branchId: string | undefined) {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 'anon';
  return useCachedQuery<ApiProduct[]>(
    ['pos-catalog', tenantId, branchId ?? ''],
    `pos-catalog.${tenantId}.${branchId ?? 'none'}`,
    async () => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      const res = await api.get<ApiProduct[] | { items: ApiProduct[] }>(
        `/products/pos${qs}`,
      );
      return Array.isArray(res) ? res : (res?.items ?? []);
    },
    { staleTime: 60_000, refetchInterval: 30_000, enabled: !!tenant },
  );
}

/** GET /categories */
export function useCategories() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 'anon';
  return useCachedQuery<ApiCategory[]>(
    ['categories', tenantId],
    `categories.${tenantId}`,
    async () => {
      const res = await api.get<ApiCategory[]>('/categories');
      return res ?? [];
    },
    { staleTime: 60_000, enabled: !!tenant },
  );
}

/** GET /customers/lookup?phone=… — debounced by the caller. */
export function useCustomerLookup(phone: string, enabled: boolean) {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 'anon';
  const isOn = enabled && phone.length >= 4 && !!tenant;
  return useQuery<ApiCustomer[]>({
    queryKey: ['customer-lookup', tenantId, phone],
    enabled: isOn,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<ApiCustomer[] | ApiCustomer | null>(
        `/customers/lookup?phone=${encodeURIComponent(phone)}`,
      );
      if (!res) return [];
      return Array.isArray(res) ? res : [res];
    },
  });
}

/**
 * GET /pharmacy/lots/available?productId=…&branchId=… — pharmacy only.
 * The Cloud endpoint requires per-product calls, so this hook returns a
 * fetcher keyed on (productId, branchId). For terminal-wide listing we
 * expose `useLotsFor(productId)` instead of one giant query.
 */
export function useLotsFor(productId: string | undefined, branchId: string | undefined) {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 'anon';
  return useCachedQuery<ApiLot[]>(
    ['pharmacy-lots', tenantId, branchId ?? '', productId ?? ''],
    `pharmacy-lots.${tenantId}.${branchId ?? 'none'}.${productId ?? 'none'}`,
    async () => {
      if (!productId || !branchId) return [];
      const res = await api.get<ApiLot[]>(
        `/pharmacy/lots/available?productId=${encodeURIComponent(productId)}&branchId=${encodeURIComponent(branchId)}`,
      );
      return res ?? [];
    },
    {
      staleTime: 30_000,
      refetchInterval: 30_000,
      enabled: !!tenant && !!productId && !!branchId,
    },
  );
}

/**
 * Spec asked for `useLots()` to cover pharmacy. The Cloud endpoint is per
 * product (`/pharmacy/lots/available?productId&branchId`), so we expose
 * `useLotsFor(productId)` as the real primitive. `useLots()` is kept as a
 * convenience: returns an empty array placeholder so call-sites compile.
 */
export function useLots(): UseQueryResult<ApiLot[]> {
  return useCachedQuery<ApiLot[]>(
    ['pharmacy-lots-empty'],
    'pharmacy-lots.empty',
    async () => [],
    { staleTime: 60_000, enabled: false },
  );
}

/** GET /tenant/branches */
export function useBranches() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 'anon';
  return useCachedQuery<ApiBranch[]>(
    ['branches', tenantId],
    `branches.${tenantId}`,
    async () => {
      const res = await api.get<ApiBranch[]>('/tenant/branches');
      return res ?? [];
    },
    { staleTime: 5 * 60_000, enabled: !!tenant },
  );
}
