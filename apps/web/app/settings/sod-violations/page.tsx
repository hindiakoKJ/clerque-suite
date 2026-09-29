'use client';

/**
 * Settings → Role-change conflicts
 *
 * Read-only list of staff whose role history crosses a Segregation-of-Duties
 * conflict pair (GET /audit/sod-violations, computed from PERMISSIONS_UPDATED
 * audit rows).
 *
 * This page used to also list "SOD overrides" (AuditLog action
 * SOD_OVERRIDE_GRANTED). Nothing in the product ever writes that row — the
 * permission editor evaluates its warning in the browser and never sends an
 * override — so the list said "No SOD overrides recorded" forever and read as
 * assurance. It was removed rather than left as a false clean signal.
 *
 * Roles allowed: BUSINESS_OWNER, ACCOUNTANT, FINANCE_LEAD, EXTERNAL_AUDITOR
 * (mirrors the audit endpoint guards).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert, User } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

const ALLOWED_ROLES = new Set([
  'BUSINESS_OWNER',
  'SUPER_ADMIN',
  'ACCOUNTANT',
  'FINANCE_LEAD',
  'EXTERNAL_AUDITOR',
]);

export default function SodViolationsPage() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Audit D4-05 — Historical role-change conflicts. Pulls the list of
  // users whose role history crosses an SOD-conflict pair (e.g. someone
  // who was AP_ACCOUNTANT and is now PAYROLL_MASTER could have invoiced
  // a fake supplier and is now in a position to pay themselves).
  interface SodViolation {
    userId:      string;
    userName:    string;
    currentRole: string | null;
    history:     Array<{ role: string; fromDate: string; toDate: string | null }>;
    conflicts:   string[];
  }
  const { data: sodViolations, isLoading: sodLoading } = useQuery<SodViolation[]>({
    queryKey: ['audit-sod-violations'],
    queryFn:  async () => (await api.get('/audit/sod-violations')).data,
    enabled:  !!user && !!user.role && ALLOWED_ROLES.has(user.role),
  });

  if (!mounted) return null;
  if (!user?.role || !ALLOWED_ROLES.has(user.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">
          Only Business Owners, Accountants, and Auditors can view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Back compacts history (router.back) so /settings → /settings/<sub>
            → back returns to /settings, then back again exits Settings to
            wherever the user came from. Falls back to /settings push when
            we landed here directly (no history). */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) router.back();
            else router.push('/settings');
          }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Settings
        </button>

        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-500/10 p-2.5">
            <ShieldAlert className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Role-change conflicts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Staff who have held two roles that should stay in separate hands, even if not at the
              same time. Built from the role-change history, so it cannot be edited.
            </p>
          </div>
        </div>

        {/* Audit D4-05 — Historical role-change conflicts */}
        <section className="space-y-3 pt-2">
          <h2 className="text-sm font-semibold text-foreground">
            Historical role-change conflicts
          </h2>
          <p className="text-xs text-muted-foreground -mt-1">
            Users whose role history crosses an SOD-conflict pair. Even if the
            two roles never overlapped in time, the same person could have
            controlled both sides at different points — worth sampling.
          </p>
          {sodLoading ? (
            <div className="h-16 rounded-xl bg-muted animate-pulse" />
          ) : !sodViolations || sodViolations.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <p className="text-xs text-muted-foreground">
                No historical role-change conflicts detected.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {sodViolations.map((v) => (
                <li
                  key={v.userId}
                  className="rounded-xl border border-rose-300/50 dark:border-rose-700/40 bg-rose-50/50 dark:bg-rose-950/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded font-bold uppercase tracking-wide bg-rose-500/20 text-rose-800 dark:text-rose-300">
                          {v.currentRole ?? '—'}
                        </span>
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {v.userName}
                        </span>
                      </div>
                      <ul className="text-sm text-foreground list-disc list-inside">
                        {v.conflicts.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                      <p className="text-[11px] text-muted-foreground pt-1">
                        Role history:{' '}
                        {v.history
                          .map(
                            (h) =>
                              `${h.role} (${new Date(h.fromDate).toLocaleDateString('en-PH')})`,
                          )
                          .join(' → ')}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
