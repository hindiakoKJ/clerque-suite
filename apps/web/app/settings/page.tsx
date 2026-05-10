'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Building2, Users, ArrowLeft, Lock,
  Plus, X, CheckCircle2, XCircle, RotateCcw,
  ChevronDown, Shield, FileText, AlertTriangle, Info,
  KeyRound, Eye, EyeOff, ShieldCheck,
  LayoutGrid, CreditCard, ShieldAlert, ChevronRight, Sparkles,
  Stamp, Tv, FileSpreadsheet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isFnbType, isLaundryType, planLabel, getVerticalPack, type PlanCode } from '@repo/shared-types';
import * as Icons from 'lucide-react';
import { api } from '@/lib/api';
import { downloadAuthFile } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'tax' | 'users' | 'security';
type TaxStatus = 'VAT' | 'NON_VAT' | 'UNREGISTERED';

interface TenantProfile {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  tin: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  /** Legacy SubscriptionTier (TIER_1..TIER_6). Retained for backward compat;
   *  not authoritative — read planCode instead. */
  tier?: string;
  /** Modular pricing — authoritative plan identifier. */
  planCode?: PlanCode | null;
  modulePos?: boolean;
  moduleLedger?: boolean;
  modulePayroll?: boolean;
  // Sprint 4A + 6 — costing settings
  valuationMethod?:     'WAC' | 'FIFO' | null;
  firstTransactionAt?:  string | null;
  overheadRatePerUnit?: number | string | null;
  // Sprint 12 — accounting basis (CASH vs ACCRUAL). Console-controlled.
  accountingMethod?:    'CASH' | 'ACCRUAL' | null;
  // Sprint 19 — receipt template (owner-editable from Settings).
  receiptHeaderNote?:   string | null;
  receiptFooterNote?:   string | null;
  receiptLogoUrl?:      string | null;
  // Sprint 19 — returns/refunds owner-only policy.
  returnsOwnerOnly?:    boolean | null;
}

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  branch: { id: string; name: string } | null;
}

const ROLES = [
  // ── Management ──────────────────────────────────────────────────────────────
  {
    value: 'BUSINESS_OWNER',
    label: 'Business Owner',
    desc:  'Full access to all modules. Supervisor — cannot operate the register. Can manage all staff, payroll, and financial data.',
  },
  {
    value: 'BRANCH_MANAGER',
    label: 'Branch Manager',
    desc:  'Oversight of POS orders, inventory, and branch reports. Supervisor — cannot open shifts. No payroll or ledger access.',
  },
  // ── POS / Operations ────────────────────────────────────────────────────────
  {
    value: 'SALES_LEAD',
    label: 'Sales Lead',
    desc:  'Opens and closes shifts, voids orders, applies manager-level discounts. Also manages timesheets for their team.',
  },
  {
    value: 'CASHIER',
    label: 'Cashier',
    desc:  'Operates the POS register — open shifts, ring up sales, process payments. No management access.',
  },
  // ── Master Data / Stock ──────────────────────────────────────────────────────
  {
    value: 'MDM',
    label: 'Master Data Manager',
    desc:  'Creates and edits products, categories, pricing, inventory, and UoM. No financial reports or payroll access.',
  },
  {
    value: 'WAREHOUSE_STAFF',
    label: 'Warehouse Staff',
    desc:  'Stock adjustments and goods receiving only. Cannot edit product pricing or access financial data.',
  },
  // ── Finance / Accounting ─────────────────────────────────────────────────────
  {
    value: 'FINANCE_LEAD',
    label: 'Finance Lead',
    desc:  'Cash-flow reports, bank reconciliation, and inventory valuation. Read access to ledger. No payroll or journal entry creation.',
  },
  {
    value: 'BOOKKEEPER',
    label: 'Bookkeeper',
    desc:  'Creates journal entries and manages the general ledger. No payroll, no product pricing, no period close.',
  },
  {
    value: 'ACCOUNTANT',
    label: 'Accountant',
    desc:  'Full read access to the ledger, trial balance, and journal. Can post and reverse entries. No payroll access.',
  },
  // ── Payroll ──────────────────────────────────────────────────────────────────
  {
    value: 'PAYROLL_MASTER',
    label: 'Payroll Master',
    desc:  'Manages pay runs, payslips, salary data, and SSS/PhilHealth/Pag-IBIG contributions. No access to ledger or POS.',
  },
  // ── General ──────────────────────────────────────────────────────────────────
  {
    value: 'GENERAL_EMPLOYEE',
    label: 'General Employee',
    desc:  'Minimal access — clock in/out only. Assign to staff who do not operate the POS, ledger, or payroll.',
  },
  {
    value: 'EXTERNAL_AUDITOR',
    label: 'External Auditor',
    desc:  'Read-only view across all modules (POS orders, ledger, inventory). Zero write access.',
  },
  // ── Service / Display Accounts ───────────────────────────────────────────────
  {
    value: 'KIOSK_DISPLAY',
    label: 'Display / Kiosk',
    desc:  'For Bar / Kitchen / Customer Display tablets. KDS view + bump only. No till, no Payroll, no Ledger. Does NOT count against your staff cap.',
  },
];

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  // F&B group
  COFFEE_SHOP: 'Café / Coffee Shop',
  RESTAURANT:  'Restaurant',
  BAKERY:      'Bakery / Pastry',
  FOOD_STALL:  'Food Stall / Carinderia',
  BAR_LOUNGE:  'Bar / Lounge',
  CATERING:    'Catering',
  // Non-F&B
  RETAIL:        'Retail',
  SERVICE:       'Service',
  LAUNDRY:       'Laundry / Wash-Dry-Fold',
  MANUFACTURING: 'Manufacturing / Construction',
};

