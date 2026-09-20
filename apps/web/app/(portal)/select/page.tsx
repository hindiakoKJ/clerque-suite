'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShoppingCart, BookOpen, Users, Lock, ArrowRight, ShieldCheck, ShoppingBasket } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';
import { accessibleApps, type AppCardWithRoute } from '@/lib/apps';
import { api } from '@/lib/api';
import { BusinessSetupWizard, useBusinessSetup } from '@/components/portal/BusinessSetupWizard';
import { useBranding } from '@/hooks/useBranding';

/* ─── App card registry ──────────────────────────────────────────────────── */

/**
 * The registry moved to lib/apps.ts so the in-app switcher can offer exactly
 * what this launcher offers. Two copies of "which apps can this user open"
 * would drift the first time a role changed, and the failure mode is silent:
 * a card here that 403s on arrival, or an app the switcher hides for someone
 * who genuinely has it.
 */

/* ─── Page ───────────────────────────────────────────────────────────────── */

/**
 * How many columns to lay the app tiles out in, by how many there are.
 *
 * The goal is a rectangle, not a row with a remainder. Four apps -- the usual
 * full set of Counter, Ledger, Procure and Sync -- go two-by-two rather than
 * three-and-one. Five is the only count with no clean rectangle; three columns
 * leaves the smallest gap.
 *
 * Whole class strings, because Tailwind generates classes by scanning source
 * text: a composed name built at runtime would never be emitted.
 */
const GRID_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-2',
  5: 'lg:grid-cols-3',
  6: 'lg:grid-cols-3',
};

