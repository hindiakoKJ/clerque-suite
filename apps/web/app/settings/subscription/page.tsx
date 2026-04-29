'use client';

/**
 * Settings → Subscription
 *
 * Read-only view of the tenant's current tier, staff usage vs cap, included
 * apps, and a placeholder upgrade CTA. The actual payment/upgrade flow is
 * out of scope for this page (separate stream).
 *
 * BUSINESS_OWNER only — gated server-side at GET /tenant/subscription.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowUpRight, CheckCircle2, Users, Building2,
  Sparkles, AlertTriangle, Crown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { TIERS, nextTier, type TierId } from '@repo/shared-types';

interface SubscriptionResponse {
  tier:              TierId;
  expiresAt:         string | null;
  staffCount:        number;
  branchCount:       number;
  branchQuota:       number;
  cashierSeatQuota:  number;
  hasTimeMonitoring: boolean;
  hasBirForms:       boolean;
  isDemoTenant:      boolean;
  signupSource:      string;
  aiEnabled:         boolean;
  /**
   * Reason the AI flag is on or off:
   *   - 'tier'         → AI on because the tier includes it
   *   - 'override_on'  → AI on because Anthropic / SUPER_ADMIN flipped the override
   *   - 'override_off' → AI off because override is explicitly false
   *   - 'tier_locked'  → AI off because the tier doesn't include it (upgrade path)
   */
  aiReason:          'tier' | 'override_on' | 'override_off' | 'tier_locked';
}