const INPUT_CLS = 'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_PRIMARY = 'flex items-center gap-2 bg-[var(--accent)] hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50';
const BTN_GHOST = 'flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-accent/10 transition-colors';

// ── Component ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const isOwner = user?.role === 'BUSINESS_OWNER';

  const [tab, setTab] = useState<Tab>('profile');
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<StaffUser | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffUser | null>(null);

  // ── Profile state ─────────────────────────────────────────────────────────
  const [profileForm, setProfileForm] = useState({
    name: '', tin: '', address: '', contactEmail: '', contactPhone: '',
  });
  const [profileDirty, setProfileDirty] = useState(false);

  // Sprint 19 — receipt template form (owner-only edit).
  const [receiptForm, setReceiptForm] = useState({
    receiptHeaderNote: '',
    receiptFooterNote: '',
    receiptLogoUrl:    '',
  });
  const [receiptDirty, setReceiptDirty] = useState(false);

  // ── BIR / Tax settings state ──────────────────────────────────────────────
  const [taxForm, setTaxForm] = useState({
    taxStatus:         (user?.taxStatus ?? 'UNREGISTERED') as TaxStatus,
    tinNumber:         user?.tinNumber ?? '',
    businessName:      user?.businessName ?? '',
    registeredAddress: user?.registeredAddress ?? '',
    isPtuHolder:       user?.isPtuHolder ?? false,
    ptuNumber:         user?.ptuNumber ?? '',
    minNumber:         user?.minNumber ?? '',
  });
  const [taxDirty, setTaxDirty] = useState(false);

  // ── New user form ─────────────────────────────────────────────────────────
  const [newUser, setNewUser] = useState({
    name: '', email: '', password: '', role: 'CASHIER',
  });

  // ── Reset password form (owner resets staff) ─────────────────────────────
  const [newPassword, setNewPassword] = useState('');

  // ── Change my password (self-service) ────────────────────────────────────
  const [pwForm, setPwForm]         = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw]         = useState({ current: false, next: false, confirm: false });

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: profile, isLoading: profileLoading } = useQuery<TenantProfile>({
    queryKey: ['tenant-profile'],
    queryFn: () => api.get('/tenant/profile').then((r) => r.data),
  });

  // Sprint 17 — TanStack Query v5 dropped the `onSuccess` callback on
  // queries. Replace it with a useEffect that populates the form whenever
  // the query data lands or refreshes. Idempotent — only populates once
  // per profile object identity.
  useEffect(() => {
    if (!profile) return;
    setProfileForm({
      name:         profile.name ?? '',
      tin:          profile.tin ?? '',
      address:      profile.address ?? '',
      contactEmail: profile.contactEmail ?? '',
      contactPhone: profile.contactPhone ?? '',
    });
    setReceiptForm({
      receiptHeaderNote: profile.receiptHeaderNote ?? '',
      receiptFooterNote: profile.receiptFooterNote ?? '',
      receiptLogoUrl:    profile.receiptLogoUrl ?? '',
    });
  }, [profile]);

  const { data: users = [], isLoading: usersLoading } = useQuery<StaffUser[]>({
    queryKey: ['staff-users'],
    queryFn: () => api.get('/users').then((r) => r.data),
    enabled: tab === 'users',
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateProfileMut = useMutation({
    mutationFn: (body: typeof profileForm) => api.patch('/tenant/profile', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-profile'] });
      setProfileDirty(false);
      toast.success('Business profile updated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to update profile.'),
  });

  // Sprint 19 — Receipt template editor mutation
  const updateReceiptMut = useMutation({
    mutationFn: (body: typeof receiptForm) => api.patch('/tenant/profile', {
      receiptHeaderNote: body.receiptHeaderNote.trim() || null,
      receiptFooterNote: body.receiptFooterNote.trim() || null,
      receiptLogoUrl:    body.receiptLogoUrl.trim()    || null,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-profile'] });
      setReceiptDirty(false);
      toast.success('Receipt template saved. Sign out and back in to see it on new sales.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to save receipt template.'),
  });

  const updateTaxMut = useMutation({
    mutationFn: (body: typeof taxForm) =>
      api.patch('/tenant/tax-settings', {
        taxStatus:         body.taxStatus,
        tinNumber:         body.tinNumber.trim() || undefined,
        businessName:      body.businessName.trim() || undefined,
        registeredAddress: body.registeredAddress.trim() || undefined,
        isPtuHolder:       body.isPtuHolder,
        ptuNumber:         body.ptuNumber.trim() || undefined,
        minNumber:         body.minNumber.trim() || undefined,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-profile'] });
      setTaxDirty(false);
      toast.success('BIR tax classification saved. Please log out and back in to refresh your session.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to save tax settings.'),
  });

  const createUserMut = useMutation({
    mutationFn: (body: typeof newUser) => api.post('/users', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-users'] });
      setShowAddUser(false);
      setNewUser({ name: '', email: '', password: '', role: 'CASHIER' });
      toast.success('Staff account created.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to create user.'),
  });

  const updateUserMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: string; isActive?: boolean } }) =>
      api.patch(`/users/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-users'] });
      setEditingUser(null);
      toast.success('Staff account updated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to update user.'),
  });

  const resetPasswordMut = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.post(`/users/${id}/reset-password`, { newPassword: password }).then((r) => r.data),
    onSuccess: () => {
      setResetTarget(null);
      setNewPassword('');
      toast.success('Password reset successfully.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to reset password.'),
  });

  const changePasswordMut = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post('/auth/change-password', body),
    onSuccess: () => {
      setPwForm({ current: '', next: '', confirm: '' });
      toast.success('Password changed. All other sessions have been signed out.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to change password.'),
  });

  function handleChangePassword() {
    if (!pwForm.current) { toast.error('Enter your current password.'); return; }
    if (pwForm.next.length < 8) { toast.error('New password must be at least 8 characters.'); return; }
    if (pwForm.next !== pwForm.confirm) { toast.error('Passwords do not match.'); return; }
    changePasswordMut.mutate({ currentPassword: pwForm.current, newPassword: pwForm.next });
  }

  // ── Profile form helpers ──────────────────────────────────────────────────
  function setField(key: keyof typeof profileForm, value: string) {
    setProfileForm((f) => ({ ...f, [key]: value }));
    setProfileDirty(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar — back returns to wherever the user came from (the app
          they entered Settings from), via router.back().
          The Sprint 12 fix tried to break a Settings ⇄ Settings/<sub> loop
          by jumping straight to /select. That was correct in spirit but
          wrong for the common case: the user expects Back to mean "exit
          back to POS/Ledger/Sync." The real loop was caused by sub-pages
          using <Link href="/settings"> (history push) instead of
          router.back() (history pop) — so we compact history cleanly in
          the sub-pages and use router.back() here, falling back to the
          app picker only when there is no history (direct landing). */}
      <header className="h-14 border-b border-border bg-card/60 backdrop-blur-sm flex items-center px-4 gap-3 sticky top-0 z-10">
        <button
          onClick={() => {
            const fallback = (user as { isSuperAdmin?: boolean } | null)?.isSuperAdmin
              ? '/admin'
              : '/select';
            // history.length is at least 2 in any normal SPA navigation
            // (initial entry + this page). Treat <= 1 as direct landing.
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back();
            } else {
              router.push(fallback);
            }
          }}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm text-foreground">Settings</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Quick links — sub-pages that aren't tabs (each is its own route).
            Floor Layout is gated to F&B tenants only — service / retail /
            manufacturing don't have stations or KDS, so the card would be
            misleading. */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Configuration</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Vertical-specific cards come from the VerticalPack registry —
                no hardcoded `if (isFnbType(...))` branches here. Sprint 19 —
                gated to owner + branch manager since these pages configure
                business policy (pharmacy roster, laundry prices, etc.). */}
            {(isOwner || user?.role === 'BRANCH_MANAGER') &&
              getVerticalPack((profile?.businessType ?? null) as any).settings.extraCards.map((card) => {
              const Icon = (Icons as any)[card.iconName] ?? Icons.Settings;
              return (
                <SettingsCard
                  key={card.href}
                  href={card.href}
                  icon={Icon}
                  title={card.label}
                  desc={card.desc}
                />
              );
            })}
            {/* Branches — only relevant on multi-branch plans. Solo plan
                tenants (maxBranches=1) can't have a second location anyway,
                so the card would just lead to a single read-only row.
                Sprint 19 — owner-only (creating / deactivating branches is
                a structural change). */}
            {isOwner && ((user as any)?.planLimits?.maxBranches ?? 1) > 1 && (
              <SettingsCard
                href="/settings/branches"
                icon={Building2}
                title="Branches"
                desc="Add / rename / deactivate locations"
              />
            )}
            {/* Subscription + SOD audit are owner-only billing/audit surfaces. */}
            {isOwner && (
              <SettingsCard
                href="/settings/subscription"
                icon={CreditCard}
                title="Subscription"
                desc="Plan, staff cap, billing, upgrade"
              />
            )}
            {isOwner && (
              <SettingsCard
                href="/settings/sod-violations"
                icon={ShieldAlert}
                title="SOD Violations"
                desc="Audit-trail of permission overrides"
              />
            )}
            {/* Sprint 19 — Stamp Cards: owner + branch manager (run promotions). */}
            {(isOwner || user?.role === 'BRANCH_MANAGER') && (
              <SettingsCard
                href="/settings/loyalty"
                icon={Stamp}
                title="Stamp Cards"
                desc="Customer loyalty programs (digital + printed)"
              />
            )}
            {/* Sprint 19 — Kiosk Terminals: owner-only (apiKey is sensitive). */}
            {isOwner && (
              <SettingsCard
                href="/settings/kiosk"
                icon={Tv}
                title="Kiosk Terminals"
                desc="Shared on-site clock-in tablet (PIN-based)"
              />
            )}
            {/* Sprint 19 — Import Templates: owner-only (bulk imports can replace catalog). */}
            {isOwner && (
              <SettingsCard
                href="/settings/imports"
                icon={FileSpreadsheet}
                title="Import Templates"
                desc="Download Excel templates for bulk product / inventory / customer / vendor imports"
              />
            )}
          </div>
        </section>

        {/* Tab bar */}
        <div className="flex gap-1 bg-muted/40 p-1 rounded-xl w-fit flex-wrap">
          {([
            { id: 'profile',  label: 'Business Profile', Icon: Building2 },
            { id: 'tax',      label: 'BIR & Tax',        Icon: FileText },
            { id: 'users',    label: 'Staff & Roles',     Icon: Users },
            { id: 'security', label: 'Security',          Icon: KeyRound },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ── Profile tab ──────────────────────────────────────────────────── */}
        {tab === 'profile' && (
          <div className="space-y-5">
            {/* Business type — read-only */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Business Type</h3>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/20">
                  {profileLoading ? '…' : (BUSINESS_TYPE_LABELS[profile?.businessType ?? ''] ?? profile?.businessType ?? '—')}
                </span>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="w-3 h-3" />
                  Locked — contact support to change
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Your business type determines which features are available (e.g. modifier groups for F&B,
                chart of accounts structure). It is set once during onboarding.
              </p>
            </div>

            {/* Editable profile fields */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Business Details</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Business Name" required>
                  <input
                    className={INPUT_CLS}
                    value={profileForm.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="Demo Business"
                    disabled={!isOwner}
                  />
                </Field>
                <Field label="TIN (Tax ID)">
                  <input
                    className={INPUT_CLS}
                    value={profileForm.tin}
                    onChange={(e) => setField('tin', e.target.value)}
                    placeholder="000-000-000-000"
                    disabled={!isOwner}
                  />
                </Field>
                <Field label="Contact Email">
                  <input
                    type="email"
                    className={INPUT_CLS}
                    value={profileForm.contactEmail}
                    onChange={(e) => setField('contactEmail', e.target.value)}
                    placeholder="owner@business.com"
                    disabled={!isOwner}
                  />
                </Field>
                <Field label="Contact Phone">
                  <input
                    className={INPUT_CLS}
                    value={profileForm.contactPhone}
                    onChange={(e) => setField('contactPhone', e.target.value)}
                    placeholder="+63 9XX XXX XXXX"
                    disabled={!isOwner}
                  />
                </Field>
              </div>

              <Field label="Address">
                <input
                  className={INPUT_CLS}
                  value={profileForm.address}
                  onChange={(e) => setField('address', e.target.value)}
                  placeholder="Street, Barangay, City, Province"
                  disabled={!isOwner}
                />
              </Field>

              {isOwner && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => updateProfileMut.mutate(profileForm)}
                    disabled={!profileDirty || updateProfileMut.isPending}
                    className={BTN_PRIMARY}
                  >
                    {updateProfileMut.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              )}
              {!isOwner && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  Only a Business Owner can edit these fields.
                </p>
              )}
            </div>

            {/* ── Inventory Costing (Sprint 4A + Sprint 6) ────────────────────── */}
            {isOwner && profile && (
              <CostingCard profile={profile} qc={qc} />
            )}

            {/* ── Receipt template (Sprint 19, owner-only) ────────────────────── */}
            {isOwner && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Receipt Template</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Customise what appears on every printed receipt. Header note shows
                    below your business name; footer note replaces "Thank you for your
                    purchase!" Logo prints at the top (1-bit PNG works best for thermal
                    printers).
                  </p>
                </div>

                <label className="block">
                  <span className="text-xs text-muted-foreground">Logo URL</span>
                  <input
                    type="url"
                    value={receiptForm.receiptLogoUrl}
                    onChange={(e) => { setReceiptForm((f) => ({ ...f, receiptLogoUrl: e.target.value })); setReceiptDirty(true); }}
                    placeholder="https://… (paste image URL)"
                    className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-muted-foreground">Header note (below business name)</span>
                  <textarea
                    value={receiptForm.receiptHeaderNote}
                    onChange={(e) => { setReceiptForm((f) => ({ ...f, receiptHeaderNote: e.target.value })); setReceiptDirty(true); }}
                    rows={2}
                    maxLength={200}
                    placeholder="e.g. Your favourite cup of coffee since 2019"
                    className="mt-1 w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">{receiptForm.receiptHeaderNote.length}/200</p>
                </label>

                <label className="block">
                  <span className="text-xs text-muted-foreground">Footer note (replaces "Thank you" line)</span>
                  <textarea
                    value={receiptForm.receiptFooterNote}
                    onChange={(e) => { setReceiptForm((f) => ({ ...f, receiptFooterNote: e.target.value })); setReceiptDirty(true); }}
                    rows={3}
                    maxLength={300}
                    placeholder={'e.g. Thanks for visiting!\nWi-Fi: cafe-guest\nFB: @cafe.philips'}
                    className="mt-1 w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">{receiptForm.receiptFooterNote.length}/300 · multi-line OK</p>
                </label>

                {/* Live preview */}
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-[11px] font-mono text-center space-y-0.5 max-w-xs mx-auto">
                  {receiptForm.receiptLogoUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={receiptForm.receiptLogoUrl}
                      alt="logo preview"
                      className="mx-auto max-h-10 object-contain mb-1"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <p className="font-bold">{profile?.name ?? 'Your Business Name'}</p>
                  {receiptForm.receiptHeaderNote && (
                    <p className="italic text-muted-foreground whitespace-pre-line">{receiptForm.receiptHeaderNote}</p>
                  )}
                  <p className="text-muted-foreground">— receipt body —</p>
                  <p className="text-muted-foreground whitespace-pre-line">
                    {receiptForm.receiptFooterNote || 'Thank you for your purchase!'}
                  </p>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => updateReceiptMut.mutate(receiptForm)}
                    disabled={!receiptDirty || updateReceiptMut.isPending}
                    className={BTN_PRIMARY}
                  >
                    {updateReceiptMut.isPending ? 'Saving…' : 'Save Receipt Template'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Returns/refunds owner-only policy (Sprint 19) ────────────── */}
            {isOwner && profile && (
              <ReturnsPolicyCard profile={profile} qc={qc} />
            )}

            {/* Read-only system info — driven by modular pricing (planCode + module flags). */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">System Info</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="Company Code" value={profile?.slug ?? '—'} />
                <InfoRow label="Status" value={profile?.status ?? '—'} />
                <InfoRow
                  label="Plan"
                  value={profile?.planCode ? planLabel(profile.planCode) : '—'}
                />
                <InfoRow
                  label="Modules"
                  value={
                    profile
                      ? [
                          profile.modulePos      ? 'POS'     : null,
                          profile.moduleLedger   ? 'Ledger'  : null,
                          profile.modulePayroll  ? 'Payroll' : null,
                        ].filter(Boolean).join(' · ') || '—'
                      : '—'
                  }
                />
              </div>
            </div>

            {/* Export everything (Owner only) */}
            {isOwner && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Data Export</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Download every record we hold for your business — products, customers, vendors, orders, journal entries,
                  invoices, bills, audit log, etc. — as a single Excel workbook with one sheet per table. Sensitive fields
                  (password hashes, 2FA secrets, supervisor PIN hashes) are stripped. Treat the file as confidential.
                </p>
                <button
                  onClick={() => downloadAuthFile('/export/tenant-all', 'clerque-export.xlsx')}
                  className="text-sm border border-border rounded-lg px-4 py-2 hover:bg-muted transition-colors"
                >
                  Download all my data (.xlsx)
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── BIR & Tax tab ─────────────────────────────────────────────────── */}
        {tab === 'tax' && (
          <div className="space-y-5">
            {/* Info banner */}
            <div className="rounded-xl border border-blue-400/20 bg-blue-500/5 p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-semibold text-sm">BIR Tax Classification</p>
                <p>
                  Your registration status (VAT / Non-VAT / Unregistered) is set during onboarding
                  and is now <strong>controlled by HNS support</strong> — switching mid-life flips
                  VAT computation and receipt format, which BIR has to approve. You can still
                  update operational fields like TIN, business name, PTU, and registered address
                  yourself. To change your registration status, contact us.
                </p>
              </div>
            </div>

            {/* Tax status — read-only display */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Registration Status</h3>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  <Lock className="w-2.5 h-2.5" /> CONSOLE-CONTROLLED
                </span>
              </div>

              {(() => {
                const STATUS_META = {
                  VAT:          { label: 'VAT-Registered',                    sub: 'Collects 12% VAT; issues VAT Official Receipts; files BIR 2550Q quarterly.',     badge: 'bg-green-500/10 text-green-700 border-green-400/30' },
                  NON_VAT:      { label: 'Non-VAT Registered',                sub: 'Registered with BIR but below VAT threshold. Issues Official Receipts. No input tax claim.', badge: 'bg-blue-500/10 text-blue-700 border-blue-400/30' },
                  UNREGISTERED: { label: 'Unregistered / Barangay Business',  sub: 'No BIR registration. Issues Acknowledgement Receipts only. No VAT, no BIR forms.',  badge: 'bg-muted text-muted-foreground border-border' },
                } as const;
                const current = STATUS_META[taxForm.taxStatus] ?? STATUS_META.UNREGISTERED;
                return (
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${current.badge}`}>
                        {taxForm.taxStatus.replace('_', ' ')}
                      </span>
                      <span className="text-sm font-medium text-foreground">{current.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-0.5">{current.sub}</p>
                  </div>
                );
              })()}

              {taxForm.taxStatus !== 'UNREGISTERED' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                  <Field label={taxForm.taxStatus === 'VAT' ? 'VAT REG TIN' : 'NON-VAT REG TIN'}>
                    <input
                      className={INPUT_CLS}
                      placeholder="000-000-000-00000"
                      value={taxForm.tinNumber}
                      onChange={(e) => { setTaxForm((f) => ({ ...f, tinNumber: e.target.value })); setTaxDirty(true); }}
                      disabled={!isOwner}
                      maxLength={20}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Format: 000-000-000-00000 (15 digits, as shown on your COR)
                    </p>
                  </Field>
                  <Field label="Business Name (as on COR)">
                    <input
                      className={INPUT_CLS}
                      placeholder="Exact name on BIR Certificate of Registration"
                      value={taxForm.businessName}
                      onChange={(e) => { setTaxForm((f) => ({ ...f, businessName: e.target.value })); setTaxDirty(true); }}
                      disabled={!isOwner}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Printed on receipts as the registered business name.
                    </p>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Registered Address (as on COR)">
                      <input
                        className={INPUT_CLS}
                        placeholder="Full address as it appears on your BIR Certificate of Registration"
                        value={taxForm.registeredAddress}
                        onChange={(e) => { setTaxForm((f) => ({ ...f, registeredAddress: e.target.value })); setTaxDirty(true); }}
                        disabled={!isOwner}
                      />
                    </Field>
                  </div>
                </div>
              )}

              {/* PTU / CAS Accreditation (only shown when BIR-registered) */}
              {taxForm.taxStatus !== 'UNREGISTERED' && (
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">BIR Permit to Use (PTU)</p>
                      <p className="text-xs text-muted-foreground">
                        Required for CAS-accredited POS systems. Enables Phase 2 receipt titles on all terminals.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={taxForm.isPtuHolder}
                      onClick={() => { setTaxForm((f) => ({ ...f, isPtuHolder: !f.isPtuHolder })); setTaxDirty(true); }}
                      disabled={!isOwner}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        taxForm.isPtuHolder ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                      } ${!isOwner ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${taxForm.isPtuHolder ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {taxForm.isPtuHolder && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="PTU Number">
                        <input
                          className={INPUT_CLS}
                          placeholder="e.g. PTU-123456-2024"
                          value={taxForm.ptuNumber}
                          onChange={(e) => { setTaxForm((f) => ({ ...f, ptuNumber: e.target.value })); setTaxDirty(true); }}
                          disabled={!isOwner}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          As printed on your BIR PTU certificate.
                        </p>
                      </Field>
                      <Field label="Machine Identification Number (MIN)">
                        <input
                          className={INPUT_CLS}
                          placeholder="e.g. MIN-20240001"
                          value={taxForm.minNumber}
                          onChange={(e) => { setTaxForm((f) => ({ ...f, minNumber: e.target.value })); setTaxDirty(true); }}
                          disabled={!isOwner}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          BIR-assigned Machine Identification Number for CAS.
                        </p>
                      </Field>
                    </div>
                  )}
                </div>
              )}

              {isOwner && (
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  {taxForm.taxStatus !== 'UNREGISTERED' && taxForm.tinNumber && taxForm.tinNumber.trim() !== (user?.tinNumber ?? '') && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      TIN change will be recorded in the audit log.
                    </div>
                  )}
                  <div className="ml-auto">
                    <button
                      onClick={() => updateTaxMut.mutate(taxForm)}
                      disabled={!taxDirty || updateTaxMut.isPending}
                      className={BTN_PRIMARY}
                    >
                      {updateTaxMut.isPending ? 'Saving…' : 'Save Classification'}
                    </button>
                  </div>
                </div>
              )}
              {!isOwner && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 pt-2 border-t border-border">
                  <Lock className="w-3 h-3" />
                  Only a Business Owner can change tax classification.
                </p>
              )}
            </div>

            {/* Current session summary */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Current Session Values</h3>
              <p className="text-xs text-muted-foreground">
                These are the values your active session is using. If you just saved a change, log out
                and back in to update them.
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="Tax Status"     value={user?.taxStatus ?? '—'} />
                <InfoRow label="VAT Registered" value={user?.isVatRegistered ? 'Yes' : 'No'} />
                <InfoRow label="BIR Registered" value={user?.isBirRegistered ? 'Yes' : 'No'} />
                <InfoRow label="TIN on Record"  value={user?.tinNumber ?? '—'} />
                <InfoRow label="PTU Holder"     value={user?.isPtuHolder ? 'Yes' : 'No'} />
                <InfoRow label="MIN"            value={user?.minNumber ?? '—'} />
              </div>
            </div>
          </div>
        )}

        {/* ── Security tab ─────────────────────────────────────────────────── */}
        {tab === 'security' && (
          <div className="space-y-5">
            {/* Change own password */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Change My Password</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter your current password to set a new one. All other active sessions will be
                signed out immediately after a successful change.
              </p>

              {/* Current password */}
              <Field label="Current Password" required>
                <div className="relative">
                  <input
                    type={showPw.current ? 'text' : 'password'}
                    className={INPUT_CLS + ' pr-10'}
                    placeholder="Your current password"
                    value={pwForm.current}
                    onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => ({ ...s, current: !s.current }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPw.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>

              {/* New password */}
              <Field label="New Password" required>
                <div className="relative">
                  <input
                    type={showPw.next ? 'text' : 'password'}
                    className={INPUT_CLS + ' pr-10'}
                    placeholder="Min. 8 characters"
                    value={pwForm.next}
                    onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => ({ ...s, next: !s.next }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPw.next ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* Strength indicator */}
                {pwForm.next && (
                  <div className="mt-1.5 flex gap-1">
                    {[8, 12, 16].map((len, i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          pwForm.next.length >= len
                            ? i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-[var(--accent)]' : 'bg-emerald-500'
                            : 'bg-muted'
                        }`}
                      />
                    ))}
                    <span className="text-[10px] text-muted-foreground ml-1">
                      {pwForm.next.length < 8 ? 'Too short' : pwForm.next.length < 12 ? 'OK' : pwForm.next.length < 16 ? 'Good' : 'Strong'}
                    </span>
                  </div>
                )}
              </Field>

              {/* Confirm password */}
              <Field label="Confirm New Password" required>
                <div className="relative">
                  <input
                    type={showPw.confirm ? 'text' : 'password'}
                    className={`${INPUT_CLS} pr-10 ${pwForm.confirm && pwForm.next !== pwForm.confirm ? 'border-red-400 focus:ring-red-400' : ''}`}
                    placeholder="Repeat new password"
                    value={pwForm.confirm}
                    onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => ({ ...s, confirm: !s.confirm }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPw.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {pwForm.confirm && pwForm.next !== pwForm.confirm && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match.</p>
                )}
              </Field>

              <div className="flex justify-end pt-1">
                <button
                  onClick={handleChangePassword}
                  disabled={
                    !pwForm.current || pwForm.next.length < 8 ||
                    pwForm.next !== pwForm.confirm || changePasswordMut.isPending
                  }
                  className={BTN_PRIMARY}
                >
                  <KeyRound className="w-4 h-4" />
                  {changePasswordMut.isPending ? 'Changing…' : 'Change Password'}
                </button>
              </div>
            </div>

            {/* Session info */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Active Session</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="Logged in as"  value={user?.name ?? '—'} />
                <InfoRow label="Role"           value={user?.role ?? '—'} />
                <InfoRow label="Email"          value={'(session)' } />
              </div>
              <p className="text-xs text-muted-foreground">
                Changing your password will sign out all other devices. Your current session stays active
                until you sign out or your access token expires (15 minutes).
              </p>
            </div>

            {/* Supervisor PIN — for void-authority roles only */}
            {(['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'] as const).includes(
              user?.role as 'BUSINESS_OWNER' | 'BRANCH_MANAGER' | 'SALES_LEAD',
            ) && <SupervisorPinCard />}
          </div>
        )}

        {/* ── Users tab ────────────────────────────────────────────────────── */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {users.length} staff member{users.length !== 1 ? 's' : ''}
              </p>
              {isOwner && (
                <button onClick={() => setShowAddUser(true)} className={BTN_PRIMARY}>
                  <Plus className="w-4 h-4" />
                  Add Staff
                </button>
              )}
            </div>

            {usersLoading ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Loading staff…</div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {users.map((u, i) => (
                  <div
                    key={u.id}
                    className={`flex items-center gap-3 px-4 py-3 ${i < users.length - 1 ? 'border-b border-border' : ''}`}
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-[var(--accent)]">
                        {u.name.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${u.isActive ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                          {u.name}
                        </p>
                        {!u.isActive && (
                          <span className="text-xs text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                            Inactive
                          </span>
                        )}
                        {u.id === user?.sub && (
                          <span className="text-xs text-[var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 rounded-full shrink-0">
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>

                    {/* Role badge */}
                    <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded-lg shrink-0 hidden sm:block">
                      {ROLES.find((r) => r.value === u.role)?.label ?? u.role}
                    </span>

                    {/* Actions (owner only, can't edit yourself) */}
                    {isOwner && u.id !== user?.sub && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setEditingUser(u)}
                          className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-lg hover:bg-accent/10 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setResetTarget(u)}
                          className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-lg hover:bg-accent/10 transition-colors"
                          title="Reset password"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => updateUserMut.mutate({ id: u.id, data: { isActive: !u.isActive } })}
                          className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                            u.isActive
                              ? 'text-red-500 border-red-400/30 hover:bg-red-500/5'
                              : 'text-green-600 border-green-400/30 hover:bg-green-500/5'
                          }`}
                          title={u.isActive ? 'Deactivate' : 'Reactivate'}
                        >
                          {u.isActive ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* SOD notice */}
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              <p className="font-semibold">Segregation of Duties reminder</p>
              <p className="text-amber-600/80 dark:text-amber-400/70">
                Avoid giving one person both Accountant and Business Owner access if your business
                handles significant cash volumes. When one person does both, enable owner approval
                thresholds and review the audit log regularly.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Add User Modal ────────────────────────────────────────────────── */}
      {showAddUser && (
        <Modal title="Add Staff Member" onClose={() => setShowAddUser(false)}>
          <form
            onSubmit={(e) => { e.preventDefault(); createUserMut.mutate(newUser); }}
            className="space-y-4"
          >
            <Field label="Full Name" required>
              <input
                className={INPUT_CLS}
                placeholder="Juan dela Cruz"
                value={newUser.name}
                onChange={(e) => setNewUser((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </Field>
            <Field label="Email Address" required>
              <input
                type="email"
                className={INPUT_CLS}
                placeholder="juan@business.com"
                value={newUser.email}
                onChange={(e) => setNewUser((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </Field>
            <Field label="Temporary Password" required>
              <input
                type="password"
                className={INPUT_CLS}
                placeholder="Min. 8 characters"
                value={newUser.password}
                onChange={(e) => setNewUser((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
              />
            </Field>
            <Field label="Role" required>
              <div className="relative">
                <select
                  className={INPUT_CLS + ' appearance-none pr-8'}
                  value={newUser.role}
                  onChange={(e) => setNewUser((f) => ({ ...f, role: e.target.value }))}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {ROLES.find((r) => r.value === newUser.role)?.desc}
              </p>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowAddUser(false)} className={BTN_GHOST}>Cancel</button>
              <button type="submit" className={BTN_PRIMARY} disabled={createUserMut.isPending}>
                {createUserMut.isPending ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Edit User Modal ───────────────────────────────────────────────── */}
      {editingUser && (
        <Modal title={`Edit — ${editingUser.name}`} onClose={() => setEditingUser(null)}>
          <div className="space-y-4">
            <Field label="Role">
              <div className="relative">
                <select
                  className={INPUT_CLS + ' appearance-none pr-8'}
                  defaultValue={editingUser.role}
                  id="edit-role-select"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditingUser(null)} className={BTN_GHOST}>Cancel</button>
              <button
                onClick={() => {
                  const sel = (document.getElementById('edit-role-select') as HTMLSelectElement).value;
                  updateUserMut.mutate({ id: editingUser.id, data: { role: sel } });
                }}
                className={BTN_PRIMARY}
                disabled={updateUserMut.isPending}
              >
                {updateUserMut.isPending ? 'Saving…' : 'Save Role'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reset Password Modal ──────────────────────────────────────────── */}
      {resetTarget && (
        <Modal title={`Reset Password — ${resetTarget.name}`} onClose={() => { setResetTarget(null); setNewPassword(''); }}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter a new temporary password for <span className="font-medium text-foreground">{resetTarget.name}</span>.
              Ask them to change it after logging in.
            </p>
            <Field label="New Password" required>
              <input
                type="password"
                className={INPUT_CLS}
                placeholder="Min. 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setResetTarget(null); setNewPassword(''); }} className={BTN_GHOST}>Cancel</button>
              <button
                onClick={() => resetPasswordMut.mutate({ id: resetTarget.id, password: newPassword })}
                disabled={newPassword.length < 8 || resetPasswordMut.isPending}
                className={BTN_PRIMARY}
              >
                {resetPasswordMut.isPending ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SupervisorPinCard() {
  const [currentPw, setCurrentPw] = useState('');
  const [pin, setPin]             = useState('');
  const [confirmPin, setConfirm]  = useState('');
  const [saving, setSaving]       = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) { toast.error('PIN must be 4-6 digits.'); return; }
    if (pin !== confirmPin)     { toast.error('PINs do not match.'); return; }
    if (!currentPw)             { toast.error('Enter your current password to confirm.'); return; }
    setSaving(true);
    try {
      await api.post('/auth/set-supervisor-pin', { currentPassword: currentPw, newPin: pin });
      toast.success('Supervisor PIN updated. Use it at any cashier till to authorise voids.');
      setCurrentPw(''); setPin(''); setConfirm('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to set PIN.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Supervisor PIN</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Set a 4-6 digit PIN that you&apos;ll type into a cashier&apos;s screen to authorise their voids.
        The cashier never sees the PIN — they hand you the device, you enter it,
        you hand it back. The void is logged with both your names. Confirm with your
        login password to prevent someone with a stolen session from setting a PIN.
      </p>
      <Field label="Current Login Password" required>
        <input
          type="password"
          value={currentPw}
          onChange={(e) => setCurrentPw(e.target.value)}
          className={INPUT_CLS}
          autoComplete="current-password"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New PIN (4-6 digits)" required>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className={`${INPUT_CLS} text-center text-lg tracking-[0.4em] font-bold`}
            placeholder="• • • •"
            autoComplete="off"
          />
        </Field>
        <Field label="Confirm PIN" required>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirmPin}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
            className={`${INPUT_CLS} text-center text-lg tracking-[0.4em] font-bold`}
            placeholder="• • • •"
            autoComplete="off"
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={saving} className={BTN_PRIMARY}>
          {saving ? 'Saving…' : 'Set Supervisor PIN'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground mt-0.5">{value}</p>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-accent/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── Costing Card (Sprint 4A: WAC/FIFO + Sprint 6: Manufacturing Overhead) ─────

function CostingCard({
  profile,
  qc,
}: {
  profile: TenantProfile;
  qc: ReturnType<typeof useQueryClient>;
}) {
  // Sprint 12 — CostingCard is fully read-only on the tenant side. Both
  // valuationMethod and overheadRatePerUnit are now CONSOLE-only policy
  // knobs (changing them mid-life corrupts COGS continuity). Owners see
  // the active values with a lock badge + a "Contact support to change"
  // affordance. The previous mutation buttons + auto-lock-on-first-txn UI
  // are gone — the lock is permanent from the tenant's perspective.
  const isManufacturing = profile.businessType === 'MANUFACTURING';
  const valMethod   = (profile.valuationMethod as 'WAC' | 'FIFO') ?? 'WAC';
  const overheadStr = profile.overheadRatePerUnit != null
    ? `₱${Number(profile.overheadRatePerUnit).toFixed(4)} / unit`
    : '— (utilities recorded as OpEx)';

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-5">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Inventory Costing</h3>
      </div>

      {/* Valuation method — read-only */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Valuation method</label>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            <Lock className="w-2.5 h-2.5" /> CONSOLE-CONTROLLED
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/20">
          <span className="text-base font-semibold text-foreground">{valMethod}</span>
          <span className="text-xs text-muted-foreground">
            ({valMethod === 'WAC' ? 'Weighted Average Cost' : 'First-In-First-Out'})
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The inventory valuation method is set by HNS support during onboarding. Changing it
          mid-life would produce inconsistent COGS, so it requires a planned fiscal-year cutover —
          contact support to discuss.
        </p>
      </div>

      {/* Sprint 12 — Accounting basis (CASH vs ACCRUAL) — read-only.
          Same console-only policy lock as valuation method: switching mid-
          life rebases revenue recognition + AR/AP, which corrupts comparable
          financial statements. */}
      <div className="pt-4 border-t border-border space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Accounting basis</label>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            <Lock className="w-2.5 h-2.5" /> CONSOLE-CONTROLLED
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/20">
          <span className="text-base font-semibold text-foreground">
            {profile.accountingMethod ?? 'ACCRUAL'}
          </span>
          <span className="text-xs text-muted-foreground">
            ({(profile.accountingMethod ?? 'ACCRUAL') === 'CASH'
              ? 'Cash basis — revenue when received, expense when paid'
              : 'Accrual basis — revenue when earned, expense when incurred (PFRS default)'})
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Your accounting basis determines when revenue and expenses are recognized in the books.
          Changing it mid-year corrupts year-over-year comparability — contact HNS support to plan a
          fiscal-year cutover.
        </p>
      </div>

      {/* Manufacturing overhead — read-only, only shown for MANUFACTURING */}
      {isManufacturing && (
        <div className="pt-4 border-t border-border space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              Manufacturing overhead (₱ per unit produced)
            </label>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              <Lock className="w-2.5 h-2.5" /> CONSOLE-CONTROLLED
            </span>
          </div>
          <div className="px-3 py-2.5 rounded-lg border border-border bg-muted/20 text-sm font-semibold">
            {overheadStr}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Overhead allocation is set by HNS support based on your CPA's recommendation. Contact
            support to adjust.
          </p>
        </div>
      )}

      {!isManufacturing && (
        <div className="pt-4 border-t border-border">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Why electricity isn't in COGS:</strong> Per PFRS for
            SMEs §13.10, F&B and retail businesses record utilities and rent as Operating Expenses,
            not Cost of Goods Sold. Including them would distort your gross margin in either direction
            depending on month-to-month usage. They appear under OpEx in your Income Statement.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Sprint 19 — Returns/refunds policy card ───────────────────────────────

function ReturnsPolicyCard({
  profile, qc,
}: { profile: { returnsOwnerOnly?: boolean | null }; qc: ReturnType<typeof useQueryClient> }) {
  const initial = profile.returnsOwnerOnly === true;
  const [enabled, setEnabled] = useState(initial);

  const updateMut = useMutation({
    mutationFn: (next: boolean) =>
      api.patch('/tenant/profile', { returnsOwnerOnly: next }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-profile'] });
      toast.success('Returns policy updated. Staff need to log out + back in for the change to take effect on their tills.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to update policy.');
      setEnabled(initial); // roll back local state
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Returns &amp; Refunds Policy</h3>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
          When ON, only the Business Owner can void an order or refund a line. Cashiers, sales leads, and
          branch managers are blocked even with supervisor PIN. Pharmacy tenants default to ON; other
          verticals default OFF.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5">
        <div className="text-sm">
          <div className="font-medium text-foreground">Owner-only returns</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {enabled
              ? 'Only the Business Owner can void or refund.'
              : 'Cashiers may initiate void/refund with supervisor PIN co-auth.'}
          </div>
        </div>
        <button
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            updateMut.mutate(next);
          }}
          disabled={updateMut.isPending}
          className="w-11 h-6 rounded-full transition-colors shrink-0"
          style={{ background: enabled ? 'var(--accent)' : 'hsl(var(--muted-foreground) / 0.3)' }}
          aria-label="Toggle owner-only returns"
        >
          <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`} />
        </button>
      </div>
    </div>
  );
}

// ── Settings card (link to a sub-page) ─────────────────────────────────────

function SettingsCard({
  href, icon: Icon, title, desc,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card hover:bg-muted/40 hover:border-[var(--accent)]/40 transition-colors p-3"
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <h3 className="font-semibold text-sm text-foreground truncate">{title}</h3>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all shrink-0" />
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{desc}</p>
      </div>
    </Link>
  );
}
