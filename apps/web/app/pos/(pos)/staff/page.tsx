'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, ToggleLeft, ToggleRight, Users, KeyRound, ShieldCheck, Shield } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';

type StaffRole =
  | 'BUSINESS_OWNER' | 'BRANCH_MANAGER' | 'SALES_LEAD'
  | 'CASHIER' | 'MDM' | 'WAREHOUSE_STAFF'
  | 'FINANCE_LEAD' | 'BOOKKEEPER' | 'ACCOUNTANT'
  | 'PAYROLL_MASTER' | 'GENERAL_EMPLOYEE' | 'EXTERNAL_AUDITOR';

interface Branch { id: string; name: string; }
interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  branchId?: string | null;
  branch?: Branch | null;
  isActive: boolean;
  createdAt: string;
}

/**
 * Role catalog — shown in create/edit dropdowns and in the permissions reference card.
 * Access column describes what each role can do at a high level.
 */
const ROLES: { value: StaffRole; label: string; access: string }[] = [
  { value: 'BUSINESS_OWNER',   label: 'Business Owner',      access: 'Full access to all modules. Cannot open shifts (supervisor only).' },
  { value: 'BRANCH_MANAGER',   label: 'Branch Manager',      access: 'Oversees orders, reports, inventory. Cannot open shifts.' },
  { value: 'SALES_LEAD',       label: 'Sales Lead',          access: 'Can open/close shifts, void orders, apply manager discounts.' },
  { value: 'CASHIER',          label: 'Cashier',             access: 'Opens shifts, rings up sales, basic order management.' },
  { value: 'MDM',              label: 'Master Data Mgr',     access: 'Manages products, categories, inventory, UoM. No financial access.' },
  { value: 'WAREHOUSE_STAFF',  label: 'Warehouse Staff',     access: 'Stock adjustments and raw material receiving only.' },
  { value: 'FINANCE_LEAD',     label: 'Finance Lead',        access: 'Bank reconciliation, cash-flow reports. No payroll, no price edits.' },
  { value: 'BOOKKEEPER',       label: 'Bookkeeper',          access: 'Journal entries and GL read. No payroll, no price edits.' },
  { value: 'ACCOUNTANT',       label: 'Accountant',          access: 'Full ledger read. No payroll.' },
  { value: 'PAYROLL_MASTER',   label: 'Payroll Master',      access: 'Payroll runs and salary data. Cannot access POS or Ledger.' },
  { value: 'GENERAL_EMPLOYEE', label: 'General Employee',    access: 'Clock-in/out only. No POS or Ledger access.' },
  { value: 'EXTERNAL_AUDITOR', label: 'External Auditor',    access: 'Read-only compliance view across all modules. Zero write access.' },
];

