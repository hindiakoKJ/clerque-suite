'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Spinner } from '@/components/ui/Spinner';

interface ConsoleLogEntry {
  id:              string;
  superAdminEmail: string;
  tenantId:        string | null;
  tenantSlug:      string | null;
  userId:          string | null;
  userEmail:       string | null;
  action:          string;
  detail:          Record<string, unknown> | null;
  createdAt:       string;
}

const ACTION_BADGE: Record<string, string> = {
  TENANT_CREATED:  'bg-emerald-100 text-emerald-700',
  USER_CREATED:    'bg-blue-100 text-blue-700',
  PASSWORD_RESET:  'bg-amber-100 text-amber-700',
  ACCOUNT_UNLOCKED:'bg-cyan-100 text-cyan-700',
  FORCE_LOGOUT:    'bg-orange-100 text-orange-700',
  USER_DEACTIVATED:'bg-red-100 text-red-700',
  USER_REACTIVATED:'bg-teal-100 text-teal-700',
  TIER_CHANGED:    'bg-violet-100 text-violet-700',
  STATUS_CHANGED:  'bg-pink-100 text-pink-700',
  AI_OVERRIDE_SET: 'bg-indigo-100 text-indigo-700',
};

const ACTION_LABEL: Record<string, string> = {
  TENANT_CREATED:  'Tenant Created',
  USER_CREATED:    'User Added',
  PASSWORD_RESET:  'Password Reset',
  ACCOUNT_UNLOCKED:'Account Unlocked',
  FORCE_LOGOUT:    'Force Logout',
  USER_DEACTIVATED:'User Deactivated',
  USER_REACTIVATED:'User Reactivated',
  TIER_CHANGED:    'Tier Changed',
  STATUS_CHANGED:  'Status Changed',
  AI_OVERRIDE_SET: 'AI Override Set',
};

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const user = useAuthStore((s) => s.user);
  const [page, setPage] = useState(0);
  const [tenantFilter, setTenantFilter] = useState('');

  const isSuper = !!(user?.isSuperAdmin || user?.role === 'SUPER_ADMIN');
  const offset = page * PAGE_SIZE;

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (tenantFilter.trim()) params.set('tenantId', tenantFilter.trim());

  const { data, isLoading } = useQuery<{ logs: ConsoleLogEntry[]; total: number }>({
    queryKey: ['admin-console-log', page, tenantFilter],
    queryFn:  () => api.get(`/admin/console-log?${params}`).then((r) => r.data),
    enabled:  isSuper,
  });

  const logs  = data?.logs ?? [];
  const total = data?.total ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-[var(--accent)]" />
          Console Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every admin action taken in Console — immutable, append-only.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-xs">
          <label className="text-xs text-muted-foreground block mb-1">Filter by Tenant ID</label>
          <input value={tenantFilter} onChange={(e) => { setTenantFilter(e.target.value); setPage(0); }}
            placeholder="Tenant ID or leave blank for all"
            className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-mono" />
        </div>
        <div className="text-xs text-muted-foreground self-end mb-2">
          {total.toLocaleString()} total entries
        </div>
      </div>

      {isLoading ? (
        <Spinner size="lg" message="Loading audit log…" />
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
          No audit entries yet.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-background overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left p-2.5 w-36">When</th>
                  <th className="text-left p-2.5 w-36">Action</th>
                  <th className="text-left p-2.5">Actor</th>
                  <th className="text-left p-2.5">Tenant</th>
                  <th className="text-left p-2.5">User affected</th>
                  <th className="text-left p-2.5">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-border hover:bg-muted/20">
                    <td className="p-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-PH', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="p-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ACTION_BADGE[log.action] ?? 'bg-gray-100 text-gray-600'}`}>
                        {ACTION_LABEL[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="p-2.5 text-xs font-medium">{log.superAdminEmail}</td>
                    <td className="p-2.5 text-xs">
                      {log.tenantSlug ? (
                        <span className="font-mono text-muted-foreground">{log.tenantSlug}</span>
                      ) : '—'}
                    </td>
                    <td className="p-2.5 text-xs text-muted-foreground">
                      {log.userEmail ?? '—'}
                    </td>
                    <td className="p-2.5 text-xs text-muted-foreground font-mono max-w-[200px] truncate" title={JSON.stringify(log.detail ?? {})}>
                      {log.detail ? JSON.stringify(log.detail) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Page {page + 1} of {pages} ({total} entries)</span>
              <div className="flex items-center gap-1">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                  className="h-8 w-8 rounded-md border border-border hover:bg-muted disabled:opacity-40 flex items-center justify-center">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}
                  className="h-8 w-8 rounded-md border border-border hover:bg-muted disabled:opacity-40 flex items-center justify-center">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
