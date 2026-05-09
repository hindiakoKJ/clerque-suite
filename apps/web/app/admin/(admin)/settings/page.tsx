'use client';
/**
 * Console → Settings
 *
 * Singleton platform configuration + operational tooling for HNS Corp PH:
 *   - Company tab: HNS Corp's master data (TIN, address, VAT/BIR status).
 *     Drives subscription receipts (AR vs OR) and tenant-side AP bill VAT split.
 *   - Billing tab: auto-issue cron toggle, due-days window. Bootstrap HNS
 *     tenant button (one-time setup).
 *   - Demo Data tab: provision demo tenants for any of the 12 scenarios.
 *   - About tab: build version + deploy info.
 *
 * SUPER_ADMIN only — guarded by the admin layout.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings as SettingsIcon, Building2, Receipt, Database, Info, Save, Sparkles,
  CheckCircle2, AlertTriangle, Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Tab = 'company' | 'billing' | 'demo' | 'about';

interface PlatformConfig {
  id:                    string;
  companyName:           string;
  tin:                   string | null;
  address:               string | null;
  contactPhone:          string | null;
  contactEmail:          string | null;
  taxStatus:             'VAT' | 'NON_VAT' | 'UNREGISTERED';
  isBirRegistered:       boolean;
  subscriptionAutoIssue: boolean;
  subscriptionDueDays:   number;
  hnsTenantId:           string | null;
}

export default function ConsoleSettingsPage() {
  const [tab, setTab] = useState<Tab>('company');

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Console Settings</h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          HNS Corp PH platform configuration. Drives subscription billing, demo provisioning, and receipt-template selection.
        </p>
      </header>

      <div className="px-4 sm:px-6 pt-4 border-b border-border bg-background">
        <nav className="flex gap-1 -mb-px">
          {([
            { id: 'company' as const, label: 'Company',  icon: Building2 },
            { id: 'billing' as const, label: 'Billing',  icon: Receipt },
            { id: 'demo'    as const, label: 'Demo Data',icon: Database },
            { id: 'about'   as const, label: 'About',    icon: Info },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ' +
                (tab === id
                  ? 'border-[var(--accent)] text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {tab === 'company' && <CompanyTab />}
        {tab === 'billing' && <BillingTab />}
        {tab === 'demo'    && <DemoTab />}
        {tab === 'about'   && <AboutTab />}
      </div>
    </div>
  );
}

// ─── Company tab ─────────────────────────────────────────────────────────────

function CompanyTab() {
  const qc = useQueryClient();
  const { data: cfg, isLoading } = useQuery<PlatformConfig>({
    queryKey: ['platform-config'],
    queryFn:  () => api.get('/admin/platform/config').then((r) => r.data),
  });

  const [form, setForm] = useState<Partial<PlatformConfig>>({});

  const update = useMutation({
    mutationFn: (body: Partial<PlatformConfig>) =>
      api.patch('/admin/platform/config', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-config'] });
      toast.success('Saved.');
      setForm({});
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  if (isLoading || !cfg) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const merged = { ...cfg, ...form };

  function field<K extends keyof PlatformConfig>(k: K, v: PlatformConfig[K] | null) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  const dirty = Object.keys(form).length > 0;

  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">HNS Corp PH master data</h2>
        <p className="text-xs text-muted-foreground">Printed on every subscription receipt sent to tenants.</p>

        <Field label="Company name *" v={merged.companyName ?? ''} on={(v) => field('companyName', v)} />
        <Field label="TIN" v={merged.tin ?? ''} on={(v) => field('tin', v || null)} mono placeholder="000-000-000-00000" />
        <Field label="Registered address" v={merged.address ?? ''} on={(v) => field('address', v || null)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact phone" v={merged.contactPhone ?? ''} on={(v) => field('contactPhone', v || null)} mono />
          <Field label="Contact email" v={merged.contactEmail ?? ''} on={(v) => field('contactEmail', v || null)} type="email" />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">BIR status</h2>
        <p className="text-xs text-muted-foreground">
          Drives the receipt template (Acknowledgement Receipt vs Sales Invoice / Official Receipt) and whether VAT
          is itemized on subscription bills.
        </p>

        <label className="text-sm block">
          <span className="text-xs text-muted-foreground">Tax status</span>
          <select
            value={merged.taxStatus}
            onChange={(e) => field('taxStatus', e.target.value as any)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="UNREGISTERED">UNREGISTERED — issue Acknowledgement Receipts only</option>
            <option value="NON_VAT">NON_VAT — issue Sales Invoices, no VAT line</option>
            <option value="VAT">VAT — issue Sales Invoices with 12% VAT line</option>
          </select>
        </label>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={merged.isBirRegistered ?? false}
            onChange={(e) => field('isBirRegistered', e.target.checked)}
            className="mt-1"
          />
          <span>
            <strong className="block">BIR-registered</strong>
            <span className="text-xs text-muted-foreground">
              Toggle on once you have BIR ATP for Sales Invoice / Official Receipt printing. Adds OR/SI series numbering to receipts.
            </span>
          </span>
        </label>
      </section>

      <div className="flex justify-end">
        <button
          onClick={() => update.mutate(form)}
          disabled={!dirty || update.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {update.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ─── Billing tab ─────────────────────────────────────────────────────────────

function BillingTab() {
  const qc = useQueryClient();
  const { data: cfg, isLoading } = useQuery<PlatformConfig>({
    queryKey: ['platform-config'],
    queryFn:  () => api.get('/admin/platform/config').then((r) => r.data),
  });

  const update = useMutation({
    mutationFn: (body: Partial<PlatformConfig>) =>
      api.patch('/admin/platform/config', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-config'] });
      toast.success('Saved.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const bootstrap = useMutation({
    mutationFn: () => api.post('/admin/platform/bootstrap-hns-corp').then((r) => r.data),
    onSuccess: (data: { ownerEmail: string; ownerPassword: string | null; created: boolean; tenantId: string }) => {
      qc.invalidateQueries({ queryKey: ['platform-config'] });
      if (data.created) {
        toast.success(`HNS Corp PH tenant created. Owner: ${data.ownerEmail}`);
        // Show password in a separate dialog (one-time view).
        prompt('Owner credentials (copy now — shown only once):', `${data.ownerEmail} / ${data.ownerPassword}`);
      } else {
        toast.success('HNS Corp PH tenant already exists. PlatformConfig synced.');
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  if (isLoading || !cfg) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">HNS Corp PH tenant</h2>
        {cfg.hnsTenantId ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Provisioned. Tenant ID: <span className="font-mono text-[10px]">{cfg.hnsTenantId}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Not yet provisioned. Subscription billing requires an HNS Corp PH tenant — click below to create it.
              You can re-run safely; subsequent calls just sync PlatformConfig into the existing tenant.
            </div>
          </div>
        )}
        <button
          onClick={() => bootstrap.mutate()}
          disabled={bootstrap.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted text-sm font-medium disabled:opacity-50"
        >
          {bootstrap.isPending ? 'Provisioning…' : (cfg.hnsTenantId ? 'Re-sync from PlatformConfig' : 'Provision HNS Corp PH tenant')}
        </button>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Auto-issue cron</h2>
        <p className="text-xs text-muted-foreground">
          Runs at 02:00 daily; on the 1st of the month, issues subscription bills for every ACTIVE tenant
          (skipping ENTERPRISE and HNS itself). Idempotent — duplicate-period bills are rejected.
        </p>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.subscriptionAutoIssue}
            onChange={(e) => update.mutate({ subscriptionAutoIssue: e.target.checked })}
            className="mt-1"
          />
          <span>Enable monthly auto-issuance</span>
        </label>

        <label className="text-sm block">
          <span className="text-xs text-muted-foreground">Due window (days from issue)</span>
          <input
            type="number"
            min={1}
            max={90}
            defaultValue={cfg.subscriptionDueDays}
            onBlur={(e) => {
              const v = Math.max(1, Math.min(90, Number(e.target.value)));
              if (v !== cfg.subscriptionDueDays) update.mutate({ subscriptionDueDays: v });
            }}
            className="mt-1 w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </section>
    </div>
  );
}

// ─── Demo Data tab ───────────────────────────────────────────────────────────

interface Scenario {
  key:          string;
  label:        string;
  tenantName:   string;
  planCode:     string;
  businessType: string;
}

function DemoTab() {
  const { data: scenarios = [] } = useQuery<Scenario[]>({
    queryKey: ['platform-demo-scenarios'],
    queryFn:  () => api.get('/admin/platform/demo/scenarios').then((r) => r.data),
  });

  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [lastResult, setLastResult]     = useState<{ scenario: string; ownerEmail: string; ownerPassword: string | null; created: boolean } | null>(null);

  async function provision(key: string) {
    setProvisioning(key);
    try {
      const r = await api.post(`/admin/platform/demo/provision/${key}`);
      setLastResult({
        scenario:      key,
        ownerEmail:    r.data.ownerEmail,
        ownerPassword: r.data.ownerPassword,
        created:       r.data.created,
      });
      toast.success(r.data.created ? 'Demo tenant provisioned.' : 'Already exists; credentials reused.');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed.');
    } finally {
      setProvisioning(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <section className="rounded-xl border border-border bg-card p-4 space-y-1">
        <h2 className="text-sm font-semibold">Demo tenants</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Provision realistic demo tenants for any of the 12 supported business types. Each demo gets a fresh
          owner login, default plan, and seed catalog. Re-running on an existing demo just returns the existing
          tenant (idempotent).
        </p>
      </section>

      {lastResult && lastResult.ownerPassword && (
        <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            New demo provisioned — copy credentials now (not shown again)
          </div>
          <div className="font-mono text-xs space-y-0.5">
            <div>Email:    <span className="font-semibold">{lastResult.ownerEmail}</span></div>
            <div>Password: <span className="font-semibold">{lastResult.ownerPassword}</span></div>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${lastResult.ownerEmail} / ${lastResult.ownerPassword}`);
              toast.success('Copied.');
            }}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-emerald-500/40 hover:bg-emerald-500/20"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </section>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {scenarios.map((s) => (
          <div key={s.key} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{s.label}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
                  {s.businessType.replace(/_/g, ' ')}
                </div>
                <div className="text-xs text-muted-foreground mt-1.5">{s.tenantName}</div>
                <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{s.planCode}</div>
              </div>
              <button
                onClick={() => provision(s.key)}
                disabled={provisioning !== null}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {provisioning === s.key ? '…' : <><Sparkles className="h-3 w-3" /> Provision</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── About tab ───────────────────────────────────────────────────────────────

function AboutTab() {
  return (
    <div className="max-w-2xl space-y-3">
      <section className="rounded-xl border border-border bg-card p-5 space-y-2 text-sm">
        <h2 className="text-sm font-semibold">Clerque platform</h2>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="text-muted-foreground">Build</div>
          <div className="font-mono">Sprint 15 — POS-native subscription billing</div>
          <div className="text-muted-foreground">Privacy invariant</div>
          <div>Console reads only HNS Corp tenant data + master config. Tenant business data is never surfaced here.</div>
          <div className="text-muted-foreground">Receipt format</div>
          <div>Auto-selected by HNS Corp&rsquo;s tax status — Acknowledgement Receipt (UNREGISTERED), Sales Invoice / Official Receipt (NON_VAT / VAT).</div>
        </div>
      </section>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, v, on, type = 'text', placeholder, mono }: {
  label: string; v: string; on: (v: string) => void;
  type?: string; placeholder?: string; mono?: boolean;
}) {
  return (
    <label className="text-sm block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => on(e.target.value)}
        placeholder={placeholder}
        className={'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ' + (mono ? 'font-mono' : '')}
      />
    </label>
  );
}
