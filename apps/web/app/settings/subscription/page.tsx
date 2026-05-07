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
  Sparkles, AlertTriangle, Crown, Wrench, Copy, Check,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { TIERS, nextTier, type TierId, PLAN_CAPS, planLabel, effectiveSeatCeiling, type PlanCode } from '@repo/shared-types';
import { toast } from 'sonner';
import { ShoppingCart, BookOpen, Users as UsersIcon, ArrowRight } from 'lucide-react';

type AiAddonType = 'STARTER_50' | 'STANDARD_200' | 'PRO_500';

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
  pricing: {
    setupFeePhp:    number;
    monthlyPhp:     number;
    annualPhp:      number;
    setupFeePaidAt: string | null;
  };
  ai: {
    monthlyQuota:    number;
    usedThisMonth:   number;
    remaining:       number;
    source:          'tier_locked' | 'tier_included' | 'addon_only' | 'tier+addon' | 'override' | 'kill_switch';
    enabled:         boolean;
    addonType:       AiAddonType | null;
    addonExpiresAt:  string | null;
    addonPackage:    {
      type:            AiAddonType;
      displayName:     string;
      promptsIncluded: number;
      monthlyPhp:      number;
      pitch:           string;
    } | null;
  };
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

        {/* ── Modular Plan card (primary, NEW) ──────────────────────────────── */}
        <ModulePlanCard
          planCode={(user?.planCode ?? 'SUITE_T2') as PlanCode}
          modulePos={user?.modulePos !== false}
          moduleLedger={user?.moduleLedger !== false}
          modulePayroll={user?.modulePayroll !== false}
          staffCount={data.staffCount}
        />

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
              {/* Pricing — what they pay */}
              <div className="flex items-baseline gap-3 mt-3 pt-3 border-t border-border">
                <p className="text-2xl font-bold text-foreground">
                  ₱{data.pricing.monthlyPhp.toLocaleString('en-PH')}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  or ₱{data.pricing.annualPhp.toLocaleString('en-PH')}/yr (2 months free)
                </p>
              </div>
              {!data.pricing.setupFeePaidAt && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                  ⓘ One-time setup fee (₱{data.pricing.setupFeePhp.toLocaleString('en-PH')}) not yet recorded.
                </p>
              )}
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

          {/* AI quota usage */}
          <div className="space-y-1.5 pt-3 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Sparkles className="w-3.5 h-3.5" />
                AI prompts this month
              </span>
              <span className={`font-semibold ${
                !data.ai.enabled ? 'text-muted-foreground'
                : data.ai.remaining === 0 ? 'text-red-600'
                : data.ai.remaining < data.ai.monthlyQuota * 0.2 ? 'text-amber-600'
                : 'text-foreground'
              }`}>
                {data.ai.enabled
                  ? `${data.ai.usedThisMonth} of ${data.ai.monthlyQuota}`
                  : 'Locked'}
              </span>
            </div>
            {data.ai.enabled && (
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    data.ai.remaining === 0 ? 'bg-red-500'
                    : data.ai.remaining < data.ai.monthlyQuota * 0.2 ? 'bg-amber-500'
                    : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, (data.ai.usedThisMonth / Math.max(1, data.ai.monthlyQuota)) * 100)}%` }}
                />
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {data.ai.source === 'tier_locked'   && 'Available on Team plan and above, or as an add-on for Squad tier.'}
              {data.ai.source === 'tier_included' && `Included with your ${tier.displayName} plan.`}
              {data.ai.source === 'addon_only'    && data.ai.addonPackage && `${data.ai.addonPackage.displayName} add-on — renews ${formatExpiry(data.ai.addonExpiresAt)}.`}
              {data.ai.source === 'tier+addon'    && data.ai.addonPackage && `Tier-included plus ${data.ai.addonPackage.displayName} add-on.`}
              {data.ai.source === 'override'      && 'Custom quota set by support.'}
              {data.ai.source === 'kill_switch'   && 'Disabled by support — contact us to re-enable.'}
            </p>
          </div>
        </div>

        {/* AI add-on packages — visible to TIER_4+ */}
        {(data.tier === 'TIER_4' || data.tier === 'TIER_5' || data.tier === 'TIER_6') && (
          <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-3">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI Add-ons</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Stack on top of your tier-included quota. Cheaper than a part-time bookkeeper.
                </p>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 pt-1">
              {[
                { type: 'STARTER_50',   name: 'Starter',  prompts: 50,  price: 250,   pitch: '~2 prompts/day' },
                { type: 'STANDARD_200', name: 'Standard', prompts: 200, price: 600,   pitch: '~7 prompts/day' },
                { type: 'PRO_500',      name: 'Pro',      prompts: 500, price: 1_400, pitch: 'Heavy usage' },
              ].map((pkg) => {
                const isActive = data.ai.addonType === pkg.type;
                return (
                  <div key={pkg.type} className={`rounded-lg border p-3 ${
                    isActive
                      ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]'
                      : 'border-border bg-background'
                  }`}>
                    <div className="flex items-baseline justify-between">
                      <p className="font-bold text-foreground">{pkg.name}</p>
                      {isActive && <span className="text-[9px] uppercase font-bold tracking-wider text-emerald-600">Active</span>}
                    </div>
                    <p className="text-2xl font-bold text-foreground mt-1">₱{pkg.price.toLocaleString('en-PH')}<span className="text-xs font-normal text-muted-foreground">/mo</span></p>
                    <p className="text-xs text-foreground mt-1">{pkg.prompts} prompts</p>
                    <p className="text-[10px] text-muted-foreground">{pkg.pitch}</p>
                  </div>
                );
              })}
            </div>
            <a
              href="mailto:support@hnscorpph.com?subject=AI%20Add-on%20Request"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white font-semibold hover:brightness-110 active:scale-[0.98] transition-all text-sm"
              style={{ background: 'var(--accent)' }}
            >
              {data.ai.addonType ? 'Change add-on' : 'Buy add-on'}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
            <p className="text-[10px] text-muted-foreground">
              Add-on requests are processed manually by our team within 1 business day. Self-service billing coming soon.
            </p>
          </div>
        )}

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

        {/* Test users seeder (BUSINESS_OWNER only) — DEMO TENANTS ONLY.
            Real customer tenants should never see this — predictable passwords
            on real users would be a security hole. Gated by Tenant.isDemoTenant. */}
        {data.isDemoTenant && <TestUsersSeederCard />}


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

// ── Modular Plan card (primary plan/module/seats summary) ───────────────────
function ModulePlanCard({
  planCode, modulePos, moduleLedger, modulePayroll, staffCount,
}: {
  planCode:      PlanCode;
  modulePos:     boolean;
  moduleLedger:  boolean;
  modulePayroll: boolean;
  staffCount:    number;
}) {
  const cap         = PLAN_CAPS[planCode];
  const ceiling     = effectiveSeatCeiling(planCode, 0);
  const seatsLeft   = Math.max(0, ceiling - staffCount);
  const usedPct     = Math.min(100, Math.round((staffCount / Math.max(1, ceiling)) * 100));
  const monthlyPhp  = Math.round(cap.pricePhpMonthlyCents / 100);
  const addonPhp    = Math.round(cap.addonSeatPhpMonthlyCents / 100);
  const moduleCount = cap.moduleCount;

  const modules: Array<{ key: 'POS' | 'LEDGER' | 'PAYROLL'; on: boolean; Icon: any; label: string; tagline: string }> = [
    { key: 'POS',     on: modulePos,     Icon: ShoppingCart, label: 'POS',     tagline: 'Run the till' },
    { key: 'LEDGER',  on: moduleLedger,  Icon: BookOpen,     label: 'Ledger',  tagline: 'Books that match BIR' },
    { key: 'PAYROLL', on: modulePayroll, Icon: UsersIcon,    label: 'Payroll', tagline: 'Pay people right' },
  ];

  return (
    <div className="rounded-xl border border-[var(--accent)]/20 bg-card p-5 sm:p-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Modular plan</p>
          <h2 className="text-2xl font-bold text-foreground mt-1">{planLabel(planCode)}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {moduleCount === 1 ? 'Standalone' : moduleCount === 2 ? 'Two-module pair' : 'Full suite'} · plan code <span className="font-mono">{planCode}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-foreground">
            ₱{monthlyPhp.toLocaleString('en-PH')}
            <span className="text-sm font-normal text-muted-foreground">/mo</span>
          </p>
          {addonPhp > 0 && (
            <p className="text-[11px] text-muted-foreground mt-0.5">+₱{addonPhp.toLocaleString('en-PH')} per add-on seat/mo</p>
          )}
        </div>
      </header>

      {/* Modules */}
      <div className="grid grid-cols-3 gap-2">
        {modules.map((m) => (
          <div
            key={m.key}
            className={`rounded-lg border p-3 ${
              m.on
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-border bg-muted/40 opacity-60'
            }`}
          >
            <div className="flex items-center gap-2">
              <m.Icon className={`w-4 h-4 ${m.on ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`} />
              <span className={`text-sm font-semibold ${m.on ? 'text-foreground' : 'text-muted-foreground'}`}>{m.label}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{m.tagline}</p>
            <p className={`text-[10px] mt-0.5 font-semibold ${m.on ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
              {m.on ? 'Enabled' : 'Not on plan'}
            </p>
          </div>
        ))}
      </div>

      {/* Seats */}
      <div className="space-y-1.5 pt-3 border-t border-border">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <UsersIcon className="w-3.5 h-3.5" />
            Staff seats
          </span>
          <span className={`font-semibold ${seatsLeft === 0 ? 'text-red-600' : 'text-foreground'}`}>
            {staffCount} of {ceiling} <span className="text-muted-foreground font-normal">({seatsLeft} remaining)</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full transition-all ${
              seatsLeft === 0 ? 'bg-red-500'
              : usedPct > 80 ? 'bg-amber-500'
              : 'bg-emerald-500'
            }`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        {cap.maxAddons > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Buy up to {cap.maxAddons} additional seats at ₱{addonPhp.toLocaleString('en-PH')}/mo each (max plan ceiling: {cap.maxTotal} staff).
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Seat add-ons not available on this plan — upgrade to add more staff.
          </p>
        )}
      </div>

      {/* Plan switch CTA — opens email since billing is sales-led */}
      <a
        href={`mailto:support@hnscorpph.com?subject=Plan%20change%20request%20-%20${planCode}`}
        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-border hover:bg-muted text-sm font-medium transition-colors"
      >
        Change plan or buy seats
        <ArrowRight className="w-3.5 h-3.5" />
      </a>
      <p className="text-[10px] text-muted-foreground -mt-1">
        Plan changes are processed manually by our team within 1 business day.
      </p>
    </div>
  );
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'no expiry';
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Test Users Seeder Card ────────────────────────────────────────────────────
// Lets the BUSINESS_OWNER spin up one user per role (14 roles) plus sample
// customers/vendors for testing. Idempotent — safe to click repeatedly.

interface SeedCredential {
  role:           string;
  name:           string;
  shortDesc:      string;
  email:          string;
  password:       string;
  pin:            string;
  alreadyExisted: boolean;
  keyAccess:      string[];
}

interface SeedResult {
  tenant:       { id: string; slug: string; name: string };
  branch:       { id: string; name: string };
  credentials:  SeedCredential[];
  samples:      { customersCreated: number; vendorsCreated: number; customersAlreadyExisted: number; vendorsAlreadyExisted: number };
  loginInstructions: string[];
}

function TestUsersSeederCard() {
  const [running, setRunning]   = useState(false);
  const [result, setResult]     = useState<SeedResult | null>(null);
  const [showAll, setShowAll]   = useState(false);
  const [copied, setCopied]     = useState<string | null>(null);

  async function run() {
    setRunning(true);
    try {
      const { data } = await api.post<SeedResult>('/tenant/seed-test-users');
      setResult(data);
      const fresh = data.credentials.filter((c) => !c.alreadyExisted).length;
      const reused = data.credentials.length - fresh;
      const newCustomers = data.samples.customersCreated;
      const newVendors   = data.samples.vendorsCreated;
      const summaryParts: string[] = [];
      if (fresh > 0)        summaryParts.push(`${fresh} new ${fresh === 1 ? 'role' : 'roles'}`);
      if (reused > 0)       summaryParts.push(`${reused} already existed`);
      if (newCustomers > 0) summaryParts.push(`${newCustomers} customers`);
      if (newVendors > 0)   summaryParts.push(`${newVendors} vendors`);
      toast.success(`Seeded — ${summaryParts.join(', ') || 'no changes'}`);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not run the seeder.';
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const visibleCreds = result
    ? showAll ? result.credentials : result.credentials.slice(0, 5)
    : [];

  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-3">
      <div className="flex items-start gap-3">
        <Wrench className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Test users + sample data</h3>
          <p className="text-sm text-foreground mt-1">
            One-click setup: creates one user per role (14 roles), plus a few sample customers and vendors so you can sign in as each role and see what they unlock.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Safe to click multiple times — already-existing users are kept. Predictable password &mdash; only use on the demo account, not real customers.
          </p>
        </div>
      </div>

      <button
        onClick={run}
        disabled={running}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white font-semibold hover:brightness-110 active:scale-[0.98] transition-all text-sm disabled:opacity-60"
        style={{ background: 'var(--accent)' }}
      >
        {running ? 'Seeding…' : (result ? 'Re-run / refresh credentials' : 'Seed test users')}
      </button>

      {result && (
        <div className="space-y-3 mt-2">
          {/* Login summary box */}
          <div className="rounded-lg bg-secondary px-3 py-2 text-xs space-y-0.5 font-mono">
            {result.loginInstructions.map((l, i) => (
              <div key={i} className="text-foreground">{l}</div>
            ))}
          </div>

          {/* Credentials table */}
          <div className="overflow-hidden border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-secondary text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Role</th>
                  <th className="text-left px-3 py-2 font-semibold">Email</th>
                  <th className="text-left px-3 py-2 font-semibold">What they see</th>
                  <th className="text-right px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleCreds.map((c) => (
                  <tr key={c.email} className="hover:bg-secondary/50">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-foreground">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{c.role}</p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <button
                        onClick={() => copy(c.email, c.email)}
                        className="font-mono text-[11px] inline-flex items-center gap-1 text-foreground hover:text-[var(--accent)] transition-colors"
                        title="Click to copy"
                      >
                        {c.email}
                        {copied === c.email
                          ? <Check className="w-3 h-3 text-emerald-500" />
                          : <Copy className="w-3 h-3 opacity-40" />
                        }
                      </button>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                        {c.keyAccess.map((k, i) => <li key={i}>• {k}</li>)}
                      </ul>
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {c.alreadyExisted
                        ? <span className="text-[10px] text-muted-foreground uppercase">existing</span>
                        : <span className="text-[10px] text-emerald-600 uppercase font-bold">new</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.credentials.length > 5 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              {showAll ? 'Show less' : `Show all ${result.credentials.length} roles`}
            </button>
          )}

          <p className="text-[11px] text-muted-foreground">
            Sample data: {result.samples.customersCreated + result.samples.customersAlreadyExisted} customers, {result.samples.vendorsCreated + result.samples.vendorsAlreadyExisted} vendors total in this tenant.
          </p>
        </div>
      )}
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
    'custom_personas':      'Custom permission templates per role',
  };
  return map[flag] ?? flag;
}
