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
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowUpRight, CheckCircle2, Users, Building2,
  Sparkles, AlertTriangle, Crown, Wrench, Copy, Check,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { planCapsFor, planLabel, effectiveSeatCeiling, normalizePlanCode } from '@repo/shared-types';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/support';
import { branchUsageLabel, isUncapped, seatUsageLabel } from '../plan-limits-view';
import { toast } from 'sonner';
import { ShoppingCart, BookOpen, Users as UsersIcon, ArrowRight } from 'lucide-react';

type AiAddonType = 'STARTER_50' | 'STANDARD_200' | 'PRO_500';

interface SubscriptionResponse {
  expiresAt:         string | null;
  staffCount:        number;
  branchCount:       number;
  branchQuota:       number;
  cashierSeatQuota:  number;
  /** The branch cap the API actually enforces (the plan's). branchQuota is an
   *  older per-tenant column that nothing enforces any more. */
  limits?: { maxBranches: number };
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
    source:          'plan_locked' | 'plan_included' | 'addon_only' | 'plan+addon' | 'override' | 'kill_switch';
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

  const staffCap  = data.cashierSeatQuota;
  const staffUsed = data.staffCount;
  const staffPct  = isUncapped(staffCap) ? 0 : Math.min(100, Math.round((staffUsed / Math.max(1, staffCap)) * 100));
  const isAtCap   = !isUncapped(staffCap) && staffUsed >= staffCap;
  const expiringSoon = data.expiresAt
    ? new Date(data.expiresAt).getTime() - Date.now() < 14 * 24 * 60 * 60 * 1000
    : false;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Back compacts history (router.back) so /settings → /settings/<sub>
            → back returns to /settings, then back again exits Settings to
            wherever the user came from. */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) router.back();
            else router.push('/settings');
          }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Settings
        </button>

        <div>
          <h1 className="text-2xl font-bold text-foreground">Subscription</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your Clerque plan, staff seats, and included apps.
          </p>
        </div>

        {/* ── Modular Plan card (primary, NEW) ──────────────────────────────── */}
        <ModulePlanCard
          planCode={normalizePlanCode(user?.planCode)}
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
                  Usage
                </p>
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                What this account is using against its limits.
              </p>
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
                {seatUsageLabel(staffUsed, staffCap)}
              </span>
            </div>
            {!isUncapped(staffCap) && (
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full transition-all ${isAtCap ? 'bg-red-500' : staffPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${staffPct}%` }}
                />
              </div>
            )}
            {isAtCap && (
              <p className="text-xs text-red-600">
                Every staff seat is in use. Email{' '}
                <a href={supportMailto('Add staff seats')} className="underline">{SUPPORT_EMAIL}</a> to add more.
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
              {branchUsageLabel(data.branchCount, data.limits?.maxBranches ?? data.branchQuota)}
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
              {data.ai.source === 'plan_locked'   && 'No AI allowance on this account yet — add a package below.'}
              {data.ai.source === 'plan_included' && 'Included with your plan.'}
              {data.ai.source === 'addon_only'    && data.ai.addonPackage && `${data.ai.addonPackage.displayName} add-on — renews ${formatExpiry(data.ai.addonExpiresAt)}.`}
              {data.ai.source === 'plan+addon'    && data.ai.addonPackage && `Plan-included plus ${data.ai.addonPackage.displayName} add-on.`}
              {data.ai.source === 'override'      && 'Custom quota set by support.'}
              {data.ai.source === 'kill_switch'   && 'AI features are not switched on for Clerque yet.'}
            </p>
          </div>
        </div>

        {/* AI add-on packages. Hidden while AI is switched off for the whole
            service: the API refuses to assign an add-on then, so offering one
            would sell something that does nothing. No prices: the price is
            agreed with Clerque, never printed. */}
        {data.ai.source !== 'kill_switch' && (
          <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-3">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI Add-ons</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  More AI prompts each month, on top of what your plan includes.
                </p>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 pt-1">
              {[
                { type: 'STARTER_50',   name: 'Starter',  prompts: 50,  pitch: 'About 2 a day' },
                { type: 'STANDARD_200', name: 'Standard', prompts: 200, pitch: 'About 7 a day' },
                { type: 'PRO_500',      name: 'Pro',      prompts: 500, pitch: 'Heavy use' },
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
                    <p className="text-xs text-foreground mt-1">{pkg.prompts} prompts a month</p>
                    <p className="text-[10px] text-muted-foreground">{pkg.pitch}</p>
                  </div>
                );
              })}
            </div>
            <a
              href={supportMailto('AI add-on request')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white font-semibold hover:brightness-110 active:scale-[0.98] transition-all text-sm"
              style={{ background: 'var(--accent)' }}
            >
              {data.ai.addonType ? 'Change add-on' : 'Ask for an add-on'}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
            <p className="text-[10px] text-muted-foreground">
              We reply to add-on requests within 1 business day.
            </p>
          </div>
        )}


        {/* Test users seeder (BUSINESS_OWNER only) — DEMO TENANTS ONLY.
            Real customer tenants should never see this — predictable passwords
            on real users would be a security hole. Gated by Tenant.isDemoTenant. */}
        {data.isDemoTenant && <TestUsersSeederCard />}



      </div>
    </div>
  );
}

// ── Modular Plan card (primary plan/module/seats summary) ───────────────────
function ModulePlanCard({
  planCode, modulePos, moduleLedger, modulePayroll, staffCount,
}: {
  planCode:      ReturnType<typeof normalizePlanCode>;
  modulePos:     boolean;
  moduleLedger:  boolean;
  modulePayroll: boolean;
  staffCount:    number;
}) {
  const cap         = planCapsFor(planCode);
  const ceiling     = effectiveSeatCeiling(planCode, 0);
  const seatsLeft   = Math.max(0, ceiling - staffCount);
  const usedPct     = Math.min(100, Math.round((staffCount / Math.max(1, ceiling)) * 100));
  const uncapped    = isUncapped(ceiling);

  // A module being off is now a choice this business made, not something a
  // cheaper plan withheld — so there is no upsell note to show.
  const modules: Array<{ key: 'POS' | 'LEDGER' | 'PAYROLL'; on: boolean; Icon: any; label: string; tagline: string; lockedNote?: string }> = [
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
            To add or remove a module, email{' '}
            <a href={supportMailto('Change my Clerque modules')} className="underline">{SUPPORT_EMAIL}</a>.
          </p>
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
              {m.on ? 'Enabled' : (m.lockedNote ?? 'Not on plan')}
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
          <span className={`font-semibold ${!uncapped && seatsLeft === 0 ? 'text-red-600' : 'text-foreground'}`}>
            {seatUsageLabel(staffCount, ceiling)}
          </span>
        </div>
        {!uncapped && (
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
        )}
        {uncapped ? (
          <p className="text-[11px] text-muted-foreground">
            Add as many staff as you need.
          </p>
        ) : cap.maxAddons > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            You can add up to {cap.maxAddons} more seats ({cap.maxTotal} staff in all). Email us to add them.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            To add more staff, email us.
          </p>
        )}
      </div>

      {/* Plan switch CTA — opens email since billing is sales-led */}
      <a
        href={supportMailto(`Plan change request - ${planCode}`)}
        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-border hover:bg-muted text-sm font-medium transition-colors"
      >
        Change plan or buy seats
        <ArrowRight className="w-3.5 h-3.5" />
      </a>
      <p className="text-[10px] text-muted-foreground -mt-1">
        We reply to plan changes within 1 business day.
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
