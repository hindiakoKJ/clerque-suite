'use client';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { readDeviceToken } from '@/lib/pos/device-token';
import {
  brandLogoSrc,
  fetchBranding,
  initialsFrom,
  refreshLastBusiness,
  type TenantBranding,
} from '@/lib/branding';

/** Prefix for every branding query. Invalidate it after a logo upload or removal. */
export const BRANDING_QUERY_KEY = ['tenant-branding'] as const;

export interface UseBrandingResult {
  branding:    TenantBranding | null;
  /** Ready-to-use <img> src, or '' when there is no logo. */
  logoSrc:     string;
  /** Business name, else tenant name, else the name in the session. */
  displayName: string | null;
  /** Placeholder letters; '' when no name is known at all. */
  initials:    string;
  isLoading:   boolean;
  isError:     boolean;
}

/**
 * The business's name and logo, from GET /tenant/branding.
 *
 * Works for every signed-in role and for paired screens (the API client sends
 * the device token). Cached for five minutes, so a logo change reaches other
 * screens without anyone signing out. If the call fails, callers get the name
 * from the session and no logo, and should fall back to the app icon.
 */
export function useBranding({ enabled = true }: { enabled?: boolean } = {}): UseBrandingResult {
  const userTenantId     = useAuthStore((s) => s.user?.tenantId ?? null);
  const sessionBizName   = useAuthStore((s) => s.user?.businessName ?? null);
  // Key by business so switching accounts on one browser never shows the
  // previous business's logo. Paired screens have no user; use the pairing.
  const scope = userTenantId ?? readDeviceToken()?.tenantId ?? 'none';

  const query = useQuery<TenantBranding | null>({
    queryKey:  [...BRANDING_QUERY_KEY, scope],
    queryFn:   fetchBranding,
    enabled,
    staleTime: 5 * 60_000,
    retry:     1,
  });

  const branding = query.data ?? null;

  useEffect(() => {
    if (branding && userTenantId) refreshLastBusiness(userTenantId, branding);
  }, [branding, userTenantId]);

  const displayName = branding?.businessName || branding?.name || sessionBizName || null;

  return {
    branding,
    logoSrc:     brandLogoSrc(branding?.logoUrl),
    displayName,
    initials:    branding?.initials || initialsFrom(displayName),
    isLoading:   enabled && query.isLoading,
    isError:     query.isError,
  };
}
