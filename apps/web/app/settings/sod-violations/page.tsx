'use client';

/**
 * Settings → SOD Violations Log
 *
 * Read-only viewer for AuditLog records with action='SOD_OVERRIDE_GRANTED'.
 * Shows when a Business Owner accepted a yellow Segregation-of-Duties warning
 * when assigning permissions to a staff member.
 *
 * Until the Staff Management UI (RBAC Phase 5) ships, this page will simply
 * show "no overrides yet" — that's expected.
 *
 * Roles allowed: BUSINESS_OWNER, ACCOUNTANT, FINANCE_LEAD, EXTERNAL_AUDITOR
 * (mirrors the audit endpoint guards).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert, User, Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface AuditRecord {
  id:          string;
  action:      string;
  entityType:  string;
  entityId:    string;
  description: string | null;
  before:      unknown;
  after:       unknown;
  performedBy: string | null;
  ipAddress:   string | null;
  createdAt:   string;
}

interface AuditPage {
  data:  AuditRecord[];
  total: number;
  page:  number;
  pages: number;
}

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
  const [page, setPage] = useState(1);

  useEffect(() => { setMounted(true); }, []);

  const { data, isLoading } = useQuery<AuditPage>({
    queryKey: ['audit-sod-overrides', page],
    queryFn:  async () => (
      await api.get(`/audit?action=SOD_OVERRIDE_GRANTED&page=${page}`)
    ).data,
    enabled:  !!user && !!user.role && ALLOWED_ROLES.has(user.role),
  });

  if (!mounted) return null;
  if (!user?.role || !ALLOWED_ROLES.has(user.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">
          Only Business Owners, Accountants, and Auditors can view the SOD log.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-500/10 p-2.5">
            <ShieldAlert className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">SOD Violations Log</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Every time the owner explicitly accepts a Segregation-of-Duties warning when assigning
              permissions, a record lands here. Records are immutable.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">No SOD overrides recorded.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Either nobody has been granted a permission combination that triggers a warning,
              or the staff editor hasn't been used yet.
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {data.data.map((rec) => {
                const after = rec.after as { ruleId?: string; reason?: string; permissions?: string[] } | null;
                return (
                  <li key={rec.id} className="rounded-xl border border-amber-300/50 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-950/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded font-bold uppercase tracking-wide bg-amber-500/20 text-amber-800 dark:text-amber-300">
                            {after?.ruleId ?? 'unknown rule'}
                          </span>
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            <User className="w-3 h-3" />
                            User {rec.entityId.slice(0, 8)}
                          </span>
                        </div>
                        <p className="text-sm text-foreground">
                          {rec.description ?? 'SOD override granted'}
                        </p>
                        {after?.reason && (
                          <p className="text-sm italic text-amber-900 dark:text-amber-200/90">
                            "{after.reason}"
                          </p>
                        )}
                        {after?.permissions && after.permissions.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {after.permissions.map((p) => (
                              <span key={p} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(rec.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(rec.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {data.pages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  Page {data.page} of {data.pages} · {data.total} records
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                    disabled={page >= data.pages}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
