'use client';
import { useQuery } from '@tanstack/react-query';
import { Building2, Users, ShoppingCart, TrendingUp, AlertTriangle, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';

interface PlatformMetrics {
  generatedAt: string;
  tenants: {
    total: number;
    byStatus: { status: string; count: number }[];
    byTier:   { tier: string;   count: number }[];
    activeLast7d:  number;
    activeLast30d: number;
  };
  users: { totalActive: number };
  activity: {
    ordersLast30d: number;
    revenueLast30d: number;
    openArInvoices: number;
    openApBills: number;
    failedEvents: number;
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

  const { data, isLoading } = useQuery<PlatformMetrics>({
    queryKey: ['admin-metrics'],
    queryFn:  () => api.get('/admin/metrics').then((r) => r.data),
    enabled:  !!user?.isSuperAdmin,
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
          Cross-tenant operational metrics. All times in UTC; refresh every 60s.
        </p>
      </div>

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
            label="Total users"
            value={String(data.users.totalActive)}
            sub="Active accounts across all tenants"
            icon={Users}
          />
          <StatCard
            label="Failed events"
            value={String(data.activity.failedEvents)}
            sub="Stuck POS events needing triage"
            icon={AlertTriangle}
            severity={data.activity.failedEvents === 0 ? 'good' : data.activity.failedEvents <= 5 ? 'warn' : 'bad'}
            onClick={() => router.push('/admin/events')}
          />
        </div>
      </section>

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

      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Activity (last 30 days)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Orders"
            value={data.activity.ordersLast30d.toLocaleString()}
            sub="Completed POS sales across all tenants"
            icon={ShoppingCart}
          />
          <StatCard
            label="Revenue"
            value={formatPeso(data.activity.revenueLast30d)}
            sub="Sum of completed-order totals"
            icon={TrendingUp}
          />
          <StatCard
            label="Open AR"
            value={String(data.activity.openArInvoices)}
            sub="Formal invoices awaiting payment"
            icon={TrendingUp}
          />
          <StatCard
            label="Open AP"
            value={String(data.activity.openApBills)}
            sub="Vendor bills awaiting payment"
            icon={TrendingUp}
          />
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">AI Cost (last 30 days)</h2>
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="text-3xl font-bold tabular-nums">${data.activity.aiSpendUsd30d.toFixed(4)} USD</div>
          <p className="text-xs text-muted-foreground mt-1">
            Total Anthropic API cost for JE Drafter / Smart Picker / JE Guide / Receipt OCR across all tenants.
            Recoup via AI add-on packages (₱250–₱1,400 / mo per tier).
          </p>
        </div>
      </section>

      <div className="text-xs text-muted-foreground">
        Last updated: {new Date(data.generatedAt).toLocaleString('en-PH')}
      </div>
    </div>
  );
}
