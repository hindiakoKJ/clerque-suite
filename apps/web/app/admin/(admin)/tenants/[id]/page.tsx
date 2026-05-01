'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, AlertTriangle, Sparkles, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from 'sonner';

interface TenantDetail {
  tenant: {
    id: string; slug: string; name: string;
    status: 'ACTIVE' | 'GRACE' | 'SUSPENDED';
    tier:    string;
    businessType: string;
    taxStatus: string;
    isBirRegistered: boolean;
    aiAddonType: string | null;
    aiQuotaOverride: number | null;
    aiAddonExpiresAt: string | null;
    createdAt: string;
    _count: { users: number; branches: number; products: number };
  };
  stats: {
    orders30d: number;
    revenue30d: number;
    postedJEs: number;
    openArInvoices: number;
    openApBills: number;
    failedEvents: number;
    aiPrompts30d: number;
    aiSpendUsd30d: number;
  };
}

const STATUS_OPTIONS = ['ACTIVE', 'GRACE', 'SUSPENDED'] as const;
const TIER_OPTIONS   = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5', 'TIER_6'] as const;
const ADDON_OPTIONS  = [
  { value: '',             label: '— None —' },
  { value: 'STARTER_50',   label: 'Starter 50 (₱250/mo)' },
  { value: 'STANDARD_200', label: 'Standard 200 (₱600/mo)' },
  { value: 'PRO_500',      label: 'Pro 500 (₱1,400/mo)' },
];

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery<TenantDetail>({
    queryKey: ['admin-tenant-detail', id],
    queryFn:  () => api.get(`/admin/tenants/${id}`).then((r) => r.data),
    enabled:  !!user?.isSuperAdmin,
  });

  if (isLoading || !data) return <Spinner size="lg" message="Loading tenant…" />;
  const { tenant, stats } = data;

  async function patchTenant(path: string, body: object, label: string) {
    setBusy(true);
    try {
      await api.patch(`/admin/tenants/${id}/${path}`, body);
      toast.success(`${label} updated.`);
      qc.invalidateQueries({ queryKey: ['admin-tenant-detail', id] });
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? `Failed to update ${label}`);
    } finally {
      setBusy(false);
    }
  }

  // Quick-seed: call the existing tenant.seedTestUsers endpoint by impersonating
  // (not yet wired in admin). For now we surface the per-tenant link so super-admin
  // can navigate there in their own tenant context. Full impersonation is on roadmap.

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <button onClick={() => router.push('/admin/tenants')}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> Back to tenants
      </button>

      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[var(--accent)]" />
          {tenant.name}
        </h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">slug: {tenant.slug} · id: {tenant.id}</p>
      </div>

      {/* 30-day stats */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Last 30 days</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Orders"          value={stats.orders30d.toLocaleString()} />
          <Stat label="Revenue"         value={formatPeso(stats.revenue30d)} />
          <Stat label="Posted JEs"      value={stats.postedJEs.toLocaleString()} />
          <Stat label="Failed events"   value={String(stats.failedEvents)}
                severity={stats.failedEvents === 0 ? 'good' : 'bad'}
                icon={AlertTriangle} />
          <Stat label="Open AR"         value={String(stats.openArInvoices)} />
          <Stat label="Open AP"         value={String(stats.openApBills)} />
          <Stat label="AI prompts"      value={String(stats.aiPrompts30d)} icon={Sparkles} />
          <Stat label="AI spend (USD)"  value={`$${stats.aiSpendUsd30d.toFixed(4)}`} icon={Sparkles} />
        </div>
      </section>

      {/* Master + classification */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Master Data</h2>
        <div className="rounded-lg border border-border bg-background p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Field label="Business Type" value={tenant.businessType} />
          <Field label="Tax Status"    value={tenant.taxStatus} />
          <Field label="BIR Registered" value={tenant.isBirRegistered ? 'Yes' : 'No'} />
          <Field label="Branches"      value={String(tenant._count.branches)} />
          <Field label="Users"         value={String(tenant._count.users)} />
          <Field label="Products"      value={String(tenant._count.products)} />
          <Field label="Created"       value={new Date(tenant.createdAt).toLocaleDateString('en-PH')} />
        </div>
      </section>

      {/* Status */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tenant Status</h2>
        <div className="rounded-lg border border-border bg-background p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <p className="text-xs text-muted-foreground mb-1">Current</p>
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
              tenant.status === 'ACTIVE'    ? 'bg-emerald-100 text-emerald-700' :
              tenant.status === 'GRACE'     ? 'bg-amber-100 text-amber-700' :
                                              'bg-red-100 text-red-700'
            }`}>{tenant.status}</span>
          </div>
          <div className="flex gap-2">
            {STATUS_OPTIONS.filter((s) => s !== tenant.status).map((s) => (
              <button key={s}
                onClick={() => patchTenant('status', { status: s }, `Status (${s})`)}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50">
                Set {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Tier */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Subscription Tier</h2>
        <div className="rounded-lg border border-border bg-background p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <p className="text-xs text-muted-foreground mb-1">Current</p>
            <span className="font-mono text-sm">{tenant.tier}</span>
          </div>
          <select
            defaultValue={tenant.tier}
            onChange={(e) => patchTenant('tier', { tier: e.target.value }, `Tier (${e.target.value})`)}
            disabled={busy}
            className="h-9 px-3 rounded-md border border-border bg-background text-sm"
          >
            {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </section>

      {/* AI override */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">AI Add-on Override</h2>
        <div className="rounded-lg border border-border bg-background p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Add-on Package</label>
            <select
              defaultValue={tenant.aiAddonType ?? ''}
              onChange={(e) => patchTenant('ai-override', {
                addonType: e.target.value || null,
                quotaOverride: tenant.aiQuotaOverride,
              }, 'AI add-on')}
              disabled={busy}
              className="h-9 px-3 rounded-md border border-border bg-background text-sm w-full"
            >
              {ADDON_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Quota Override (per month)</label>
            <input
              type="number"
              min={0}
              max={100000}
              defaultValue={tenant.aiQuotaOverride ?? ''}
              placeholder="(use tier default)"
              onBlur={(e) => {
                const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                patchTenant('ai-override', { quotaOverride: v, addonType: tenant.aiAddonType }, 'Quota override');
              }}
              disabled={busy}
              className="h-9 px-3 rounded-md border border-border bg-background text-sm w-full"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Comp grant. Demo tenant should have a high override (e.g. 9999) for unlimited demos.
              Production tenants should usually have null (use tier defaults).
            </p>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Actions</h2>
        <div className="rounded-lg border border-border bg-background p-4 space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            More tools coming: impersonate user, force data export, password reset, view audit log.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => router.push('/select')}
              className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted flex items-center gap-1.5"
            >
              <Wand2 className="w-3 h-3" /> Open my own tenant view
            </button>
            <a
              href={`https://app.railway.app/`} target="_blank" rel="noreferrer"
              className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted"
            >
              Railway dashboard ↗
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, severity = 'neutral', icon: Icon }: {
  label: string; value: string;
  severity?: 'neutral' | 'good' | 'bad';
  icon?: React.ElementType;
}) {
  const cls = severity === 'good' ? 'border-emerald-500/40 bg-emerald-500/5' :
              severity === 'bad'  ? 'border-red-500/40 bg-red-500/5'         :
                                    'border-border';
  return (
    <div className={`rounded-lg border ${cls} bg-background p-3`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