export default function SubscriptionPage() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data, isLoading, error } = useQuery<SubscriptionResponse>({
    queryKey: ['tenant-subscription'],
    queryFn:  async () => (await api.get('/tenant/subscription')).data,
    enabled:  !!user,
  });

  if (!mounted) return null;
  if (user?.role !== 'BUSINESS_OWNER' && user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">Only Business Owners can view subscription details.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div className="h-12 w-48 rounded-lg bg-muted animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-red-600">Failed to load subscription details.</p>
      </div>
    );
  }

  const tier      = TIERS[data.tier];
  const upgrade   = nextTier(data.tier);
  const staffCap  = tier.maxStaff;
  const staffUsed = data.staffCount;
  const staffPct  = staffCap === -1 ? 0 : Math.min(100, Math.round((staffUsed / Math.max(1, staffCap)) * 100));
  const isAtCap   = staffCap !== -1 && staffUsed >= staffCap;
  const expiringSoon = data.expiresAt
    ? new Date(data.expiresAt).getTime() - Date.now() < 14 * 24 * 60 * 60 * 1000
    : false;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div>
          <h1 className="text-2xl font-bold text-foreground">Subscription</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your Clerque plan, staff seats, and included apps.
          </p>
        </div>

        {data.isDemoTenant && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-900 dark:text-amber-200">Demo tenant</p>
              <p className="text-amber-800 dark:text-amber-300/90">
                This account is the public shared demo. Subscription changes don't apply here.
              </p>
            </div>
          </div>
        )}

        {/* Current plan card */}
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4 text-amber-500" />
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Current plan
                </p>
              </div>
              <h2 className="text-2xl font-bold text-foreground mt-1">{tier.displayName}</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">{tier.tagline}</p>
            </div>
            {data.expiresAt && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Renews</p>
                <p className={`text-sm font-semibold ${expiringSoon ? 'text-amber-600' : 'text-foreground'}`}>
                  {new Date(data.expiresAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            )}
          </div>

          {/* Staff usage bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="w-3.5 h-3.5" />
                Staff seats
              </span>
              <span className={`font-semibold ${isAtCap ? 'text-red-600' : 'text-foreground'}`}>
                {staffUsed} {staffCap === -1 ? '(unlimited)' : `of ${staffCap}`}
              </span>
            </div>
            {staffCap !== -1 && (
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full transition-all ${isAtCap ? 'bg-red-500' : staffPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${staffPct}%` }}
                />
              </div>
            )}
            {isAtCap && (
              <p className="text-xs text-red-600">
                You've reached the staff cap. Upgrade to add more team members.
              </p>
            )}
          </div>

          {/* Branch usage */}
          <div className="flex items-center justify-between text-sm pt-3 border-t border-border">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="w-3.5 h-3.5" />
              Branches
            </span>
            <span className="font-semibold text-foreground">
              {data.branchCount} of {data.branchQuota === 0 ? '∞' : data.branchQuota}
            </span>
          </div>

          {/* AI feature status */}
          <div className="flex items-center justify-between text-sm pt-3 border-t border-border">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5" />
              AI features
            </span>
            <div className="text-right">
              <span className={`text-xs font-bold uppercase tracking-wide ${data.aiEnabled ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {data.aiEnabled ? 'Enabled' : 'Locked'}
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {data.aiReason === 'tier'         && 'Included with your tier'}
                {data.aiReason === 'override_on'  && 'Manually enabled by support'}
                {data.aiReason === 'override_off' && 'Disabled — contact support'}
                {data.aiReason === 'tier_locked'  && 'Available on Team and Multi plans'}
              </p>
            </div>
          </div>
        </div>

        {/* Included features */}
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Included in your plan</h3>
          <ul className="space-y-2">
            {tier.enabledFeatures.map((flag) => (
              <li key={flag} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span className="text-foreground">{humanizeFeature(flag)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Upgrade CTA */}
        {upgrade && (
          <div className="rounded-xl border border-[var(--accent)]/30 bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] p-5 sm:p-6 space-y-3">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Next step up</p>
                <h3 className="text-lg font-bold text-foreground">{upgrade.displayName}</h3>
                <p className="text-sm text-muted-foreground mt-1">{upgrade.tagline}</p>
              </div>
            </div>

            <div className="text-sm space-y-1 pl-8">
              <p className="font-semibold text-foreground">What's new</p>
              <ul className="space-y-1">
                {upgrade.enabledFeatures
                  .filter((f) => !tier.enabledFeatures.includes(f))
                  .map((f) => (
                    <li key={f} className="flex items-center gap-2 text-foreground">
                      <span className="w-1 h-1 rounded-full bg-[var(--accent)]" />
                      {humanizeFeature(f)}
                    </li>
                  ))}
                <li className="flex items-center gap-2 text-foreground">
                  <span className="w-1 h-1 rounded-full bg-[var(--accent)]" />
                  Up to {upgrade.maxStaff === -1 ? 'unlimited' : upgrade.maxStaff} staff
                </li>
              </ul>
            </div>

            <button
              onClick={() => alert('Upgrade flow coming soon — contact support@hnscorpph.com to upgrade today.')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-white font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
              style={{ background: 'var(--accent)' }}
            >
              Upgrade to {upgrade.displayName}
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function humanizeFeature(flag: string): string {
  const map: Record<string, string> = {
    'pos:basic':            'Point of Sale terminal',
    'pos:offline_sync':     'Offline-first POS with auto-sync',
    'ar:pos_collections':   'Outstanding sales tracker (POS-only)',
    'ledger:read':          'Ledger dashboard, COA, Trial Balance',
    'time_monitoring':      'Time clock and attendance',
    'ledger:full':          'Full Ledger — journal, periods, settlement',
    'multi_branch':         'Multi-branch support',
    'ar:full':              'Accounts Receivable — customers, aging, statements',
    'ap:full':              'Accounts Payable — vendors, WHT 2307, AP aging',
    'payroll:full':         'Payroll — runs, payslips, government contributions',
    'bir:forms':            'BIR forms — 2550Q, 1701Q, 2551Q, EWT, SAWT, EIS',
    'audit:log':            'Centralized audit log viewer',
    'ai:enabled':           'AI features — JE drafter, validator, smart account picker, receipt OCR',
    'custom_personas':      'Custom permission templates per role',
  };
  return map[flag] ?? flag;
}
