'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Building2, Users, Plus, RotateCcw, LogOut,
  ShieldOff, ShieldCheck, Eye, EyeOff, X, AlertTriangle,
  CheckCircle, Clock, Copy, Pencil, FlaskConical, RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TenantDetail {
  id: string; slug: string; name: string;
  status:       'ACTIVE' | 'GRACE' | 'SUSPENDED';
  tier:         string;
  businessType: string;
  taxStatus:    string;
  isBirRegistered: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  address:      string | null;
  tinNumber:    string | null;
  businessName: string | null;
  isDemoTenant: boolean;
  signupSource: string;
  createdAt:    string;
  aiAddonType:  string | null;
  aiQuotaOverride: number | null;
  aiAddonExpiresAt: string | null;
  /** Sprint 3 — coffee-shop floor-layout tier (only meaningful when businessType=COFFEE_SHOP) */
  coffeeShopTier?: 'CS_1' | 'CS_2' | 'CS_3' | 'CS_4' | 'CS_5' | null;
  _count: { users: number; branches: number; products: number };
}

interface TenantUser {
  id:             string;
  name:           string;
  email:          string;
  role:           string;
  isActive:       boolean;
  isLocked:       boolean;
  lastLoginAt:    string | null;
  activeSessions: number;
  createdAt:      string;
}

const STATUS_OPTIONS  = ['ACTIVE', 'GRACE', 'SUSPENDED'] as const;
const TIER_OPTIONS    = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5', 'TIER_6'] as const;
// BusinessType must exactly match the Prisma enum values in schema.prisma
const BIZ_TYPES = [
  'COFFEE_SHOP', 'RESTAURANT', 'BAKERY', 'FOOD_STALL', 'BAR_LOUNGE', 'CATERING',
  'RETAIL', 'SERVICE', 'MANUFACTURING',
] as const;
const BIZ_LABEL: Record<string, string> = {
  COFFEE_SHOP:   'Coffee Shop / Café',
  RESTAURANT:    'Restaurant',
  BAKERY:        'Bakery / Pastry',
  FOOD_STALL:    'Food Stall / Carinderia',
  BAR_LOUNGE:    'Bar / Lounge',
  CATERING:      'Catering',
  RETAIL:        'Retail',
  SERVICE:       'Service',
  MANUFACTURING: 'Manufacturing',
};
const TAX_STATUSES    = ['VAT', 'NON_VAT', 'UNREGISTERED'] as const;
const ROLES = [
  'BUSINESS_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD',
  'BOOKKEEPER', 'ACCOUNTANT', 'FINANCE_LEAD', 'PAYROLL_MASTER',
  'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE', 'EXTERNAL_AUDITOR',
  'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
] as const;

const DEMO_SCENARIOS = [
  { key: 'COFFEE_SHOP', label: 'Coffee Shop (Brew & Co.)',            biz: 'F&B',    tax: 'VAT'         },
  { key: 'BAKERY',      label: 'Bakery (La Panaderia)',               biz: 'F&B',    tax: 'NON_VAT'     },
  { key: 'SARI_SARI',   label: 'Sari-Sari Store (Corner Mart)',       biz: 'Retail', tax: 'UNREGISTERED' },
  { key: 'RESTAURANT',  label: 'Filipino Restaurant (Casa de Manila)', biz: 'F&B',   tax: 'VAT'         },
  { key: 'BOUTIQUE',    label: 'Fashion Boutique (Luxe MNL)',          biz: 'Retail', tax: 'VAT'         },
] as const;

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700',
  GRACE:     'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-red-100 text-red-700',
};

