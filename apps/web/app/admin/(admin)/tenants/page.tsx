'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Building2, Search, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status:        'ACTIVE' | 'GRACE' | 'SUSPENDED';
  tier:          string;
  businessType:  string;
  taxStatus:     string;
  isBirRegistered: boolean;
  aiAddonType:   string | null;
  aiQuotaOverride: number | null;
  createdAt:     string;
  lastLoginAt:   string | null;
  revenue30d:    number;
  orders30d:     number;
  _count:        { users: number; branches: number };
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700',
  GRACE:     'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-red-100 text-red-700',
};

function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  const days = Math.floor(ms / 86_400_000);
  if (days <= 30) return `${days}d ago`;
  if (days <= 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function TenantsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const params = new URLSearchParams();
  if (search.trim())  params.set('search', search.trim());
  if (statusFilter)   params.set('status', statusFilter);

  const { data, isLoading } = useQuery<TenantRow[]>({
    queryKey: ['admin-tenants', search, statusFilter],
    queryFn:  () => api.get(`/admin/tenants?${params}`).then((r) => r.data),
    enabled:  !!user?.isSuperAdmin,
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[var(--accent)]" />
          Tenants
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cross-tenant view. Click any row for detail + actions (suspend, change tier, AI override, force seed).
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground block mb-1">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, slug, or TIN…"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 rounded-md border border-border bg-background text-sm">
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="GRACE">Grace</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <Spinner size="lg" message="Loading tenants…" />
      ) : (data?.length ?? 0) === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No tenants match the filter.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left p-2">Tenant</th>
                <th className="text-left p-2 w-20">Status</th>
                <th className="text-left p-2 w-20">Tier</th>
                <th className="text-left p-2 w-24">Type</th>
                <th className="text-right p-2 w-16">Users</th>
                <th className="text-right p-2 w-28">Rev (30d)</th>
                <th className="text-right p-2 w-20">Orders (30d)</th>
                <th className="text-left p-2 w-24">Last login</th>
                <th className="text-left p-2 w-24">Created</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((t) => (
                <tr key={t.id}
                  onClick={() => router.push(`/admin/tenants/${t.id}`)}
                  className="border-t border-border hover:bg-muted/30 cursor-pointer">
                  <td className="p-2">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{t.slug}</div>
                  </td>
                  <td className="p-2">
                    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[t.status]}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="p-2 text-xs">{t.tier?.replace('TIER_', 'T')}</td>
                  <td className="p-2 text-xs text-muted-foreground">{t.businessType}</td>
                  <td className="p-2 text-right tabular-nums">{t._count.users}</td>
                  <td className="p-2 text-right tabular-nums">{formatPeso(t.revenue30d)}</td>
                  <td className="p-2 text-right tabular-nums">{t.orders30d}</td>
                  <td className="p-2 text-xs text-muted-foreground">{timeAgo(t.lastLoginAt)}</td>
                  <td className="p-2 text-xs text-muted-foreground">{timeAgo(t.createdAt)}</td>
                  <td className="px-2"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
