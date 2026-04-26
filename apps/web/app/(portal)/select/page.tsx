'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, BookOpen, Users, Lock, ArrowRight } from 'lucide-react';
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

  // If not authenticated, redirect to login
  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  if (!user) return null;

  const accessible = APPS.filter((app) => hasAccess(app.id.toUpperCase() as any, app.minLevel));

  // If only one app is accessible, redirect straight there
  useEffect(() => {
    if (accessible.length === 1) {
      router.replace(accessible[0].route);
    }
  }, [accessible.length]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/* App grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((app) => {
            const canAccess = hasAccess(app.id.toUpperCase() as any, app.minLevel);
            const { Icon } = app;

            return (
              <button
                key={app.id}
                onClick={() => canAccess && router.push(app.route)}
                disabled={!canAccess}
                className={`group relative flex flex-col items-start gap-4 rounded-2xl border p-6 text-left transition-all
                  ${canAccess
                    ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer'
                    : 'border-slate-100 dark:border-slate-900 bg-slate-50 dark:bg-slate-950 opacity-50 cursor-not-allowed'
                  }`}
              >
                {/* Icon */}
                <div
                  className="rounded-xl p-3"
                  style={{ background: `color-mix(in oklab, ${app.accent} 12%, transparent)` }}
                >
                  <Icon className="w-6 h-6" style={{ color: app.accent }} />
                </div>

                {/* Text */}
                <div className="space-y-1 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">{app.name}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{app.description}</p>
                </div>

                {/* Arrow or Lock */}
                {canAccess ? (
                  <ArrowRight
                    className="w-4 h-4 text-slate-400 transition-transform group-hover:translate-x-1"
                    style={{ color: app.accent }}
                  />
                ) : (
                  <Lock className="w-4 h-4 text-slate-300 dark:text-slate-700" />
                )}
              </button>
            );
          })}
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