const ROLE_BADGE: Record<string, string> = {
  BUSINESS_OWNER: 'bg-violet-100 text-violet-700',
  BRANCH_MANAGER: 'bg-blue-100 text-blue-700',
  CASHIER:        'bg-sky-100 text-sky-700',
  SALES_LEAD:     'bg-cyan-100 text-cyan-700',
  PAYROLL_MASTER: 'bg-pink-100 text-pink-700',
  ACCOUNTANT:     'bg-teal-100 text-teal-700',
  BOOKKEEPER:     'bg-teal-100 text-teal-700',
  FINANCE_LEAD:   'bg-teal-100 text-teal-700',
  MDM:            'bg-orange-100 text-orange-700',
  WAREHOUSE_STAFF:'bg-yellow-100 text-yellow-700',
  GENERAL_EMPLOYEE:'bg-slate-100 text-slate-600',
  EXTERNAL_AUDITOR:'bg-gray-100 text-gray-600',
  AR_ACCOUNTANT:  'bg-indigo-100 text-indigo-700',
  AP_ACCOUNTANT:  'bg-indigo-100 text-indigo-700',
};

function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  const days = Math.floor(ms / 86_400_000);
  return days <= 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

// ─── Edit Profile Modal ──────────────────────────────────────────────────────

function EditProfileModal({ tenant, onClose, onSaved }: {
  tenant: TenantDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name:           tenant.name,
    businessName:   tenant.businessName ?? '',
    businessType:   tenant.businessType,
    taxStatus:      tenant.taxStatus,
    tinNumber:      tenant.tinNumber ?? '',
    isBirRegistered: tenant.isBirRegistered,
    contactEmail:   tenant.contactEmail ?? '',
    contactPhone:   tenant.contactPhone ?? '',
    address:        tenant.address ?? '',
    isDemoTenant:   tenant.isDemoTenant,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/admin/tenants/${tenant.id}/profile`, {
        name:           form.name.trim() || undefined,
        businessName:   form.businessName.trim() || null,
        businessType:   form.businessType,
        taxStatus:      form.taxStatus,
        tinNumber:      form.tinNumber.trim() || null,
        isBirRegistered: form.isBirRegistered,
        contactEmail:   form.contactEmail.trim() || null,
        contactPhone:   form.contactPhone.trim() || null,
        address:        form.address.trim() || null,
        isDemoTenant:   form.isDemoTenant,
      });
      toast.success('Tenant profile updated.');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to update profile.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm">Edit Tenant Profile</h2>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Business Name (Display)</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Registered Business Name</label>
              <input value={form.businessName} onChange={(e) => set('businessName', e.target.value)}
                placeholder="For BIR receipts"
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Business Type</label>
              <select value={form.businessType} onChange={(e) => set('businessType', e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm">
                {BIZ_TYPES.map((b) => <option key={b} value={b}>{BIZ_LABEL[b] ?? b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Tax Status</label>
              <select value={form.taxStatus} onChange={(e) => set('taxStatus', e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm">
                {TAX_STATUSES.map((t) => <option key={t} value={t}>{t.replace('_', '-')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">TIN</label>
              <input value={form.tinNumber} onChange={(e) => set('tinNumber', e.target.value)}
                placeholder="000-000-000-000"
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Contact Email</label>
              <input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Contact Phone</label>
              <input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)}
                placeholder="+63 9xx xxx xxxx"
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Address</label>
            <input value={form.address} onChange={(e) => set('address', e.target.value)}
              placeholder="Street, City, Province"
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
          </div>
          {/* Toggles */}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={form.isBirRegistered}
                onChange={(e) => set('isBirRegistered', e.target.checked)}
                className="w-3.5 h-3.5 rounded" />
              BIR Registered
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={form.isDemoTenant}
                onChange={(e) => set('isDemoTenant', e.target.checked)}
                className="w-3.5 h-3.5 rounded" />
              Demo Tenant
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose}
              className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted">Cancel</button>
            <button type="submit" disabled={busy}
              className="h-9 px-4 rounded-md text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}>
              {busy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Demo Reset Modal ────────────────────────────────────────────────────────

function DemoResetModal({ tenantId, onClose, onDone }: {
  tenantId: string;
  onClose:  () => void;
  onDone:   (result: { scenario: string; productsSeeded: number; ordersGenerated: number }) => void;
}) {
  const [scenario, setScenario] = useState<string>(DEMO_SCENARIOS[0].key);
  const [busy, setBusy] = useState(false);
  const picked = DEMO_SCENARIOS.find((s) => s.key === scenario)!;

  async function confirm() {
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/tenants/${tenantId}/reset-demo`, { scenario });
      onDone(data);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Demo reset failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-fuchsia-500" />
            Reset Demo Data
          </h2>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="p-4 space-y-4">
          {/* Destructive warning */}
          <div className="rounded-lg border border-red-300/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-400 space-y-1">
            <p className="font-semibold">⚠ Destructive — this cannot be undone.</p>
            <p>All existing orders, products, categories, and inventory will be wiped and replaced with fresh demo data for the selected business type.</p>
          </div>

          {/* Scenario picker */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Choose a business scenario</label>
            <div className="space-y-2">
              {DEMO_SCENARIOS.map((s) => (
                <label key={s.key}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                    ${scenario === s.key
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-border hover:bg-muted/40'}`}>
                  <input type="radio" name="scenario" value={s.key}
                    checked={scenario === s.key} onChange={() => setScenario(s.key)}
                    className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {s.biz} · {s.tax.replace('_', '-')}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2.5 space-y-0.5">
            <p>✓ Categories &amp; products seeded from real PH market prices</p>
            <p>✓ 20 historical orders spread across the last 7 days</p>
            <p>✓ Tenant businessType → <strong>{picked.biz}</strong> · taxStatus → <strong>{picked.tax.replace('_', '-')}</strong></p>
            <p>✓ Tenant flagged as Demo Tenant</p>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button onClick={onClose}
              className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted">Cancel</button>
            <button onClick={confirm} disabled={busy}
              className="h-9 px-4 rounded-md text-sm font-medium text-white disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: 'hsl(300 65% 45%)' }}>
              {busy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Resetting…</> : '🔄 Reset Demo Data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Add User Modal ──────────────────────────────────────────────────────────

interface UserCreated { userId: string; generatedPassword: string }

function AddUserModal({ tenantId, onClose, onCreated }: {
  tenantId: string;
  onClose: () => void;
  onCreated: (r: UserCreated) => void;
}) {
  const [form, setForm] = useState({ name: '', email: '', role: 'CASHIER' as string });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const { data } = await api.post<UserCreated>(`/admin/tenants/${tenantId}/users`, form);
      onCreated(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to add user.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm">Add User to Tenant</h2>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Full Name *</label>
            <input required value={form.name} onChange={(e) => set('name', e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Email *</label>
            <input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Role *</label>
            <select required value={form.role} onChange={(e) => set('role', e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm">
              {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A secure password will be generated. You'll see it once after creation.
          </p>
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <button type="button" onClick={onClose}
              className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted">Cancel</button>
            <button type="submit" disabled={busy}
              className="h-9 px-4 rounded-md text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}>
              {busy ? 'Adding…' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Password reveal modal ───────────────────────────────────────────────────

function PasswordModal({ password, email, onClose }: { password: string; email?: string; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-700 dark:text-amber-400">
          <p className="font-semibold mb-0.5">⚠ Save this — it won't be shown again.</p>
          <p>Share it securely with the user. They should change it on first login.</p>
        </div>

        {email && (
          <div className="text-xs text-muted-foreground">
            For: <span className="font-medium text-foreground">{email}</span>
          </div>
        )}

        <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 font-mono text-sm flex items-center justify-between gap-3">
          <span className="tracking-widest flex-1">{shown ? password : '•'.repeat(password.length)}</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShown((v) => !v)} className="text-muted-foreground hover:text-foreground">
              {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button onClick={copy} className="text-muted-foreground hover:text-foreground">
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
        {copied && <p className="text-xs text-emerald-600 text-center">Copied to clipboard</p>}

        <button onClick={onClose} className="w-full h-9 rounded-md text-sm font-medium text-white"
          style={{ background: 'var(--accent)' }}>
          Done — I've saved the password
        </button>
      </div>
    </div>
  );
}

// ─── User row actions ────────────────────────────────────────────────────────

function UserActionsMenu({ user, tenantId, onRefresh }: {
  user: TenantUser; tenantId: string; onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pwResult, setPwResult] = useState<{ password: string; email: string } | null>(null);

  async function action(type: string, path: string, method: 'post' | 'patch' = 'post', label = type) {
    setBusy(type);
    try {
      const fn = method === 'patch' ? api.patch : api.post;
      const { data } = await fn(`/admin/users/${user.id}/${path}`);
      if (type === 'reset') {
        setPwResult({ password: data.generatedPassword, email: user.email });
      } else {
        toast.success(`${label} successful.`);
      }
      onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? `${label} failed.`);
    } finally { setBusy(null); }
  }

  return (
    <>
      {pwResult && (
        <PasswordModal password={pwResult.password} email={pwResult.email} onClose={() => setPwResult(null)} />
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <ActionBtn
          icon={RotateCcw} label="Reset PW" loading={busy === 'reset'} danger
          onClick={() => action('reset', 'reset-password', 'post', 'Password reset')} />
        {user.isLocked && (
          <ActionBtn
            icon={ShieldCheck} label="Unlock" loading={busy === 'unlock'}
            onClick={() => action('unlock', 'clear-lockout', 'post', 'Account unlocked')} />
        )}
        {user.activeSessions > 0 && (
          <ActionBtn
            icon={LogOut} label="Force logout" loading={busy === 'logout'} danger
            onClick={() => action('logout', 'force-logout', 'post', 'Forced logout')} />
        )}
        <ActionBtn
          icon={user.isActive ? ShieldOff : ShieldCheck}
          label={user.isActive ? 'Deactivate' : 'Reactivate'}
          loading={busy === 'toggle'}
          danger={user.isActive}
          onClick={() => action('toggle', 'toggle-active', 'patch', user.isActive ? 'Deactivated' : 'Reactivated')} />
      </div>
    </>
  );
}

function ActionBtn({ icon: Icon, label, onClick, loading, danger }: {
  icon: React.ElementType; label: string; onClick: () => void; loading?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={loading}
      title={label}
      className={`inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] border transition disabled:opacity-40
        ${danger
          ? 'border-red-300/60 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}>
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [showAddUser,    setShowAddUser]    = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showDemoReset,  setShowDemoReset]  = useState(false);
  const [pwModal, setPwModal] = useState<{ password: string; email: string } | null>(null);

  const isSuper = !!(user?.isSuperAdmin || user?.role === 'SUPER_ADMIN');

  const { data: tenant, isLoading: tenantLoading, refetch: refetchTenant } = useQuery<TenantDetail>({
    queryKey: ['admin-tenant-detail', id],
    queryFn:  () => api.get(`/admin/tenants/${id}`).then((r) => r.data),
    enabled:  isSuper,
  });

  const { data: users, isLoading: usersLoading, refetch: refetchUsers } = useQuery<TenantUser[]>({
    queryKey: ['admin-tenant-users', id],
    queryFn:  () => api.get(`/admin/tenants/${id}/users`).then((r) => r.data),
    enabled:  isSuper,
  });

  if (tenantLoading || !tenant) return <Spinner size="lg" message="Loading tenant…" />;

  function invalidateTenant() {
    qc.invalidateQueries({ queryKey: ['admin-tenant-detail', id] });
    qc.invalidateQueries({ queryKey: ['admin-tenants'] });
  }

  async function patchTenant(path: string, body: object, label: string) {
    setBusy(true);
    try {
      await api.patch(`/admin/tenants/${id}/${path}`, body);
      toast.success(`${label} updated.`);
      invalidateTenant();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? `Failed to update ${label}`);
    } finally { setBusy(false); }
  }

  const lockedCount   = users?.filter((u) => u.isLocked).length ?? 0;
  const inactiveCount = users?.filter((u) => !u.isActive).length ?? 0;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Modals */}
      {showAddUser && (
        <AddUserModal tenantId={id} onClose={() => setShowAddUser(false)}
          onCreated={(r) => {
            setShowAddUser(false);
            const u = users?.find((x) => x.id === r.userId);
            setPwModal({ password: r.generatedPassword, email: u?.email ?? '' });
            refetchUsers();
            toast.success('User added.');
          }} />
      )}
      {pwModal && <PasswordModal password={pwModal.password} email={pwModal.email} onClose={() => setPwModal(null)} />}
      {showEditProfile && (
        <EditProfileModal
          tenant={tenant}
          onClose={() => setShowEditProfile(false)}
          onSaved={() => { invalidateTenant(); refetchTenant(); }}
        />
      )}
      {showDemoReset && (
        <DemoResetModal
          tenantId={id}
          onClose={() => setShowDemoReset(false)}
          onDone={(result) => {
            toast.success(`Demo reset done — ${result.productsSeeded} products + ${result.ordersGenerated} orders seeded for ${result.scenario}.`);
            invalidateTenant();
            refetchTenant();
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={() => router.push('/admin/tenants')}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3">
            <ArrowLeft className="w-3 h-3" /> Back to tenants
          </button>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[var(--accent)]" />
            {tenant.name}
            {tenant.isDemoTenant && (
              <span className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">DEMO</span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {tenant.slug} · {tenant.id}
          </p>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-semibold ${STATUS_BADGE[tenant.status]}`}>
          {tenant.status}
        </span>
      </div>

      {/* Account health bar */}
      {(lockedCount > 0 || inactiveCount > 0) && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {lockedCount > 0 && <strong>{lockedCount} locked account{lockedCount > 1 ? 's' : ''}</strong>}
            {lockedCount > 0 && inactiveCount > 0 && ' · '}
            {inactiveCount > 0 && <strong>{inactiveCount} inactive</strong>}
            {' '}— see user table below.
          </span>
        </div>
      )}

      {/* Profile + controls side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Tenant Profile */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tenant Profile</h2>
            <button
              onClick={() => setShowEditProfile(true)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition">
              <Pencil className="w-3 h-3" /> Edit
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Field label="Business Name"  value={tenant.businessName ?? tenant.name} />
            <Field label="Company Code"   value={tenant.slug} mono />
            <Field label="Business Type"  value={tenant.businessType} />
            <Field label="Tax Status"     value={tenant.taxStatus.replace('_', '-')} />
            <Field label="BIR Registered" value={tenant.isBirRegistered ? 'Yes' : 'No'} />
            <Field label="TIN"            value={tenant.tinNumber ?? '—'} mono />
            <Field label="Contact Email"  value={tenant.contactEmail ?? '—'} />
            <Field label="Contact Phone"  value={tenant.contactPhone ?? '—'} />
            <Field label="Address"        value={tenant.address ?? '—'} />
            <Field label="Signup Source"  value={tenant.signupSource} />
            <Field label="Branches"       value={String(tenant._count.branches)} />
            <Field label="Products"       value={String(tenant._count.products)} />
            <Field label="Created"        value={new Date(tenant.createdAt).toLocaleDateString('en-PH', { dateStyle: 'long' })} />
          </div>
        </div>

        {/* Admin Controls */}
        <div className="space-y-3">
          {/* Status */}
          <div className="rounded-lg border border-border bg-background p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Account Status</h2>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.filter((s) => s !== tenant.status).map((s) => (
                <button key={s} disabled={busy}
                  onClick={() => patchTenant('status', { status: s }, `Status → ${s}`)}
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50">
                  Set {s}
                </button>
              ))}
            </div>
          </div>

          {/* Tier */}
          <div className="rounded-lg border border-border bg-background p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Subscription Tier</h2>
            <p className="text-xs text-muted-foreground mb-2">Current: <span className="font-mono font-medium text-foreground">{tenant.tier}</span></p>
            <select disabled={busy}
              defaultValue={tenant.tier}
              onChange={(e) => patchTenant('tier', { tier: e.target.value }, `Tier → ${e.target.value}`)}
              className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs">
              {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t.replace('TIER_', 'Tier ')}</option>)}
            </select>
          </div>

          {/* Coffee Shop Floor Layout — only relevant for COFFEE_SHOP tenants */}
          {tenant.businessType === 'COFFEE_SHOP' && (
            <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 p-4">
              <h2 className="text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase tracking-wider mb-2">
                ☕ Floor Layout
              </h2>
              <p className="text-[11px] text-muted-foreground mb-2">
                Sales-controlled. Provisions stations, printers, and terminals.
                Idempotent — preserves owner-renamed stations.
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                Current: <span className="font-mono font-medium text-foreground">{tenant.coffeeShopTier ?? 'Not set'}</span>
              </p>
              <select
                disabled={busy}
                value={tenant.coffeeShopTier ?? ''}
                onChange={async (e) => {
                  const tier = e.target.value;
                  if (!tier) return;
                  if (!confirm(`Apply ${tier} layout to this tenant? This will provision stations and printers.`)) return;
                  try {
                    setBusy(true);
                    await api.patch(`/admin/tenants/${tenant.id}/coffee-shop-tier`, { tier });
                    toast.success(`Layout set to ${tier}.`);
                    qc.invalidateQueries({ queryKey: ['tenant-detail', tenant.id] });
                  } catch (err: unknown) {
                    toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to apply layout.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs"
              >
                <option value="">— choose tier —</option>
                <option value="CS_1">CS-1 — Solo Counter</option>
                <option value="CS_2">CS-2 — Counter + Display</option>
                <option value="CS_3">CS-3 — Counter + Bar</option>
                <option value="CS_4">CS-4 — Bar + Kitchen</option>
                <option value="CS_5">CS-5 — Multi-Station Chain</option>
              </select>
            </div>
          )}

          {/* AI */}
          <div className="rounded-lg border border-border bg-background p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">AI Quota Override</h2>
            <input type="number" min={0} max={100000}
              defaultValue={tenant.aiQuotaOverride ?? ''}
              placeholder="(tier default)"
              onBlur={(e) => {
                const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                patchTenant('ai-override', { quotaOverride: v, addonType: tenant.aiAddonType }, 'AI quota');
              }}
              disabled={busy}
              className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs" />
            <p className="text-[10px] text-muted-foreground mt-1">0 = kill switch · blank = tier default</p>
          </div>

          {/* Demo Data Reset */}
          <div className="rounded-lg border border-fuchsia-200/60 bg-fuchsia-50/40 dark:bg-fuchsia-950/20 p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <FlaskConical className="w-3.5 h-3.5 text-fuchsia-600" />
              <h2 className="text-xs font-semibold text-fuchsia-700 dark:text-fuchsia-400 uppercase tracking-wider">Demo Data</h2>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Wipe and reseed with realistic PH MSME data for any business type. Use for demos and client presentations.
            </p>
            <button
              onClick={() => setShowDemoReset(true)}
              className="w-full flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-fuchsia-300/60 text-fuchsia-700 dark:text-fuchsia-400 hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/30 transition">
              <RefreshCw className="w-3 h-3" />
              Reset Demo Data…
            </button>
          </div>

          {/* Seed Coffee Shop Ingredients */}
          <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <FlaskConical className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              <h2 className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                Coffee Shop Ingredient Pack
              </h2>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Insert ~110 master ingredients (coffee beans, milks, syrups, cups, etc.)
              with PH market cost prices, opening stock, and low-stock alerts.
              <span className="block mt-1 italic">
                Idempotent — existing ingredients (by name) are skipped.
              </span>
            </p>
            <button
              onClick={async () => {
                if (!confirm('Add the master coffee-shop ingredient catalogue (~110 items) to this tenant? Existing ingredients are skipped (no duplicates).')) return;
                try {
                  setBusy(true);
                  const { data } = await api.post<{ created: number; skipped: number; total: number }>(
                    `/admin/tenants/${tenant.id}/seed-coffee-shop-ingredients`,
                  );
                  toast.success(
                    `Seed complete: ${data.created} created, ${data.skipped} skipped (${data.total} total).`,
                  );
                  qc.invalidateQueries({ queryKey: ['tenant-detail', tenant.id] });
                } catch (err: unknown) {
                  toast.error(
                    (err as { response?: { data?: { message?: string } } })?.response?.data?.message
                    ?? 'Failed to seed ingredients.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="w-full flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-amber-300/60 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition disabled:opacity-50"
            >
              <FlaskConical className="w-3 h-3" />
              Seed Ingredients…
            </button>
          </div>

          {/* Clear All Data — empty slate, no re-seed */}
          <div className="rounded-lg border border-red-200/60 bg-red-50/40 dark:bg-red-950/20 p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <ShieldOff className="w-3.5 h-3.5 text-red-600" />
              <h2 className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">Clear All Data</h2>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Empty slate — wipes products, ingredients, orders, journal entries.
              Keeps tenant, users, branches, floor layout. Use when onboarding
              a real tenant who wants to start clean.
            </p>
            <button
              onClick={async () => {
                if (!confirm('Wipe ALL products, ingredients, orders, and journal entries for this tenant? Users + branches + layout will be preserved. Cannot be undone.')) return;
                try {
                  setBusy(true);
                  await api.post(`/admin/tenants/${tenant.id}/clear-data`);
                  toast.success('All data cleared. Tenant now has an empty slate.');
                  qc.invalidateQueries({ queryKey: ['tenant-detail', tenant.id] });
                } catch (err: unknown) {
                  toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to clear data.');
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="w-full flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-red-300/60 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition disabled:opacity-50">
              <ShieldOff className="w-3 h-3" />
              Clear All Data…
            </button>
          </div>
        </div>
      </div>

      {/* Users table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="font-semibold text-sm">Users ({tenant._count.users})</h2>
          </div>
          <button onClick={() => setShowAddUser(true)}
            className="flex items-center gap-1 h-8 px-3 rounded-md text-xs font-medium text-white"
            style={{ background: 'var(--accent)' }}>
            <Plus className="w-3.5 h-3.5" /> Add User
          </button>
        </div>

        {usersLoading ? (
          <Spinner size="sm" message="Loading users…" />
        ) : (users?.length ?? 0) === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            No users yet.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left p-2.5">Name / Email</th>
                  <th className="text-left p-2.5 w-36">Role</th>
                  <th className="text-left p-2.5 w-24">Status</th>
                  <th className="text-left p-2.5 w-24">Last Login</th>
                  <th className="text-left p-2.5 w-24">Sessions</th>
                  <th className="text-left p-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="p-2.5">
                      <div className="font-medium">{u.name}</div>
                      <div className="text-[11px] text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="p-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ROLE_BADGE[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                        {u.role.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-2.5">
                      {u.isLocked ? (
                        <span className="flex items-center gap-1 text-[11px] text-red-600">
                          <AlertTriangle className="w-3 h-3" /> Locked
                        </span>
                      ) : u.isActive ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                          <CheckCircle className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ShieldOff className="w-3 h-3" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {timeAgo(u.lastLoginAt)}
                      </span>
                    </td>
                    <td className="p-2.5 text-xs text-muted-foreground tabular-nums">
                      {u.activeSessions} active
                    </td>
                    <td className="p-2.5">
                      <UserActionsMenu user={u} tenantId={id} onRefresh={refetchUsers} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`font-medium text-foreground ${mono ? 'font-mono text-xs' : 'text-sm'} break-all`}>{value}</p>
    </div>
  );
}
