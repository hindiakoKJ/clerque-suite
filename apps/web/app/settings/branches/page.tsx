'use client';
/**
 * Settings → Branches
 *
 * Tenants on multi-branch plans use this to manage their physical locations.
 * Lists existing branches, lets the owner add a new one (subject to plan
 * cap), rename, change address, or deactivate.
 *
 * Plan cap is enforced server-side (POST /tenant/branches throws
 * BRANCH_CAP_REACHED). The UI also shows usage so the owner sees how many
 * slots they have left before they hit the wall.
 *
 * BUSINESS_OWNER + SUPER_ADMIN only — staff cannot manage branches.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Building2, Pencil, ToggleRight, ToggleLeft, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { planLabel, type PlanCode } from '@repo/shared-types';

interface Branch {
  id:       string;
  name:     string;
  address:  string | null;
  isActive: boolean;
}

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

export default function BranchesPage() {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  const qc      = useQueryClient();

  const planCode    = (user as any)?.planCode as PlanCode | undefined;
  const maxBranches = (user as any)?.planLimits?.maxBranches ?? 1;

  const [modal, setModal] = useState<'create' | { id: string } | null>(null);
  const [form,  setForm]  = useState({ name: '', address: '' });

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
    queryKey: ['tenant-branches-manage'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
    enabled:  !!user,
  });

  const activeCount  = branches.filter((b) => b.isActive).length;
  const remaining    = Math.max(0, maxBranches - activeCount);
  const atCap        = activeCount >= maxBranches;

  const createBranch = useMutation({
    mutationFn: (body: { name: string; address: string }) =>
      api.post('/tenant/branches', body).then((r) => r.data),
    onSuccess: () => {
      toast.success('Branch added');
      qc.invalidateQueries({ queryKey: ['tenant-branches-manage'] });
      qc.invalidateQueries({ queryKey: ['tenant-branches'] });
      setModal(null);
      setForm({ name: '', address: '' });
    },
    onError: (err: any) => {
      const code = err?.response?.data?.code;
      if (code === 'BRANCH_CAP_REACHED') {
        toast.error(err.response.data.message ?? 'Branch cap reached.');
      } else {
        toast.error(err?.response?.data?.message ?? 'Failed to add branch');
      }
    },
  });

  const updateBranch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Branch> }) =>
      api.patch(`/tenant/branches/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('Branch updated');
      qc.invalidateQueries({ queryKey: ['tenant-branches-manage'] });
      qc.invalidateQueries({ queryKey: ['tenant-branches'] });
      setModal(null);
    },
    onError: (err: any) => {
      const code = err?.response?.data?.code;
      if (code === 'BRANCH_CAP_REACHED') {
        toast.error(err.response.data.message ?? 'Branch cap reached.');
      } else {
        toast.error(err?.response?.data?.message ?? 'Failed to update branch');
      }
    },
  });

  if (!isOwner) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">Only Business Owners can manage branches.</p>
      </div>
    );
  }

  function openCreate() {
    setForm({ name: '', address: '' });
    setModal('create');
  }
  function openEdit(b: Branch) {
    setForm({ name: b.name, address: b.address ?? '' });
    setModal({ id: b.id });
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </Link>

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[var(--accent)]" /> Branches
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Add or rename your physical locations. Plan: {planCode ? planLabel(planCode) : '—'} ·
            {' '}
            <span className={atCap ? 'text-amber-600 font-medium' : ''}>
              {activeCount} of {maxBranches} active
            </span>
            {!atCap && remaining > 0 && (
              <span className="text-muted-foreground"> · {remaining} slot{remaining === 1 ? '' : 's'} left</span>
            )}
          </p>
        </div>
        <button
          onClick={openCreate}
          disabled={atCap}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          title={atCap ? `Plan cap reached — upgrade to add more branches.` : 'Add a branch'}
        >
          {atCap ? <Lock className="w-3.5 h-3.5" /> : <Plus className="w-4 h-4" />}
          Add Branch
        </button>
      </header>

      {atCap && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            <strong>Plan cap reached.</strong> Your {planCode ? planLabel(planCode) : 'current'} plan allows {maxBranches}{' '}
            active branch{maxBranches === 1 ? '' : 'es'}.{' '}
            <Link href="/settings/subscription" className="underline font-medium">Upgrade your plan</Link> to add more.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card h-32 animate-pulse" />
      ) : branches.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Building2 className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No branches yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {branches.map((b) => (
            <div key={b.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{b.name}</p>
                  {!b.isActive && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
                      Inactive
                    </span>
                  )}
                </div>
                {b.address && <p className="text-xs text-muted-foreground truncate mt-0.5">{b.address}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEdit(b)}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() =>
                    updateBranch.mutate({ id: b.id, body: { isActive: !b.isActive } })
                  }
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                  title={b.isActive ? 'Deactivate' : 'Reactivate'}
                  disabled={updateBranch.isPending}
                >
                  {b.isActive
                    ? <ToggleRight className="w-5 h-5 text-emerald-500" />
                    : <ToggleLeft  className="w-5 h-5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {modal && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold">{modal === 'create' ? 'New Branch' : 'Edit Branch'}</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Branch name <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="e.g. Main, Cebu, Cubao"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Address</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  rows={2}
                  className={`${INPUT_CLS} resize-none`}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (form.name.trim().length < 2) {
                    toast.error('Branch name must be at least 2 characters');
                    return;
                  }
                  if (modal === 'create') {
                    createBranch.mutate({ name: form.name.trim(), address: form.address.trim() });
                  } else {
                    updateBranch.mutate({
                      id: modal.id,
                      body: { name: form.name.trim(), address: form.address.trim() || null },
                    });
                  }
                }}
                disabled={createBranch.isPending || updateBranch.isPending}
                className="text-sm px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40"
              >
                {modal === 'create' ? 'Add Branch' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
