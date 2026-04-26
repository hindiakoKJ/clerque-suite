'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Building2, Users, ArrowLeft, Lock,
  Plus, X, CheckCircle2, XCircle, RotateCcw,
  ChevronDown, Shield, FileText, AlertTriangle, Info,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'tax' | 'users';
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
  tier: string;
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
  { value: 'BUSINESS_OWNER',  label: 'Business Owner',   desc: 'Full access to all modules' },
  { value: 'BRANCH_MANAGER',  label: 'Branch Manager',   desc: 'Manages POS, reports, inventory' },
  { value: 'ACCOUNTANT',      label: 'Accountant',       desc: 'Ledger, journal, periods' },
  { value: 'CASHIER',         label: 'Cashier',          desc: 'POS terminal only' },
  { value: 'GENERAL_EMPLOYEE',label: 'General Employee', desc: 'Clock-in / payroll only' },
];

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  RETAIL:      'Retail',
  COFFEE_SHOP: 'Coffee Shop / F&B',
  RESTAURANT:  'Restaurant',
  SERVICES:    'Services',
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

  // ── Reset password form ───────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState('');

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: profile, isLoading: profileLoading } = useQuery<TenantProfile>({
    queryKey: ['tenant-profile'],
    queryFn: () => api.get('/tenant/profile').then((r) => r.data),
    onSuccess: (data: TenantProfile) => {
      setProfileForm({
        name:         data.name ?? '',
        tin:          data.tin ?? '',
        address:      data.address ?? '',
        contactEmail: data.contactEmail ?? '',
        contactPhone: data.contactPhone ?? '',
      });
    },
  } as any);

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
      api.patch(`/users/${id}/reset-password`, { newPassword: password }).then((r) => r.data),
    onSuccess: () => {
      setResetTarget(null);
      setNewPassword('');
      toast.success('Password reset successfully.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to reset password.'),
  });

  // ── Profile form helpers ──────────────────────────────────────────────────
  function setField(key: keyof typeof profileForm, value: string) {
    setProfileForm((f) => ({ ...f, [key]: value }));
    setProfileDirty(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="h-14 border-b border-border bg-card/60 backdrop-blur-sm flex items-center px-4 gap-3 sticky top-0 z-10">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm text-foreground">Settings</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Tab bar */}
        <div className="flex gap-1 bg-muted/40 p-1 rounded-xl w-fit flex-wrap">
          {([
            { id: 'profile', label: 'Business Profile', Icon: Building2 },
            { id: 'tax',     label: 'BIR & Tax',        Icon: FileText },
            { id: 'users',   label: 'Staff & Roles',     Icon: Users },
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

            {/* Read-only system info */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">System Info</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="Company Code" value={profile?.slug ?? '—'} />
                <InfoRow label="Status" value={profile?.status ?? '—'} />
                <InfoRow label="Subscription Tier" value={profile?.tier?.replace('TIER_', 'Tier ') ?? '—'} />
              </div>
            </div>
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
                  This setting controls how the POS computes VAT, generates receipts, and presents
                  BIR forms. Set it exactly as your Certificate of Registration (COR) states.
                  After saving, log out and back in so your session reflects the new classification.
                </p>
              </div>
            </div>

            {/* Tax status selector */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Registration Status</h3>

              <div className="space-y-2">
                {([
                  {
                    value: 'VAT',
                    label: 'VAT-Registered',
                    sub: 'Collects 12% VAT; issues VAT Official Receipts; files BIR 2550Q quarterly.',
                    badge: 'bg-green-500/10 text-green-700 border-green-400/30',
                  },
                  {
                    value: 'NON_VAT',
                    label: 'Non-VAT Registered',
                    sub: 'Registered with BIR but below VAT threshold. Issues Official Receipts. No input tax claim.',
                    badge: 'bg-blue-500/10 text-blue-700 border-blue-400/30',
                  },
                  {
                    value: 'UNREGISTERED',
                    label: 'Unregistered / Barangay Business',
                    sub: 'No BIR registration. Issues Acknowledgement Receipts only. No VAT, no BIR forms.',
                    badge: 'bg-muted text-muted-foreground border-border',
                  },
                ] as const).map(({ value, label, sub, badge }) => (
                  <button
                    key={value}
                    onClick={() => { setTaxForm((f) => ({ ...f, taxStatus: value })); setTaxDirty(true); }}
                    disabled={!isOwner}
                    className={`w-full text-left rounded-lg border px-4 py-3 transition-all ${
                      taxForm.taxStatus === value
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/30'
                        : 'border-border hover:border-[var(--accent)]/40 hover:bg-accent/5'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${badge}`}>
                        {value.replace('_', ' ')}
                      </span>
                      <span className="text-sm font-medium text-foreground">{label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-0.5">{sub}</p>
                  </button>
                ))}
              </div>

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
