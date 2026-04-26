'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Zap, RefreshCw, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';

type EventStatus = 'PENDING' | 'SYNCED' | 'FAILED';
type EventType = 'SALE' | 'COGS' | 'VOID' | 'RETURN' | 'EOD_SUMMARY' | 'INVENTORY_ADJUSTMENT' | 'SETTLEMENT';

interface AccountingEvent {
  id: string;
  type: EventType;
  status: EventStatus;
  payload: Record<string, unknown>;
  retryCount: number;
  lastError?: string;
  syncedAt?: string;
  createdAt: string;
  order?: { orderNumber: string } | null;
  journalEntry?: { id: string; entryNumber: string } | null;
}

interface EventsResponse {
  data: AccountingEvent[];
  total: number;
  page: number;
  pages: number;
}

const STATUS_TABS: { label: string; value: EventStatus | 'ALL' }[] = [
  { label: 'All',     value: 'ALL'     },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Synced',  value: 'SYNCED'  },
  { label: 'Failed',  value: 'FAILED'  },
];

export default function EventsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canProcess = user?.role === 'BUSINESS_OWNER' || user?.role === 'ACCOUNTANT' || user?.isSuperAdmin;

  const [statusFilter,   setStatusFilter]   = useState<EventStatus | 'ALL'>('PENDING');
  const [page,           setPage]           = useState(1);
  const [expanded,       setExpanded]       = useState<Set<string>>(new Set());
  const [processing,     setProcessing]     = useState<Set<string>>(new Set());
  const [processingAll,  setProcessingAll]  = useState(false);

  const { data, isLoading, refetch } = useQuery<EventsResponse>({
    queryKey: ['accounting-events', statusFilter, page],
    queryFn: () => {
      const qs = `?page=${page}${statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''}`;
      return api.get(`/accounting/events${qs}`).then((r) => r.data);
    },
    enabled: !!user,
    refetchInterval: 15_000,
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function processOne(id: string) {
    setProcessing((prev) => new Set(prev).add(id));
    try {
      const { data: result } = await api.post(`/accounting/events/${id}/process`);
      toast.success(
        result.skipped
          ? 'Event skipped (no-op)'
          : `Journal entry ${result.journalEntry?.entryNumber} created`,
      );
      refetch();
      qc.invalidateQueries({ queryKey: ['accounting-event-stats'] });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to process event');
    } finally {
      setProcessing((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  async function processAll() {
    setProcessingAll(true);
    try {
      const { data: result } = await api.post('/accounting/events/process-all');
      toast.success(`Processed: ${result.synced} synced · ${result.failed} failed · ${result.skipped} skipped`);
      refetch();
      qc.invalidateQueries({ queryKey: ['accounting-event-stats'] });
    } catch {
      toast.error('Failed to process events');
    } finally {
      setProcessingAll(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-amber-500" />
            Accounting Event Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{data?.total ?? 0} events</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => refetch()}
            className="h-9 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          {canProcess && (
            <button
              onClick={processAll}
              disabled={processingAll}
              className="flex items-center gap-1.5 h-9 px-4 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              <Zap className="h-4 w-4" />
              {processingAll ? 'Processing…' : 'Process All Pending'}
            </button>
          )}
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-5 bg-muted p-1 rounded-xl w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setPage(1); }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading events…</div>
      ) : (
        <>
          <div className="bg-background rounded-xl border border-border overflow-hidden">
            {!data?.data.length ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {statusFilter === 'PENDING' ? 'All events are processed ✓' : 'No events found'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[580px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase">
                      <th className="px-4 py-2 w-8" />
                      <th className="px-4 py-2 text-left font-semibold">Type</th>
                      <th className="px-4 py-2 text-left font-semibold">Order</th>
                      <th className="px-4 py-2 text-left font-semibold">Created</th>
                      <th className="px-4 py-2 text-left font-semibold">Status</th>
                      <th className="px-4 py-2 text-left font-semibold">Journal Entry</th>
                      {canProcess && <th className="px-4 py-2 w-24" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.data.map((evt) => {
                      const open = expanded.has(evt.id);
                      return (
                        <>
                          <tr key={evt.id} className="hover:bg-muted/40 transition-colors">
                            <td
                              className="px-4 py-2.5 cursor-pointer text-muted-foreground"
                              onClick={() => toggleExpand(evt.id)}
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </td>
                            <td className="px-4 py-2.5">
                              <EventTypeBadge type={evt.type} />
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                              {evt.order?.orderNumber ?? '—'}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                              {new Date(evt.createdAt).toLocaleString('en-PH', {
                                month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </td>
                            <td className="px-4 py-2.5">
                              <EventStatusBadge status={evt.status} retryCount={evt.retryCount} />
                            </td>
                            <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                              {evt.journalEntry?.entryNumber ?? '—'}
                            </td>
                            {canProcess && (
                              <td className="px-4 py-2.5">
                                {evt.status !== 'SYNCED' && (
                                  <button
                                    onClick={() => processOne(evt.id)}
                                    disabled={processing.has(evt.id)}
                                    className="px-2.5 py-1 text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                                    style={{
                                      background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
                                      color: 'var(--accent)',
                                    }}
                                  >
                                    {processing.has(evt.id) ? '…' : 'Process'}
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                          {open && (
                            <tr key={`${evt.id}-payload`}>
                              <td colSpan={canProcess ? 7 : 6} className="px-6 pb-4 bg-muted/30">
                                {evt.lastError && (
                                  <div className="mb-2 text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-700 rounded-lg px-3 py-2">
                                    Error: {evt.lastError}
                                  </div>
                                )}
                                <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto text-foreground max-h-48">
                                  {JSON.stringify(evt.payload, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(data?.pages ?? 0) > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-muted-foreground">Page {data?.page} of {data?.pages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(data?.pages ?? 1, p + 1))}
                  disabled={page === (data?.pages ?? 1)}
                  className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EventTypeBadge({ type }: { type: EventType }) {
  const styles: Record<EventType, string> = {
    SALE:                 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    COGS:                 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    VOID:                 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    RETURN:               'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    EOD_SUMMARY:          'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    INVENTORY_ADJUSTMENT: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    SETTLEMENT:           'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[type]}`}>
      {type}
    </span>
  );
}

function EventStatusBadge({ status, retryCount }: { status: EventStatus; retryCount: number }) {
  if (status === 'SYNCED') return (
    <span className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> Synced
    </span>
  );
  if (status === 'FAILED') return (
    <span className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
      <XCircle className="h-3.5 w-3.5" /> Failed {retryCount > 0 ? `(${retryCount}x)` : ''}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
      <AlertCircle className="h-3.5 w-3.5" /> Pending
    </span>
  );
}
