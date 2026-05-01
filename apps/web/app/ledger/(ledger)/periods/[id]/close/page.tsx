'use client';
/**
 * Period Close Checklist (CLOCO) — guided pre-close flow.
 *
 * Shows every auto-evaluated check + manual attestations for a single
 * accounting period. The Close button enables once all FAIL checks
 * resolve and all MANUAL attestations are ticked.
 */

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, Circle, AlertCircle, ArrowLeft, Lock, ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from 'sonner';

interface Check {
  id:     string;
  group:  string;
  title:  string;
  detail: string;
  status: 'PASS' | 'FAIL' | 'MANUAL' | 'N_A';
  hint?:  string;
  link?:  string;
  count?: number;
}

interface ChecklistResponse {
  period: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: 'OPEN' | 'CLOSED';
  };
  checks: Check[];
  failed: number;
  manual: number;
  ready:  boolean;
}

const ICON_MAP = {
  PASS:   CheckCircle2,
  FAIL:   XCircle,
  MANUAL: Circle,
  N_A:    Circle,
} as const;

const COLOR_MAP = {
  PASS:   'text-emerald-600',
  FAIL:   'text-red-500',
  MANUAL: 'text-amber-600',
  N_A:    'text-muted-foreground',
} as const;

export default function PeriodCloseChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [manualTicked, setManualTicked] = useState<Set<string>>(new Set());

  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';

  const { data, isLoading, refetch } = useQuery<ChecklistResponse>({
    queryKey: ['period-checklist', id],
    queryFn:  () => api.get(`/accounting-periods/${id}/checklist`).then((r) => r.data),
    enabled:  !!user,
  });

  if (isLoading) return <Spinner size="lg" message="Evaluating period close…" />;
  if (!data) return null;

  const { period, checks, failed } = data;
  const manualChecks = checks.filter((c) => c.status === 'MANUAL');
  const allManualConfirmed = manualChecks.every((c) => manualTicked.has(c.id));
  const canClose = period.status === 'OPEN' && failed === 0 && allManualConfirmed && isOwner;

  const groups = Array.from(new Set(checks.map((c) => c.group)));

  async function handleClose() {
    if (!confirm(`Close ${period.name}? Once closed, no postings can land in this period without an audit-logged reopen.`)) return;
    setClosing(true);
    try {
      await api.patch(`/accounting-periods/${id}/close`);
      toast.success(`${period.name} closed successfully.`);
      router.push('/ledger/periods');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to close period.');
    } finally {
      setClosing(false);
    }
  }

  function toggleManual(checkId: string) {
    setManualTicked((prev) => {
      const next = new Set(prev);
      if (next.has(checkId)) next.delete(checkId);
      else next.add(checkId);
      return next;
    });
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <button onClick={() => router.push('/ledger/periods')}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
          <ArrowLeft className="w-3 h-3" /> Back to periods
        </button>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          {period.status === 'CLOSED' && <Lock className="w-5 h-5 text-muted-foreground" />}
          Close {period.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pre-close checklist (CLOCO) — every check below must pass before the period
          can be locked. Auto-checks evaluate live; manual attestations require your sign-off.
        </p>
      </div>

      {/* Status banner */}
      {period.status === 'CLOSED' ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 flex items-start gap-2">
          <Lock className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm text-emerald-900">
            <div className="font-semibold">Period is CLOSED.</div>
            <div className="leading-snug">
              No new postings can land in this period. To make corrections, an Owner must reopen
              the period (logged with reason in the audit trail).
            </div>
          </div>
        </div>
      ) : failed > 0 ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-900">
            <div className="font-semibold">{failed} check{failed === 1 ? '' : 's'} failing.</div>
            <div className="leading-snug">Resolve the items below before closing the period.</div>
          </div>
        </div>
      ) : !allManualConfirmed ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2">
          <Circle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <div className="font-semibold">Awaiting manual attestation.</div>
            <div className="leading-snug">
              Tick each manual check after you&apos;ve reviewed it. The system can&apos;t verify these
              automatically.
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm text-emerald-900">
            <div className="font-semibold">All checks pass — ready to close.</div>
            <div className="leading-snug">
              The Close button below is now enabled. Click it to lock {period.name}.
            </div>
          </div>
        </div>
      )}

      {/* Grouped checks */}
      {groups.map((group) => (
        <section key={group}>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group}</h2>
          <div className="rounded-xl border border-border bg-background divide-y divide-border overflow-hidden">
            {checks.filter((c) => c.group === group).map((c) => {
              const Icon = ICON_MAP[c.status];
              const colour = COLOR_MAP[c.status];
              const isManualChecked = c.status === 'MANUAL' && manualTicked.has(c.id);
              return (
                <div
                  key={c.id}
                  className={`px-4 py-3 flex items-start gap-3 ${
                    c.status === 'FAIL' ? 'bg-red-500/5' :
                    isManualChecked ? 'bg-emerald-500/5' : ''
                  }`}
                >
                  {c.status === 'MANUAL' ? (
                    <button
                      onClick={() => toggleManual(c.id)}
                      className={`mt-0.5 shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isManualChecked ? 'bg-emerald-500 border-emerald-500' : 'border-amber-500 hover:bg-amber-500/10'
                      }`}
                      disabled={period.status === 'CLOSED'}
                    >
                      {isManualChecked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ) : (
                    <Icon className={`mt-0.5 shrink-0 w-5 h-5 ${colour}`} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-medium">{c.title}</h3>
                      {c.count != null && c.count > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                          c.status === 'FAIL' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'
                        }`}>
                          {c.count}
                        </span>
                      )}
                      <span className={`text-[10px] uppercase tracking-wider font-semibold ${colour}`}>
                        {c.status === 'N_A' ? 'N/A' : c.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{c.detail}</p>
                    {c.hint && (
                      <p className={`text-xs mt-1 ${c.status === 'FAIL' ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {c.hint}
                      </p>
                    )}
                  </div>
                  {c.link && (
                    <button
                      onClick={() => router.push(c.link!)}
                      className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1 shrink-0"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Close button */}
      {period.status === 'OPEN' && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {!isOwner && 'Only the Business Owner can close a period.'}
            {isOwner && !canClose && (failed > 0
              ? `Resolve ${failed} failing check${failed === 1 ? '' : 's'} above.`
              : !allManualConfirmed ? 'Tick each manual attestation.' : '')}
            {canClose && 'All checks pass. You can lock the period now.'}
          </div>
          <div className="flex gap-2">
            <button onClick={() => refetch()} className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted">
              Re-evaluate
            </button>
            <button
              onClick={handleClose}
              disabled={!canClose || closing}
              className="h-9 px-4 rounded-md bg-red-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Lock className="w-4 h-4" />
              {closing ? 'Closing…' : `Close ${period.name}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
