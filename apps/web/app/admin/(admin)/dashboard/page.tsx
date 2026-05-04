'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, Users, AlertTriangle, Sparkles, Eye, EyeOff,
  ShieldAlert, Clock, UserPlus, Activity,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Spinner } from '@/components/ui/Spinner';

interface PlatformMetrics {
  generatedAt: string;
  tenants: {
    total: number;
    byStatus: { status: string; count: number }[];
    byTier:   { tier: string;   count: number }[];
    activeLast7d:  number;
    activeLast30d: number;
    recentSignupsLast7d: number;
  };
  users: {
    totalActive: number;
    sessionsLast24h: number;
    failedLoginsLast24h: number;
  };
  operations: {
    failedEvents: number;
    pendingEvents: number;
  };
  platformCost: {
    aiSpendUsd30d: number;
  };
}

function StatCard({
  label, value, sub, icon: Icon, severity = 'neutral', onClick,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; severity?: 'neutral' | 'good' | 'warn' | 'bad';
  onClick?: () => void;
}) {
  const colorMap = {
    neutral: 'border-border',
    good:    'border-emerald-500/40 bg-emerald-500/5',
    warn:    'border-amber-500/40 bg-amber-500/5',
    bad:     'border-red-500/40 bg-red-500/10',
  };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`text-left rounded-lg border ${colorMap[severity]} bg-background p-4 ${onClick ? 'hover:bg-muted/50 transition' : 'cursor-default'}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </button>
  );
}

export default function AdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  // AI cost is hidden by default — toggleable, doesn't persist (per-session
  // privacy, in case the screen is being shared during a sales demo).
  const [showAiCost, setShowAiCost] = useState(false);

  const { data, isLoading } = useQuery<PlatformMetrics>({
    queryKey: ['admin-metrics'],
    queryFn:  () => api.get('/admin/metrics').then((r) => r.data),
    enabled:  !!(user?.isSuperAdmin || user?.role === 'SUPER_ADMIN'),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return <Spinner size="lg" message="Loading platform metrics…" />;

  const tierMap = Object.fromEntries(data.tenants.byTier.map((r) => [r.tier, r.count]));
  const statusMap = Object.fromEntries(data.tenants.byStatus.map((r) => [r.status, r.count]));

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Platform Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Operational metrics only. Tenant financial data is intentionally not surfaced here —
          we don&apos;t look at our customers&apos; money.
        </p>
      </div>

      {/* ── Tenant Footprint ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tenant Footprint</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Total tenants"
            value={String(data.tenants.total)}
            sub={`${statusMap.ACTIVE ?? 0} active · ${statusMap.SUSPENDED ?? 0} suspended`}
            icon={Building2}
            onClick={() => router.push('/admin/tenants')}
          />
          <StatCard
            label="Active (7d)"
            value={String(data.tenants.activeLast7d)}
            sub={`${data.tenants.activeLast30d} active in 30d`}
            icon={Sparkles}
            severity={data.tenants.activeLast7d === 0 ? 'warn' : 'good'}
          />
          <StatCard
            label="New signups (7d)"
            value={String(data.tenants.recentSignupsLast7d)}
            sub="Tenants created in last 7 days"
            icon={UserPlus}
            severity={data.tenants.recentSignupsLast7d > 0 ? 'good' : 'neutral'}
          />
          <StatCard
            label="Total users"
            value={String(data.users.totalActive)}
            sub="Active accounts across all tenants"
            icon={Users}
          />
        </div>
      </section>

      {/* ── Tier distribution ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tiers</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {(['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5', 'TIER_6'] as const).map((t) => (
            <div key={t} className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{t.replace('_', ' ')}</div>
              <div className="text-base font-semibold tabular-nums">{tierMap[t] ?? 0}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Operational Health ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Operational Health</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Failed events"
            value={String(data.operations.failedEvents)}
            sub="Stuck POS events needing triage"
            icon={AlertTriangle}
            severity={data.operations.failedEvents === 0 ? 'good' : data.operations.failedEvents <= 5 ? 'warn' : 'bad'}
            onClick={() => router.push('/admin/events')}
          />
          <StatCard
            label="Pending events"
            value={String(data.operations.pendingEvents)}
            sub="Unprocessed for 5+ minutes — possible queue lag"
            icon={Clock}
            severity={data.operations.pendingEvents === 0 ? 'good' : data.operations.pendingEvents <= 10 ? 'warn' : 'bad'}
            onClick={() => router.push('/admin/events')}
          />
          <StatCard
            label="Failed logins (24h)"
            value={String(data.users.failedLoginsLast24h)}
            sub="Possible brute-force / credential-stuffing"
            icon={ShieldAlert}
            severity={
              data.users.failedLoginsLast24h === 0 ? 'good' :
              data.users.failedLoginsLast24h <= 20 ? 'warn' : 'bad'
            }
          />
          <StatCard
            label="Sessions (24h)"
            value={String(data.users.sessionsLast24h)}
            sub="Active user sessions in last 24 hours"
            icon={Activity}
          />
        </div>
      </section>

      {/* ── Platform Cost (hidden by default) ─────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Platform Cost (last 30 days)
          </h2>
          <button
            onClick={() => setShowAiCost((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={showAiCost ? 'Hide cost (good for screen sharing)' : 'Reveal cost'}
          >
            {showAiCost ? (
              <>
                <EyeOff className="w-3 h-3" />
                Hide
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" />
                Show
              </>
            )}
          </button>
        </div>
        <div className="rounded-lg border border-border bg-background p-4">
          {showAiCost ? (
            <>
              <div className="text-3xl font-bold tabular-nums">
                ${data.platformCost.aiSpendUsd30d.toFixed(4)} USD
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Anthropic API cost for AI features (JE Drafter, Smart Picker, Receipt OCR) across all tenants.
                This is OUR cost — recouped via AI add-on packages (₱250–₱1,400/mo per tier).
              </p>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-2xl tabular-nums tracking-widest text-muted-foreground/70">••••••</span>
              <p className="text-xs text-muted-foreground italic">
                Hidden. Click <span className="font-medium">Show</span> to reveal.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Privacy notice — explicit so anyone reading the code or the screen knows the why */}
      <section className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Privacy by design:</span>{' '}
          The Platform Console intentionally does not display tenant revenue, order counts,
          AR/AP balances, or any financial figures. Cross-tenant financial visibility is
          available only to the tenant owners themselves, never to us. If a support case
          requires inspecting a tenant&apos;s data, an explicit JIT-access workflow (with
          audit trail) is required.
        </p>
      </section>

      <div className="text-xs text-muted-foreground">
        Last updated: {new Date(data.generatedAt).toLocaleString('en-PH')}
      </div>
    </div>
  );
}