export default function SelectPage() {
  const router = useRouter();
  const { user, hasAccess, accessToken } = useAuthStore();
  const [wizardDismissed, setWizardDismissed] = useState(false);

  const isOwner = user?.role === 'BUSINESS_OWNER';
  const { data: tenantProfile } = useBusinessSetup(isOwner);

  const showWizard =
    isOwner &&
    !wizardDismissed &&
    tenantProfile?.businessType === 'RETAIL';

  // ── Compute accessible apps with role-aware routes (BEFORE any early
  // return — React requires hooks in stable call-order across renders).
  const accessible: AppCardWithRoute[] = accessibleApps(user, hasAccess);
  // Treat the SUPER_ADMIN role as super-admin even if the isSuperAdmin flag
  // is missing — same rule accessibleApps applies internally.
  const isSuper = !!user && (user.isSuperAdmin === true || user.role === 'SUPER_ADMIN');

  const onlyApp = accessible.length === 1 ? accessible[0] : null;

  // The business's logo above the welcome. Not for super admins: their
  // session's tenant is the platform's, not a customer's.
  const brand = useBranding({ enabled: !!user?.tenantId && !isSuper });
  const [brandLogoFailed, setBrandLogoFailed] = useState(false);
  useEffect(() => { setBrandLogoFailed(false); }, [brand.logoSrc]);
  const showBrand = !!user?.tenantId && !isSuper;
  const showBrandLogo = showBrand && !!brand.logoSrc && !brandLogoFailed;

  // Redirect to login if unauthenticated, or straight to the only app the
  // user has access to. Both effects run unconditionally each render.
  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  // If we're on the console subdomain, super-admins go straight to /admin.
  // (Middleware also enforces this, but routing here avoids a flash.)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hostname.startsWith('console.') && isSuper) {
      router.replace('/admin');
    }
  }, [isSuper, router]);

  useEffect(() => {
    if (onlyApp) router.replace(onlyApp.resolvedRoute);
  }, [onlyApp, router]);

  // Sprint 19 — toast when redirected from a restricted app (e.g. middleware
  // hard-blocked POS for a non-till role).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reason = new URLSearchParams(window.location.search).get('reason');
    if (reason === 'pos-restricted') {
      toast.error('POS is restricted to Owner / Manager / Cashier. Use Ledger or Sync if those apply to your role.');
    } else if (reason === 'ledger-restricted') {
      toast.error('Ledger is restricted to accounting roles. Use POS or Sync if those apply to your role.');
      // Clean the URL
      const url = new URL(window.location.href);
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.pathname);
    }
  }, []);

  if (!user) return null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white dark:bg-gray-950 px-4">
      {showWizard && (
        <BusinessSetupWizard onDismiss={() => setWizardDismissed(true)} />
      )}
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          {/* Business mark: logo up to 200x64, else initials. The 64px row is
              held while branding loads so the heading doesn't jump. */}
          {showBrand && (brand.isLoading || showBrandLogo || brand.initials) && (
            <div className="flex flex-col items-center gap-1">
              {brand.isLoading ? (
                <div className="h-16" aria-hidden />
              ) : showBrandLogo ? (
                /* On white, like every other logo spot: a transparent logo
                   with dark lettering vanishes on the dark theme. */
                <div className="h-16 max-w-[200px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white px-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={brand.logoSrc}
                    alt={brand.displayName ?? 'Business logo'}
                    className="max-h-12 max-w-[174px] object-contain"
                    onError={() => setBrandLogoFailed(true)}
                  />
                </div>
              ) : (
                <div
                  role="img"
                  aria-label={brand.displayName ?? brand.initials}
                  className="h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold"
                  style={{ background: 'color-mix(in oklab, hsl(217 91% 55%) 12%, transparent)', color: 'hsl(217 91% 50%)' }}
                >
                  {brand.initials}
                </div>
              )}
              {!brand.isLoading && (brand.displayName || (isOwner && !brand.logoSrc && !brand.isError)) && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {brand.displayName}
                  {isOwner && !brand.logoSrc && !brand.isError && (
                    <>
                      {brand.displayName && <span aria-hidden> · </span>}
                      <Link href="/settings" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                        Add your logo
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
          )}
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Welcome, {user.name}</h1>
          <p className="text-slate-500 dark:text-slate-400">Choose a Clerque app to open.</p>
        </div>

        {/*
          App grid — inaccessible apps are hidden, not grayed-out.

          The column count follows how many apps this account actually has,
          rather than being pinned at three. Pinned at three, the common case
          of FOUR apps rendered as a row of three with one stranded underneath:
          a ragged L instead of a block. Four in two columns is a square, which
          is what the eye expects when there is no ordering between the tiles.
        */}
        <div className={`grid gap-4 sm:grid-cols-2 ${GRID_COLS[accessible.length] ?? 'lg:grid-cols-3'}`}>
          {accessible.map((app) => {
            const { Icon } = app;
            return (
              <button
                key={app.id}
                onClick={() => router.push(app.resolvedRoute)}
                className="group relative flex h-full flex-col items-start gap-4 rounded-2xl border p-6 text-left transition-all border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
              >
                <div
                  className="rounded-xl p-3"
                  style={{ background: `color-mix(in oklab, ${app.accent} 12%, transparent)` }}
                >
                  <Icon className="w-6 h-6" style={{ color: app.accent }} />
                </div>
                <div className="space-y-1 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">{app.name}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{app.description}</p>
                </div>
                <ArrowRight
                  className="w-4 h-4 text-slate-400 transition-transform group-hover:translate-x-1"
                  style={{ color: app.accent }}
                />
              </button>
            );
          })}
          {accessible.length === 0 && (
            <div className="col-span-full text-center py-8 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              <Lock className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">
                Your account has no apps assigned. Contact your business owner.
              </p>
            </div>
          )}
        </div>

        {/* Sign out */}
        <div className="text-center">
          <button
            onClick={async () => {
              const refresh = localStorage.getItem('app-auth');
              if (refresh) { try { await api.post('/auth/logout', { refreshToken: refresh }); } catch {} }
              useAuthStore.getState().clear();
              document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
              router.push('/login');
            }}
            className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
