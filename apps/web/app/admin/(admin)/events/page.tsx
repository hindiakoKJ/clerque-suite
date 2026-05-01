'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Spinner } from '@/components/ui/Spinner';

interface FailedEvent {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  lastError: string | null;
  retryCount: number;
  createdAt: string;
  tenant: { name: string; slug: string };
}

export default function FailedEventsPage() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery<FailedEvent[]>({
    queryKey: ['admin-failed-events'],
    queryFn:  () => api.get('/admin/failed-events?limit=100').then((r) => r.data),
    enabled:  !!user?.isSuperAdmin,
    refetchInterval: 30_000,
  });

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          Failed Accounting Events
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cross-tenant view of stuck POS events. Each failure represents a transaction
          that didn&apos;t make it into the GL — needs triage.
        </p>
      </div>

      {isLoading ? (
        <Spinner size="lg" message="Loading failed events…" />
      ) : (data?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          No failed events. All POS transactions are flowing into the GL cleanly.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left p-2">Tenant</th>
                <th className="text-left p-2 w-24">Type</th>
                <th className="text-left p-2 w-16">Retries</th>
                <th className="text-left p-2">Error</th>
                <th className="text-left p-2 w-32">When</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="p-2">
                    <div className="font-medium">{e.tenant.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{e.tenant.slug}</div>
                  </td>
                  <td className="p-2">
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted">{e.type}</span>
                  </td>
                  <td className="p-2 text-right tabular-nums">{e.retryCount}</td>
                  <td className="p-2 text-xs text-red-600 break-all">{e.lastError ?? '(no message)'}</td>
                  <td className="p-2 text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString('en-PH')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
