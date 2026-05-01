'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { jwtDecode } from 'jwt-decode';
import type { AppProduct } from '@/components/portal/AppLoginPage';
import type { JwtPayload, AuthTokens } from '@repo/shared-types';
import { AppLoginPage } from '@/components/portal/AppLoginPage';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

/* The valid ?app= values that map to a product config */
const VALID_PRODUCTS: AppProduct[] = ['pos', 'ledger', 'payroll', 'console'];

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setTokens, setUser } = useAuthStore();

  // Detect console subdomain → default to Console branding.
  // Falls back to ?app= query param, then to Counter (POS) default.
  const [isConsoleHost, setIsConsoleHost] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsConsoleHost(window.location.hostname.startsWith('console.'));
  }, []);

  const appParam = searchParams.get('app') as AppProduct | null;
  const product: AppProduct = isConsoleHost
    ? 'console'
    : VALID_PRODUCTS.includes(appParam as AppProduct)
      ? (appParam as AppProduct)
      : 'pos'; // default branding when no app selected

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | undefined>();

  async function handleSubmit(values: { tenantId: string; email: string; password: string; rememberMe: boolean; mode: 'password' | 'pin' }) {
    setLoading(true);
    setError(undefined);
    try {
      // PIN login dispatches to /auth/pin-login (returns the same AuthTokens shape).
      // Password login keeps the original /auth/login path.
      const { data } = values.mode === 'pin'
        ? await api.post<AuthTokens>('/auth/pin-login', {
            companyCode: values.tenantId,
            email:       values.email,
            pin:         values.password,
          })
        : await api.post<AuthTokens>('/auth/login', {
            companyCode: values.tenantId,
            email:       values.email,
            password:    values.password,
          });

      setTokens(data.accessToken, data.refreshToken);
      const user = jwtDecode<JwtPayload>(data.accessToken);
      setUser(user);

      // Mirror token to cookie for middleware edge access
      document.cookie = `app-session=${data.accessToken}; path=/; SameSite=Lax`;

      // If app was pre-selected, go directly; otherwise show app selector.
      // On the console subdomain, super-admins land on /admin/dashboard and
      // non-super-admins (shouldn't happen given middleware, but defence in
      // depth) get bounced back to login.
      const next = searchParams.get('next');
      if (isConsoleHost) {
        router.push(user.isSuperAdmin ? '/admin/dashboard' : '/login');
      } else if (next) {
        router.push(next);
      } else if (appParam && appParam !== 'console' && VALID_PRODUCTS.includes(appParam)) {
        router.push(`/${appParam}`);
      } else {
        router.push('/select');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      setError(Array.isArray(msg) ? (msg[0] ?? 'Invalid credentials.') : (msg ?? 'Invalid credentials.'));
      setLoading(false);
    }
  }

  // Sibling product chips beneath the form. On the console subdomain we hide
  // these — Console is its own walled garden, not part of the tenant-app
  // family.
  const siblingUrls: Partial<Record<AppProduct, string>> = isConsoleHost
    ? {}
    : {
        pos:     '/login?app=pos',
        ledger:  '/login?app=ledger',
        payroll: '/login?app=payroll',
      };
  delete siblingUrls[product];

  return (
    <AppLoginPage
      product={product}
      onSubmit={handleSubmit}
      loading={loading}
      error={error}
      siblingUrls={siblingUrls}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
