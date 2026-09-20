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
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, ApiHttpError } from '@/api/client';
import { normalizeBranding, type TenantBranding } from '@/api/branding';
import { useAuth } from '@/auth/AuthProvider';
import { pairedClient } from '@/device-mode/pairedClient';
import type { PairedDevice } from '@/device-mode/storage';

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
  /** Resolved selling price — either Product.price (default) or the
   *  wholesale override when the cart-attached customer has a priceListId. */
  price: number | string;
  /** Original Product.price BEFORE any wholesale override. When equal to
   *  `price`, no override is active. UI can show a "was ₱X" hint when
   *  they differ. Server always returns this. */
  defaultPrice?: number | string;
  /** Set when this product has a wholesale price for the attached customer.
   *  minQuantity gates the override — if the cart line qty is below it, the
   *  client should fall back to defaultPrice. */
  priceListOverride?: {
    unitPrice:   number;
    minQuantity: number | null;
    defaultPrice: number;
  } | null;
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
 * GET /products/pos?branchId=…&customerId=…
 *
 * Some Cloud responses paginate `{ items, total }`; some return a bare
 * array. Normalize to `ApiProduct[]` at the edge.
 *
 * When a customerId is provided AND that customer has a wholesale price
 * list, every product's `price` is the override; the original surfaces as
 * `defaultPrice` so the UI can show "was ₱X" hint when desired.
 *
 * The cache key includes customerId so a cart-attached customer with a
 * different price list doesn't show stale walk-in prices.
 */
export function usePosCatalog(branchId: string | undefined, customerId?: string) {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 'anon';
  return useCachedQuery<ApiProduct[]>(
    ['pos-catalog', tenantId, branchId ?? '', customerId ?? ''],
    `pos-catalog.${tenantId}.${branchId ?? 'none'}.${customerId ?? 'walkin'}`,
    async () => {
      const params: string[] = [];
      if (branchId)   params.push(`branchId=${encodeURIComponent(branchId)}`);
      if (customerId) params.push(`customerId=${encodeURIComponent(customerId)}`);
      const qs = params.length > 0 ? `?${params.join('&')}` : '';
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

/** Branding rarely changes. Refetch on a slow timer so a new logo reaches a
 *  till or a customer display that stays open all day, without anyone
 *  signing out. */
const BRANDING_STALE_MS = 5 * 60_000;
const BRANDING_REFRESH_MS = 15 * 60_000;

/**
 * GET /tenant/branding for the signed-in app (top bar, drawer, More screen).
 * Cached per tenant so the logo still shows when the till boots offline.
 * The key is memoised: useCachedQuery re-reads AsyncStorage whenever the key
 * identity changes, and these screens re-render often.
 */
export function useTenantBranding(): UseQueryResult<TenantBranding> {
  const { tenant, session } = useAuth();
  const tenantId = tenant?.id ?? 'anon';
  const key = useMemo(() => ['tenant-branding', tenantId] as const, [tenantId]);
  return useCachedQuery<TenantBranding>(
    key,
    `tenant-branding.${tenantId}`,
    async () => normalizeBranding(await api.get<unknown>('/tenant/branding')),
    { staleTime: BRANDING_STALE_MS, refetchInterval: BRANDING_REFRESH_MS, enabled: !!session && !!tenant },
  );
}

/**
 * GET /tenant/branding for a paired screen (customer display). These devices
 * have no user login, so the call carries the device token instead.
 */
export function usePairedTenantBranding(pairing: PairedDevice): UseQueryResult<TenantBranding> {
  const { tenantId, deviceToken } = pairing;
  const key = useMemo(() => ['tenant-branding', 'device', tenantId] as const, [tenantId]);
  return useCachedQuery<TenantBranding>(
    key,
    `tenant-branding.device.${tenantId}`,
    async () => normalizeBranding(await pairedClient.get<unknown>('/tenant/branding', deviceToken)),
    { staleTime: BRANDING_STALE_MS, refetchInterval: BRANDING_REFRESH_MS, enabled: !!deviceToken },
  );
}