const ROLE_COLORS: Partial<Record<StaffRole, string>> = {
  BUSINESS_OWNER:   'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  BRANCH_MANAGER:   'bg-[var(--accent-soft)] text-[var(--accent)]',
  SALES_LEAD:       'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  CASHIER:          'bg-green-500/10 text-green-600 dark:text-green-400',
  MDM:              'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  WAREHOUSE_STAFF:  'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  FINANCE_LEAD:     'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  BOOKKEEPER:       'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  ACCOUNTANT:       'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  PAYROLL_MASTER:   'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  GENERAL_EMPLOYEE: 'bg-secondary text-secondary-foreground',
  EXTERNAL_AUDITOR: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

const EMPTY_CREATE = {
  name: '', email: '', password: '', role: 'CASHIER' as StaffRole,
  branchId: '', kioskPin: '',
};
const EMPTY_EDIT = {
  name: '', role: 'CASHIER' as StaffRole, branchId: '', isActive: true,
};

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

export default function StaffPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const isOwner   = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  // MDM can view staff list and add/edit employees, but cannot toggle active status or MDM role
  const canManage = isOwner || user?.role === 'MDM';
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'create' | 'edit' | 'password' | null>(null);
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [editForm, setEditForm] = useState({ ...EMPTY_EDIT });
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { data: staff = [], isLoading } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: () => api.get('/users').then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/users/branches').then((r) => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff'] });

  const toggleMdmMut = useMutation({
    mutationFn: (targetId: string) =>
      api.patch(`/users/${targetId}/toggle-mdm`).then((r) => r.data),
    onSuccess: (data: { name: string; role: string; message: string }) => {
      toast.success(data.message);
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to update MDM role.',
      );
    },
  });

  function openCreate() {
    setCreateForm({ ...EMPTY_CREATE, branchId: user?.branchId ?? '' });
    setModal('create');
  }

  function openEdit(s: StaffMember) {
    setEditTarget(s);
    setEditForm({ name: s.name, role: s.role, branchId: s.branchId ?? '', isActive: s.isActive });
    setModal('edit');
  }

  function openResetPassword(s: StaffMember) {
    setEditTarget(s);
    setNewPassword('');
    setModal('password');
  }

  async function handleCreate() {
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password) {
      toast.error('Name, email, and password are required.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/users', {
        name: createForm.name.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password,
        role: createForm.role,
        branchId: createForm.branchId || undefined,
        kioskPin: createForm.kioskPin || undefined,
      });
      toast.success(`${createForm.name} added to your team.`);
      invalidate();
      setModal(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create staff member.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editTarget) return;
    setSaving(true);
    try {
      await api.patch(`/users/${editTarget.id}`, {
        name: editForm.name.trim(),
        role: editForm.role,
        branchId: editForm.branchId || null,
        isActive: editForm.isActive,
      });
      toast.success('Staff member updated.');
      invalidate();
      setModal(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!editTarget || newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/users/${editTarget.id}/reset-password`, { newPassword });
      toast.success(`Password reset for ${editTarget.name}. Their active sessions have been revoked.`);
      setModal(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to reset password.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(s: StaffMember) {
    if (!isOwner) return;
    try {
      await api.patch(`/users/${s.id}`, { isActive: !s.isActive });
      toast.success(`${s.name} ${!s.isActive ? 'reactivated' : 'deactivated'}.`);
      invalidate();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed.');
    }
  }

  const filtered = staff.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Staff</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="pl-8 pr-3 py-1.5 text-sm border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent w-full sm:w-52 transition-shadow"
            />
          </div>
          {canManage && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 text-xs hover:opacity-90 text-white rounded-lg px-3 py-1.5 font-medium transition-opacity whitespace-nowrap"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Staff
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Users className="h-10 w-10 opacity-30" />
          <p className="text-sm">No staff members found.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  {isOwner && (
                    <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      MDM
                    </th>
                  )}
                  {canManage && (
                    <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className={`hover:bg-muted/40 transition-colors ${!s.isActive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-6 py-3 font-medium text-foreground">{s.name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{s.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[s.role] ?? 'bg-secondary text-secondary-foreground'}`}>
                        {ROLES.find((r) => r.value === s.role)?.label ?? s.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.branch?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        s.isActive
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-red-500/10 text-red-500'
                      }`}>
                        {s.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>

                    {/* MDM toggle — OWNER only; not shown for OWNER/SUPER_ADMIN rows */}
                    {isOwner && (
                      <td className="px-4 py-3 text-center">
                        {s.role !== 'BUSINESS_OWNER' ? (
                          <button
                            onClick={() => toggleMdmMut.mutate(s.id)}
                            disabled={toggleMdmMut.isPending}
                            className={`transition-colors disabled:opacity-40 ${
                              s.role === 'MDM'
                                ? 'text-blue-500 hover:text-muted-foreground'
                                : 'text-muted-foreground hover:text-blue-500'
                            }`}
                            title={s.role === 'MDM' ? 'Revoke MDM role' : 'Grant MDM role'}
                          >
                            {s.role === 'MDM'
                              ? <ShieldCheck className="h-4 w-4 mx-auto" />
                              : <Shield      className="h-4 w-4 mx-auto" />}
                          </button>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                    )}

                    {canManage && (
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => openEdit(s)}
                            className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {isOwner && (
                            <>
                              <button
                                onClick={() => openResetPassword(s)}
                                className="text-muted-foreground hover:text-amber-500 transition-colors"
                                title="Reset password"
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleToggleActive(s)}
                                className={`transition-colors ${
                                  s.isActive
                                    ? 'text-emerald-500 hover:text-red-400'
                                    : 'text-muted-foreground hover:text-emerald-500'
                                }`}
                                title={s.isActive ? 'Deactivate' : 'Reactivate'}
                              >
                                {s.isActive
                                  ? <ToggleRight className="h-4 w-4" />
                                  : <ToggleLeft  className="h-4 w-4" />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create modal */}
      {modal === 'create' && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Add Staff Member</h2>
            </div>
            <div className="p-6 space-y-4">
              <FormField label="Full Name *">
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="e.g. Maria Santos"
                />
              </FormField>
              <FormField label="Email *">
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="maria@example.com"
                />
              </FormField>
              <FormField label="Temporary Password *">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="Min 8 characters"
                />
                <button
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-xs mt-1 hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  {showPassword ? 'Hide' : 'Show'} password
                </button>
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Role *">
                  <select
                    value={createForm.role}
                    onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as StaffRole }))}
                    className={INPUT_CLS}
                  >
                    {ROLES
                      // MDM users cannot assign BUSINESS_OWNER or MDM roles — those are owner-only
                      .filter((r) => isOwner || !['BUSINESS_OWNER', 'MDM'].includes(r.value))
                      .map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </FormField>
                <FormField label="Branch">
                  <select
                    value={createForm.branchId}
                    onChange={(e) => setCreateForm((f) => ({ ...f, branchId: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">— None —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </FormField>
              </div>
              {/* Role access description */}
              {ROLES.find((r) => r.value === createForm.role) && (
                <div className="flex gap-2 text-[11px] bg-muted/50 rounded-lg px-3 py-2 text-muted-foreground">
                  <span className="shrink-0">ℹ️</span>
                  <span>{ROLES.find((r) => r.value === createForm.role)!.access}</span>
                </div>
              )}
              {(createForm.role === 'CASHIER' || createForm.role === 'SALES_LEAD') && (
                <FormField label="Kiosk PIN (optional — 4 digits)">
                  <input
                    type="text"
                    maxLength={4}
                    value={createForm.kioskPin}
                    onChange={(e) => setCreateForm((f) => ({ ...f, kioskPin: e.target.value.replace(/\D/g, '') }))}
                    className={INPUT_CLS}
                    placeholder="e.g. 1234"
                  />
                </FormField>
              )}
            </div>
            <ModalFooter
              onCancel={() => setModal(null)}
              onSave={handleCreate}
              saving={saving}
              saveLabel="Create Staff"
            />
          </div>
        </div>
      )}

      {/* Edit modal */}
      {modal === 'edit' && editTarget && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Edit {editTarget.name}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{editTarget.email}</p>
            </div>
            <div className="p-6 space-y-4">
              <FormField label="Full Name">
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLS}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Role">
                  <select
                    value={editForm.role}
                    onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as StaffRole }))}
                    className={INPUT_CLS}
                  >
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </FormField>
                <FormField label="Branch">
                  <select
                    value={editForm.branchId}
                    onChange={(e) => setEditForm((f) => ({ ...f, branchId: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">— None —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </FormField>
              </div>
              {ROLES.find((r) => r.value === editForm.role) && (
                <div className="flex gap-2 text-[11px] bg-muted/50 rounded-lg px-3 py-2 text-muted-foreground">
                  <span className="shrink-0">ℹ️</span>
                  <span>{ROLES.find((r) => r.value === editForm.role)!.access}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Active</p>
                  <p className="text-xs text-muted-foreground">Inactive users cannot log in</p>
                </div>
                <button
                  onClick={() => setEditForm((f) => ({ ...f, isActive: !f.isActive }))}
                  className="w-10 h-6 rounded-full transition-colors"
                  style={{ background: editForm.isActive ? 'var(--accent)' : undefined }}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                    editForm.isActive ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>
            <ModalFooter onCancel={() => setModal(null)} onSave={handleEdit} saving={saving} saveLabel="Save Changes" />
          </div>
        </div>
      )}

      {/* Reset Password modal */}
      {modal === 'password' && editTarget && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Reset Password</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {editTarget.name} · {editTarget.email}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-600 dark:text-amber-400">
                ⚠️ All of this user&apos;s active sessions will be revoked after the reset. They&apos;ll need to log in again.
              </div>
              <FormField label="New Password (min 8 chars)">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Enter new password"
                  autoFocus
                />
                <button
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-xs mt-1 hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </FormField>
            </div>
            <ModalFooter
              onCancel={() => setModal(null)}
              onSave={handleResetPassword}
              saving={saving}
              saveLabel="Reset Password"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reusable sub-components ──────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalFooter({
  onCancel, onSave, saving, saveLabel,
}: { onCancel: () => void; onSave: () => void; saving: boolean; saveLabel: string }) {
  return (
    <div className="px-6 pb-5 flex gap-3">
      <button
        onClick={onCancel}
        className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
        style={{ background: 'var(--accent)' }}
      >
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  );
}
