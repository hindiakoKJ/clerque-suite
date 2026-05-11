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
  // SECURITY D3-02 — two-factor challenge state. When the API returns
  // { requires2fa: true, challengeToken }, we render a 6-digit input
  // overlay instead of completing the login. The challengeToken is a
  // short-lived JWT (kind === '2fa-challenge') that the second POST
  // exchanges for the real access/refresh pair.
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  async function completeLogin(data: AuthTokens) {
    setTokens(data.accessToken, data.refreshToken);
    const user = jwtDecode<JwtPayload>(data.accessToken);
    setUser(user);
    const isProd = window.location.protocol === 'https:';
    document.cookie =
      `app-session=${data.accessToken}; path=/; SameSite=Lax` +
      (isProd ? '; Secure' : '');
    const next = searchParams.get('next');
    if (isConsoleHost) {
      const isSuper = user.isSuperAdmin === true || user.role === 'SUPER_ADMIN';
      router.push(isSuper ? '/admin/dashboard' : '/login');
    } else if (next) {
      router.push(next);
    } else if (appParam && appParam !== 'console' && VALID_PRODUCTS.includes(appParam)) {
      router.push(`/${appParam}`);
    } else {
      router.push('/select');
    }
  }

  async function submit2faChallenge() {
    if (!twoFactorChallenge) return;
    if (!/^\d{6}$/.test(twoFactorCode) && twoFactorCode.length !== 10) {
      setError('Enter the 6-digit code from your authenticator app (or a 10-character backup code).');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const { data } = await api.post<AuthTokens>('/auth/login/2fa', {
        challengeToken: twoFactorChallenge,
        code:           twoFactorCode.trim(),
      });
      await completeLogin(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Invalid 2FA code. Try again or use a backup code.');
      setLoading(false);
    }
  }

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
        : await api.post<AuthTokens & { requires2fa?: boolean; challengeToken?: string }>('/auth/login', {
            companyCode: values.tenantId,
            email:       values.email,
            password:    values.password,
          });

      // D3-02 — if the API requires 2FA, pivot to the challenge prompt
      // instead of completing login.
      if ((data as any).requires2fa && (data as any).challengeToken) {
        setTwoFactorChallenge((data as any).challengeToken);
        setLoading(false);
        return;
      }

      setTokens(data.accessToken, data.refreshToken);
      const user = jwtDecode<JwtPayload>(data.accessToken);
      setUser(user);

      // Sprint 17/18 — client-side cookie write is REQUIRED in cross-origin
      // setups (web on :3000, API on :3001). The API also sets an HttpOnly
      // app-session cookie via Set-Cookie, but that's scoped to the API
      // origin and the Next.js middleware on the web origin can't read it.
      // Until we add a same-origin /api proxy, we keep this write so middleware
      // sees the token. Defence-in-depth: the API still HttpOnly's its own copy.
      const isProd = window.location.protocol === 'https:';
      document.cookie =
        `app-session=${data.accessToken}; path=/; SameSite=Lax` +
        (isProd ? '; Secure' : '');

      // If app was pre-selected, go directly; otherwise show app selector.
      // On the console subdomain, super-admins land on /admin/dashboard and
      // non-super-admins (shouldn't happen given middleware, but defence in
      // depth) get bounced back to login.
      const next = searchParams.get('next');
      if (isConsoleHost) {
        const isSuper = user.isSuperAdmin === true || user.role === 'SUPER_ADMIN';
        router.push(isSuper ? '/admin/dashboard' : '/login');
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

  // D3-02 — 2FA challenge overlay. Rendered when the password login response
  // includes { requires2fa: true, challengeToken }. Kept on this page so we
  // don't lose form state, and so the back-stack doesn't include a transient
  // /login/2fa route the user can refresh into a broken state.
  if (twoFactorChallenge) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 space-y-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Two-factor authentication</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter the 6-digit code from your authenticator app, or a 10-character backup code.
            </p>
          </div>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={twoFactorCode}
            onChange={(e) => setTwoFactorCode(e.target.value.replace(/\s/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit2faChallenge(); }}
            placeholder="123456"
            maxLength={10}
            className="w-full px-4 py-3 text-center text-2xl tracking-widest font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <button
            onClick={submit2faChallenge}
            disabled={loading || twoFactorCode.length < 6}
            className="w-full py-3 rounded-lg text-white font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
          <button
            onClick={() => { setTwoFactorChallenge(null); setTwoFactorCode(''); setError(undefined); }}
            className="w-full text-sm text-muted-foreground hover:text-foreground py-2"
          >
            Cancel · back to login
          </button>
        </div>
      </div>
    );
  }

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
