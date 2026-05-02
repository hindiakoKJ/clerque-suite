'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Building2, Search, ChevronRight, Plus, X, Eye, EyeOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from 'sonner';

interface TenantRow {
  id: string; slug: string; name: string;
  status:       'ACTIVE' | 'GRACE' | 'SUSPENDED';
  tier:         string;
  businessType: string;
  contactEmail: string | null;
  isDemoTenant: boolean;
  createdAt:    string;
  _count:       { users: number; branches: number };
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700',
  GRACE:     'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-red-100 text-red-700',
};

const BUSINESS_TYPES = ['RETAIL', 'FNB', 'SERVICE', 'MFG'] as const;
const TIERS = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5', 'TIER_6'] as const;
const ROLES = [
  'BUSINESS_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD',
  'BOOKKEEPER', 'ACCOUNTANT', 'FINANCE_LEAD', 'PAYROLL_MASTER',
  'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE', 'EXTERNAL_AUDITOR',
  'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
] as const;

function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  const days = Math.floor(ms / 86_400_000);
  if (days <= 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/* ─── Add Tenant Modal ──────────────────────────────────────────────────────── */

interface CreatedResult { tenantId: string; slug: string; ownerUserId: string; generatedPassword: string }

function AddTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: CreatedResult) => void }) {
  const [form, setForm] = useState({
    name: '', slug: '', businessType: 'RETAIL' as typeof BUSINESS_TYPES[number],
    tier: 'TIER_1' as typeof TIERS[number],
    ownerName: '', ownerEmail: '',
    contactEmail: '', contactPhone: '',
  });
  const [busy, setBusy] = useState(false);

  function set(key: keyof typeof form, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
    // Auto-generate slug from name if user hasn't typed one
    if (key === 'name' && !form.slug) {
      setForm((f) => ({ ...f, name: val, slug: val.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') }));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post<CreatedResult>('/admin/tenants', form);
      onCreated(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to create tenant.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm">New Tenant</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-muted-foreground mb-1">Business Name *</label>
              <input required value={form.name} onChange={(e) => set('name', e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Company Code (slug) *</label>
              <input required value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                placeholder="e.g. juan-bakery"
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-mono" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Used as Tenant ID at login. Lowercase, hyphens only.</p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Business Type *</label>
              <select required value={form.businessType} onChange={(e) => set('businessType', e.target.value as typeof form.businessType)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm">
                {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Subscription Tier *</label>
              <select required value={form.tier} onChange={(e) => set('tier', e.target.value as typeof form.tier)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm">
                {TIERS.map((t) => <option key={t} value={t}>{t.replace('TIER_', 'Tier ')}</option>)}
              </select>
            </div>
            <div className="col-span-2 border-t border-border pt-3">
              <p className="text-xs font-medium mb-2">Business Owner</p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Owner Name *</label>
              <input required value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Owner Email *</label>
              <input required type="email" value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Contact Email</label>
              <input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)}
                placeholder="Defaults to owner email"
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Contact Phone</label>
              <input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)}
                placeholder="+63 9XX XXX XXXX"
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose}
              className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted">Cancel</button>
            <button type="submit" disabled={busy}
              className="h-9 px-4 rounded-md text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}>
              {busy ? 'Creating…' : 'Create Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Password reveal modal ─────────────────────────────────────────────────── */

function PasswordRevealModal({ result, onClose }: { result: CreatedResult; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(result.generatedPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-sm">Tenant created</p>
              <p className="text-[11px] text-muted-foreground font-mono">{result.slug}</p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
            <p className="font-semibold">⚠ Save this password — it won't be shown again.</p>
            <p>Share it securely with the business owner. They should change it on first login.</p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Owner Login Credentials</p>
            <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tenant ID</span>
                <span className="font-medium">{result.slug}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Password</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium tracking-widest">
                    {shown ? result.generatedPassword : '•'.repeat(result.generatedPassword.length)}
                  </span>
                  <button onClick={() => setShown((v) => !v)} className="text-muted-foreground hover:text-foreground">
                    {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={copy}
              className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted">
              {copied ? '✓ Copied' : 'Copy Password'}
            </button>
            <button onClick={onClose}
              className="h-9 px-4 rounded-md text-sm font-medium text-white"
              style={{ background: 'var(--accent)' }}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function TenantsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [created, setCreated] = useState<CreatedResult | null>(null);

  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (statusFilter)  params.set('status', statusFilter);

  const isSuper = !!(user?.isSuperAdmin || user?.role === 'SUPER_ADMIN');

  const { data, isLoading } = useQuery<TenantRow[]>({
    queryKey: ['admin-tenants', search, statusFilter],
    queryFn:  () => api.get(`/admin/tenants?${params}`).then((r) => r.data),
    enabled:  isSuper,
  });

  function handleCreated(r: CreatedResult) {
    setShowAdd(false);
    setCreated(r);
    qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    toast.success(`Tenant "${r.slug}" created.`);
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      {showAdd && <AddTenantModal onClose={() => setShowAdd(false)} onCreated={handleCreated} />}
      {created  && <PasswordRevealModal result={created} onClose={() => setCreated(null)} />}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[var(--accent)]" />
            Tenants
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Click a row to manage users, reset passwords, change tier, or suspend.
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium text-white shrink-0"
          style={{ background: 'var(--accent)' }}>
          <Plus className="w-4 h-4" /> Add Tenant
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground block mb-1">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, slug, email…"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm" />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 rounded-md border border-border bg-background text-sm">
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="GRACE">Grace</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <Spinner size="lg" message="Loading tenants…" />
      ) : (data?.length ?? 0) === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
          No tenants match the filter.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left p-2.5">Tenant</th>
                <th className="text-left p-2.5 w-22">Status</th>
                <th className="text-left p-2.5 w-20">Tier</th>
                <th className="text-left p-2.5 w-24">Type</th>
                <th className="text-right p-2.5 w-16">Users</th>
                <th className="text-left p-2.5 w-40">Contact</th>
                <th className="text-left p-2.5 w-24">Created</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((t) => (
                <tr key={t.id}
                  onClick={() => router.push(`/admin/tenants/${t.id}`)}
                  className="border-t border-border hover:bg-muted/30 cursor-pointer">
                  <td className="p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      {t.isDemoTenant && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">DEMO</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono">{t.slug}</div>
                  </td>
                  <td className="p-2.5">
                    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[t.status]}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="p-2.5 text-xs font-mono">{t.tier?.replace('TIER_', 'T')}</td>
                  <td className="p-2.5 text-xs text-muted-foreground">{t.businessType}</td>
                  <td className="p-2.5 text-right tabular-nums text-xs">{t._count.users}</td>
                  <td className="p-2.5 text-xs text-muted-foreground truncate max-w-[160px]">
                    {t.contactEmail ?? '—'}
                  </td>
                  <td className="p-2.5 text-xs text-muted-foreground">{timeAgo(t.createdAt)}</td>
                  <td className="px-2"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
