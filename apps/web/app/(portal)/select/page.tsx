'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, BookOpen, Users, Lock, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import type { AccessLevel } from '@repo/shared-types';
import { BusinessSetupWizard, useBusinessSetup } from '@/components/portal/BusinessSetupWizard';

/* ─── App card registry ──────────────────────────────────────────────────── */

interface AppCard {
  id: 'pos' | 'ledger' | 'payroll';
  name: string;
  description: string;
  Icon: React.ElementType;
  accent: string;
  accentDark: string;
  route: string;
  minLevel: AccessLevel;
}

const APPS: AppCard[] = [
  {
    id: 'pos',
    name: 'Counter',
    description: 'Point-of-sale for retail, F&B, and services — keep the line moving.',
    Icon: ShoppingCart,
    accent: 'hsl(217 91% 55%)',
    accentDark: 'hsl(217 91% 60%)',
    route: '/pos',
    minLevel: 'OPERATOR',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    description: 'Double-entry accounting with invoices, journals, and reports.',
    Icon: BookOpen,
    accent: 'hsl(173 70% 40%)',
    accentDark: 'hsl(173 70% 45%)',
    route: '/ledger',
    minLevel: 'READ_ONLY',
  },
  {
    id: 'payroll',
    name: 'Sync',
    description: 'Staff time tracking, attendance, and payroll management.',
    Icon: Users,
    accent: 'hsl(262 70% 58%)',
    accentDark: 'hsl(262 70% 65%)',
    route: '/payroll/clock',
    minLevel: 'CLOCK_ONLY',
  },
];

/**
 * Where to land each role inside an app. Important for Sync because
 * CLOCK_ONLY (CASHIER, GENERAL_EMPLOYEE etc.) lands on /payroll/clock,
 * while OPERATOR / FULL (PAYROLL_MASTER, BUSINESS_OWNER) lands on the HR
 * dashboard.
 */
function routeForApp(
  app: AppCard,
  level: AccessLevel | 'NONE' | undefined,
): string {
  // Console (SUPER_ADMIN) → always /admin regardless of `id` shim
  if (app.name === 'Console') return '/admin';
  if (app.id === 'payroll') {
    if (level === 'CLOCK_ONLY' || level === 'READ_ONLY') return '/payroll/clock';
    return '/payroll/dashboard';
  }
  return app.route;
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

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
  type AppCardWithRoute = AppCard & { resolvedRoute: string };

  // SUPER_ADMIN gets a synthetic "Console" card on top of the real apps.
  // Treat SUPER_ADMIN role as super-admin even if isSuperAdmin flag missing
  const isSuper = !!user && (user.isSuperAdmin === true || user.role === 'SUPER_ADMIN');
  const baseApps: AppCard[] = isSuper
    ? [
        {
          id:          'pos' as const, // unused; routing handled by resolvedRoute
          name:        'Console',
          description: 'Platform-wide admin: tenants, metrics, failed events, AI overrides.',
          Icon:        ShieldCheck,
          accent:      'hsl(330 70% 45%)',
          accentDark:  'hsl(330 70% 55%)',
          route:       '/admin',
          minLevel:    'NONE' as AccessLevel,
        },
        ...APPS,
      ]
    : APPS;

  const accessible: AppCardWithRoute[] = user
    ? baseApps
        .filter((app) =>
          // Console card always visible to super admins; others require app access
          app.name === 'Console'
            ? isSuper
            : hasAccess(app.id.toUpperCase() as 'POS' | 'LEDGER' | 'PAYROLL', app.minLevel)
        )
        .map((app) => {
          const code = app.id.toUpperCase() as 'POS' | 'LEDGER' | 'PAYROLL';
          const level = user.appAccess.find((a) => a.app === code)?.level;
          return { ...app, resolvedRoute: routeForApp(app, level) };
        })
    : [];
  const onlyApp = accessible.length === 1 ? accessible[0] : null;

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

  if (!user) return null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white dark:bg-gray-950 px-4">
      {showWizard && (
        <BusinessSetupWizard onDismiss={() => setWizardDismissed(true)} />
      )}
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Welcome, {user.name}</h1>
          <p className="text-slate-500 dark:text-slate-400">Choose a Clerque app to open.</p>
        </div>

        {/* App grid — inaccessible apps are hidden, not grayed-out */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accessible.map((app) => {
            const { Icon } = app;
            return (
              <button
                key={app.id}
                onClick={() => router.push(app.resolvedRoute)}
                className="group relative flex flex-col items-start gap-4 rounded-2xl border p-6 text-left transition-all border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
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
            <div className="sm:col-span-2 lg:col-span-3 text-center py-8 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
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
            onClick={() => {
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
