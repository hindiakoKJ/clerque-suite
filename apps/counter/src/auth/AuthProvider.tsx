/**
 * Clerque Counter — AuthProvider
 * Owns session state for the app:
 *   • JWT / refresh token live in expo-secure-store (encrypted at rest).
 *   • TenantConfig is cached in AsyncStorage so the shell can boot offline.
 *   • On every boot we re-fetch /auth/me to refresh tenant config — failures
 *     are tolerated as long as the cache is < 7 days old (Spotify pattern).
 *   • Cashier PIN verification is a per-shift step; the verified timestamp is
 *     kept in memory only (forces re-PIN on app restart).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, ApiHttpError } from '@/api/client';
import type { AuthSession, TenantConfig } from '@/types';

const SS_JWT_KEY = 'clerque.jwt';
const SS_REFRESH_KEY = 'clerque.refresh';
const AS_TENANT_KEY = 'clerque.tenant';
const AS_TENANT_TS_KEY = 'clerque.tenant.ts';
const AS_USER_KEY = 'clerque.user';
const TENANT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CashierState {
  id: string;
  name: string;
  role: AuthSession['user']['role'];
  pinVerifiedAt: number | null;
}

interface SignInArgs {
  tenantSlug?: string;
  email: string;
  password: string;
}

/** The Cloud API's /auth/login returns just the tokens. The user +
 *  tenant are fetched in a follow-up /auth/me call. */
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

interface MeResponse {
  user: AuthSession['user'];
  tenant: TenantConfig;
}

interface VerifyPinResponse {
  cashier: { id: string; name: string; role: AuthSession['user']['role'] };
}

interface AuthContextValue {
  ready: boolean;
  session: AuthSession | null;
  tenant: TenantConfig | null;
  cashier: CashierState | null;
  signIn: (args: SignInArgs) => Promise<void>;
  signOut: () => Promise<void>;
  /** Clears cashier-level session but keeps tenant signed in. */
  lockToPin: () => void;
  verifyCashierPin: (pin: string) => Promise<void>;
  verifySupervisorPin: (pin: string) => Promise<{ supervisorId: string; role: AuthSession['user']['role'] }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tenant, setTenant] = useState<TenantConfig | null>(null);
  const [cashier, setCashier] = useState<CashierState | null>(null);

  // Boot: load cached session + (best-effort) refresh from /auth/me.
  useEffect(() => {
    (async () => {
      try {
        const [jwt, refreshToken, tenantJson, tenantTsStr, userJson] = await Promise.all([
          SecureStore.getItemAsync(SS_JWT_KEY),
          SecureStore.getItemAsync(SS_REFRESH_KEY),
          AsyncStorage.getItem(AS_TENANT_KEY),
          AsyncStorage.getItem(AS_TENANT_TS_KEY),
          AsyncStorage.getItem(AS_USER_KEY),
        ]);

        if (!jwt || !refreshToken || !tenantJson || !userJson) {
          setReady(true);
          return;
        }

        const tenantTs = tenantTsStr ? Number.parseInt(tenantTsStr, 10) : 0;
        const cachedTenant = JSON.parse(tenantJson) as TenantConfig;
        const cachedUser = JSON.parse(userJson) as AuthSession['user'];

        api.setAuthToken(jwt);
        setSession({ jwt, refreshToken, user: cachedUser });
        setTenant(cachedTenant);

        // Try to refresh tenant config; tolerate offline.
        try {
          const me = await api.get<MeResponse>('/auth/me');
          setSession((s) => (s ? { ...s, user: me.user } : s));
          setTenant(me.tenant);
          await persistTenant(me.tenant, me.user);
        } catch (err) {
          const age = Date.now() - tenantTs;
          if (age > TENANT_TTL_MS) {
            // Cache too stale & we couldn't reach the network → force re-auth.
            await clearAllPersisted();
            api.setAuthToken(null);
            setSession(null);
            setTenant(null);
          }
          // Otherwise silently keep working with cached tenant.
          // (err intentionally unused; logged via console for diagnostics.)
          // eslint-disable-next-line no-console
          console.warn('[auth] /me refresh failed, using cache', err);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = useCallback(async ({ tenantSlug, email, password }: SignInArgs) => {
    // Step 1 — exchange credentials for tokens. The Cloud API's /auth/login
    // returns ONLY { accessToken, refreshToken } (it doesn't ship user +
    // tenant in the same response).
    const tokens = await api.post<LoginResponse>('/auth/login', {
      tenantSlug,
      email,
      password,
    });
    api.setAuthToken(tokens.accessToken);

    // Step 2 — fetch the authenticated user + tenant in one shot.
    const me = await api.get<MeResponse>('/auth/me');

    setSession({ jwt: tokens.accessToken, refreshToken: tokens.refreshToken, user: me.user });
    setTenant(me.tenant);
    setCashier(null);
    await Promise.all([
      SecureStore.setItemAsync(SS_JWT_KEY, tokens.accessToken),
      SecureStore.setItemAsync(SS_REFRESH_KEY, tokens.refreshToken),
      persistTenant(me.tenant, me.user),
    ]);
  }, []);

  const signOut = useCallback(async () => {
    api.setAuthToken(null);
    setSession(null);
    setTenant(null);
    setCashier(null);
    await clearAllPersisted();
  }, []);

  const lockToPin = useCallback(() => {
    setCashier(null);
  }, []);

  const verifyCashierPin = useCallback(
    async (pin: string) => {
      const res = await api.post<VerifyPinResponse>('/auth/cashier-pin', { pin });
      const verifiedAt = Date.now();
      setCashier({
        id: res.cashier.id,
        name: res.cashier.name,
        role: res.cashier.role,
        pinVerifiedAt: verifiedAt,
      });
      setSession((s) =>
        s
          ? {
              ...s,
              cashier: { id: res.cashier.id, name: res.cashier.name, pinVerifiedAt: verifiedAt },
            }
          : s,
      );
    },
    [],
  );

  const verifySupervisorPin = useCallback(async (pin: string) => {
    const res = await api.post<{ supervisorId: string; role: AuthSession['user']['role'] }>(
      '/auth/supervisor-pin',
      { pin },
    );
    return res;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      tenant,
      cashier,
      signIn,
      signOut,
      lockToPin,
      verifyCashierPin,
      verifySupervisorPin,
    }),
    [ready, session, tenant, cashier, signIn, signOut, lockToPin, verifyCashierPin, verifySupervisorPin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function persistTenant(tenant: TenantConfig, user: AuthSession['user']): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(AS_TENANT_KEY, JSON.stringify(tenant)),
    AsyncStorage.setItem(AS_TENANT_TS_KEY, String(Date.now())),
    AsyncStorage.setItem(AS_USER_KEY, JSON.stringify(user)),
  ]);
}

async function clearAllPersisted(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SS_JWT_KEY),
    SecureStore.deleteItemAsync(SS_REFRESH_KEY),
    AsyncStorage.removeItem(AS_TENANT_KEY),
    AsyncStorage.removeItem(AS_TENANT_TS_KEY),
    AsyncStorage.removeItem(AS_USER_KEY),
  ]);
}

// Re-export error type for callers that want to branch on `code`.
export { ApiHttpError };
