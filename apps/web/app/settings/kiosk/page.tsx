'use client';
/**
 * Sprint 19 — Sync kiosk-mode terminal management.
 *
 * Owner enrolls a tablet here. The new-terminal modal shows the enrollment
 * URL ONCE (with the apiKey embedded); after closing, the key is hidden.
 * The owner copies the URL, opens it on the tablet, and "Add to Home Screen"
 * to make it a standalone fullscreen kiosk app.
 *
 * Each row shows: name, branch scope, status, last-used, and a Revoke button
 * that immediately rotates the apiKey (the device on site stops working).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Tv, Copy, Trash2, Pause, Play, X, ExternalLink, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface Branch { id: string; name: string }
interface Terminal {
  id: string;
  name: string;
  apiKey: string;
  isActive: boolean;
  lastUsedAt: string | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  createdAt: string;
}

export default function KioskSettingsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const { data: terminals = [], isLoading } = useQuery<Terminal[]>({
    queryKey: ['kiosk-terminals'],
    queryFn:  () => api.get('/payroll/kiosk/terminals').then((r) => r.data),
    enabled:  !!user,
  });

  // Sprint 19 — Self-service clock-in policy. Default off (kiosk-only).
  const { data: policy } = useQuery<{ allowSelfClockIn: boolean }>({
    queryKey: ['kiosk-policy'],
    queryFn:  () => api.get('/payroll/kiosk/policy').then((r) => r.data),
    enabled:  !!user,
  });
  const policyMut = useMutation({
    mutationFn: (next: boolean) =>
      api.patch('/payroll/kiosk/policy', { allowSelfClockIn: next }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kiosk-policy'] });
      toast.success('Policy updated. Staff need to log out and back in to see the change in their app.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed.'),
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/users/branches').then((r) => r.data),
    enabled:  !!user,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState('');
  const [newBranch,  setNewBranch]  = useState<string>('');
  const [enrolledTerminal, setEnrolledTerminal] = useState<Terminal | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kiosk-terminals'] });

  const createMut = useMutation({
    mutationFn: () => api.post<Terminal>('/payroll/kiosk/terminals', {
      name: newName.trim(),
      branchId: newBranch || null,
    }).then((r) => r.data),
    onSuccess: (terminal) => {
      invalidate();
      setShowCreate(false);
      setNewName(''); setNewBranch('');
      setEnrolledTerminal(terminal);
      toast.success('Kiosk enrolled.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to enroll.'),
  });

  const toggleMut = useMutation({
    mutationFn: (t: Terminal) =>
      api.patch(`/payroll/kiosk/terminals/${t.id}`, { isActive: !t.isActive }).then((r) => r.data),
    onSuccess: () => { invalidate(); toast.success('Updated.'); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed.'),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/payroll/kiosk/terminals/${id}`).then((r) => r.data),
    onSuccess: () => {
      invalidate();
      toast.success('Kiosk revoked. The device on-site has stopped working.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to revoke.'),
  });

  function kioskUrl(apiKey: string) {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/payroll/kiosk?key=${apiKey}`;
  }

  const inputCls = 'w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back();
          else router.push('/settings');
        }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Tv className="h-6 w-6 text-[var(--accent)]" />
            Kiosk Terminals
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            One shared tablet on the wall lets every employee clock in and out with their PIN.
            Set the PIN per staff under <a href="/pos/staff" className="underline">POS → Staff</a>,
            then enroll a kiosk here and open the URL on the tablet.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Enroll kiosk
        </button>
      </div>

      {/* Self-service clock-in policy */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Smartphone className="h-5 w-5 text-[var(--accent)] mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Allow staff to clock in from their own account</div>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                When this is OFF (default), staff can&apos;t clock in/out from the Sync app on their personal device — they
                must punch their PIN at the shared kiosk tablet onsite. Turn it ON to give every employee the
                option to track their own attendance from their phone or laptop.
              </p>
            </div>
          </div>
          <button
            onClick={() => policyMut.mutate(!(policy?.allowSelfClockIn))}
            disabled={policyMut.isPending}
            className="w-11 h-6 rounded-full transition-colors shrink-0 mt-0.5"
            style={{ background: policy?.allowSelfClockIn ? 'var(--accent)' : 'hsl(var(--muted-foreground) / 0.3)' }}
            aria-label="Toggle self-service clock-in"
          >
            <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
              policy?.allowSelfClockIn ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : terminals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Tv className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No kiosks enrolled yet.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Branch scope</th>
                <th className="text-left px-4 py-2">Last used</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {terminals.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.branch?.name ?? 'Any branch'}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {t.isActive
                      ? <span className="rounded px-2 py-0.5 text-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">ACTIVE</span>
                      : <span className="rounded px-2 py-0.5 text-xs bg-muted text-muted-foreground">PAUSED</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        title="Copy kiosk URL"
                        onClick={() => {
                          navigator.clipboard.writeText(kioskUrl(t.apiKey));
                          toast.success('Kiosk URL copied');
                        }}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        title={t.isActive ? 'Pause' : 'Resume'}
                        onClick={() => toggleMut.mutate(t)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        {t.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <button
                        title="Revoke (rotate apiKey + deactivate)"
                        onClick={() => {
                          if (confirm(`Revoke "${t.name}"? The tablet on site will immediately stop working.`)) {
                            revokeMut.mutate(t.id);
                          }
                        }}
                        className="p-1.5 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-card border border-border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Enroll a kiosk</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs uppercase text-muted-foreground tracking-wider">Kiosk name</span>
                <input
                  className={inputCls}
                  placeholder="Front desk kiosk"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-muted-foreground tracking-wider">Branch scope</span>
                <select
                  className={inputCls}
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                >
                  <option value="">Any branch — all staff can use this kiosk</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !newName.trim()}
                className="rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90 disabled:opacity-50"
              >
                {createMut.isPending ? 'Enrolling…' : 'Enroll'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enrollment success — show URL once */}
      {enrolledTerminal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-card border border-border p-5 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Kiosk enrolled · {enrolledTerminal.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Open this URL on the tablet, then add it to the home screen for fullscreen kiosk mode.
                Bookmark it now — for security, the apiKey won't be shown again.
              </p>
            </div>

            <div className="rounded-lg bg-muted/40 px-3 py-2 flex items-center gap-2">
              <code className="text-xs flex-1 break-all">{kioskUrl(enrolledTerminal.apiKey)}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(kioskUrl(enrolledTerminal.apiKey));
                  toast.success('Copied');
                }}
                className="p-1.5 rounded hover:bg-muted shrink-0"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs px-3 py-2">
              <strong>Save this URL now.</strong> If you lose it, revoke the kiosk and enroll a new one — the apiKey can&apos;t be recovered.
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => window.open(kioskUrl(enrolledTerminal.apiKey), '_blank')}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <ExternalLink className="h-4 w-4" /> Open kiosk
              </button>
              <button
                onClick={() => setEnrolledTerminal(null)}
                className="rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
