'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Filter, AlertTriangle, Clock, Building2, User as UserIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Badge } from '@/components/ui/Badge';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AuditRecord {
  id:          string;
  action:      string;
  entityType:  string;
  entityId:    string;
  description: string | null;
  before:      Record<string, unknown> | null;
  after:       Record<string, unknown> | null;
  performedBy: string | null;
  ipAddress:   string | null;
  createdAt:   string;
  /**
   * 'TENANT' = your own staff did this
   * 'PLATFORM' = HNS Corp PH platform admin (e.g. for support, tier change, etc.)
   * Showing platform admin actions transparently is a trust commitment —
   * tenants always know when the platform operator touched their account.
   */
  source?:     'TENANT' | 'PLATFORM';
}

interface PagedResponse {
  data:  AuditRecord[];
  total: number;
  page:  number;
  pages: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { label: string; tone: 'success' | 'warn' | 'danger' | 'default' }> = {
  VOID_PROCESSED:     { label: 'Order Void',        tone: 'danger'  },
  TAX_STATUS_CHANGED: { label: 'Tax Status Change',  tone: 'warn'    },
  TIN_UPDATED:        { label: 'TIN Updated',        tone: 'warn'    },
  SETTING_CHANGED:    { label: 'Setting Changed',    tone: 'default' },
  PRICE_CHANGED:      { label: 'Price Changed',      tone: 'warn'    },
  PERIOD_CLOSED:      { label: 'Period Closed',      tone: 'default' },
  PERIOD_REOPENED:    { label: 'Period Reopened',    tone: 'warn'    },
  USER_CREATED:       { label: 'User Created',       tone: 'success' },
  USER_DEACTIVATED:   { label: 'User Deactivated',   tone: 'danger'  },
};

const ENTITY_TYPES = ['', 'Order', 'Tenant', 'User', 'Product', 'AccountingPeriod'];
const ACTION_KEYS  = ['', ...Object.keys(ACTION_LABELS)];

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function JsonDiff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return <span className="text-muted-foreground text-xs">No snapshot</span>;
  return (
    <div className="grid grid-cols-2 gap-3 text-xs font-mono">
      {before && (
        <div>
          <p className="text-muted-foreground font-sans font-semibold mb-1">Before</p>
          <pre className="bg-red-500/5 border border-red-400/20 rounded p-2 whitespace-pre-wrap break-all text-red-600 dark:text-red-400">
            {JSON.stringify(before, null, 2)}
          </pre>
        </div>
      )}
      {after && (
        <div>
          <p className="text-muted-foreground font-sans font-semibold mb-1">After</p>
          <pre className="bg-green-500/5 border border-green-400/20 rounded p-2 whitespace-pre-wrap break-all text-green-600 dark:text-green-400">
            {JSON.stringify(after, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const user = useAuthStore((s) => s.user);
  const [page,       setPage]       = useState(1);
  const [action,     setAction]     = useState('');
  const [entityType, setEntityType] = useState('');
  const [expanded,   setExpanded]   = useState<string | null>(null);

  const { data, isLoading } = useQuery<PagedResponse>({
    queryKey: ['audit-log', page, action, entityType],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (action)     params.set('action',     action);
      if (entityType) params.set('entityType', entityType);
      return api.get(`/audit?${params}`).then((r) => r.data);
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const records = data?.data ?? [];
  const total   = data?.total ?? 0;
  const pages   = data?.pages ?? 1;

  function applyFilter() { setPage(1); }

  return (
    <div className="flex flex-col h-full overflow-auto">

      {/* Header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Audit Log</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Immutable trail of all sensitive changes — BIR CAS compliant
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              value={action}
              onChange={(e) => { setAction(e.target.value); applyFilter(); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">All actions</option>
              {ACTION_KEYS.filter(Boolean).map((k) => (
                <option key={k} value={k}>{ACTION_LABELS[k]?.label ?? k}</option>
              ))}
            </select>
            <select
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value); applyFilter(); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{t || 'All types'}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Warning banner */}
      <div className="px-4 sm:px-6 pt-4 shrink-0 space-y-2">
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Audit records are <strong>immutable</strong> — they cannot be edited or deleted.
            This log is required for BIR CAS (Computerized Accounting System) accreditation.
          </p>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-blue-500/30 bg-blue-500/8 px-4 py-3">
          <Building2 className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-400">
            <strong>Platform transparency:</strong> any action performed on your account by an
            HNS Corp PH platform admin (e.g. tier upgrade, support intervention) appears here
            with a <span className="font-semibold">Platform</span> badge — so you always know
            when the platform operator touched your data.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 sm:p-6 space-y-3 overflow-auto">
        {isLoading ? (
          <div className="space-y-3">
            {[0,1,2,3,4].map((i) => (
              <div key={i} className="bg-background border border-border rounded-lg p-4 flex gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ShieldCheck className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No audit records found.</p>
            <p className="text-xs mt-1">Sensitive changes will appear here as they happen.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{total.toLocaleString()} record{total !== 1 ? 's' : ''}</p>
            <div className="bg-background border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-6 px-4 py-3" />
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">When</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entity</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {records.map((rec) => {
                      const isOpen = expanded === rec.id;
                      const meta   = ACTION_LABELS[rec.action];
                      const hasDiff = rec.before || rec.after;
                      const isPlatform = rec.source === 'PLATFORM';
                      return (
                        <>
                          <tr
                            key={rec.id}
                            onClick={() => hasDiff && setExpanded(isOpen ? null : rec.id)}
                            className={`transition-colors ${hasDiff ? 'cursor-pointer hover:bg-muted/30' : ''} ${isPlatform ? 'bg-blue-500/[0.03]' : ''}`}
                          >
                            <td className="px-4 py-3 text-muted-foreground">
                              {hasDiff && (
                                isOpen
                                  ? <ChevronUp className="h-3.5 w-3.5" />
                                  : <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3 w-3 shrink-0" />
                                {fmtDate(rec.createdAt)}
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <Badge tone={meta?.tone ?? 'default'}>
                                  {meta?.label ?? rec.action}
                                </Badge>
                                {isPlatform && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                    <Building2 className="h-2.5 w-2.5" />
                                    PLATFORM
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              <span className="font-medium text-foreground">{rec.entityType}</span>
                              <span className="ml-1 font-mono text-[10px] opacity-60 truncate max-w-[80px] inline-block align-bottom">
                                {rec.entityId.slice(0, 8)}…
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[240px] truncate">
                              {rec.description ?? '—'}
                              {isPlatform && rec.performedBy && (
                                <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                                  <UserIcon className="h-2.5 w-2.5" />
                                  {rec.performedBy}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                              {rec.ipAddress ?? '—'}
                            </td>
                          </tr>

                          {/* Expanded diff row */}
                          {isOpen && (
                            <tr key={`${rec.id}-diff`} className="bg-muted/20">
                              <td colSpan={6} className="px-6 py-4">
                                <JsonDiff before={rec.before} after={rec.after} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">Page {page} of {pages}</p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page === pages}
                    className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
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
