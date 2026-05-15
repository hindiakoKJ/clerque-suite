'use client';

/**
 * Sprint 24 — Admin verification UI for pending subscription payments.
 *
 * Lists all pending payments grouped by status. Owner verifies each:
 * - Confirm: enters BIR OR number from paper booklet → tenant activates,
 *   customer gets confirmation email with OR details.
 * - Reject: enters reason → customer gets rejection email + can re-submit.
 *
 * Gap-free OR validation happens server-side. UI suggests the next number
 * based on platform's `lastOrNumber + 1`.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, X, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface PendingPayment {
  id:                string;
  planCode:          string;
  amountPhpCents:    number;
  periodStart:       string;
  periodEnd:         string;
  reason:            'NEW_SIGNUP' | 'MONTHLY_RENEWAL' | 'PLAN_UPGRADE';
  referenceCode:     string;
  status:            'AWAITING_PROOF' | 'PROOF_SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
  submittedAt:       string | null;
  submittedProofUrl: string | null;
  submittedRefId:    string | null;
  submittedNotes:    string | null;
  submittedMethod:   string | null;
  confirmedAt:       string | null;
  rejectedAt:        string | null;
  rejectionReason:   string | null;
  officialReceiptId: string | null;
  createdAt:         string;
  tenant: {
    id:            string;
    name:          string;
    slug:          string;
    contactEmail:  string | null;
    tin:           string | null;
  };
}

interface PlatformConfig {
  lastOrNumber:    string | null;
  orNumberPadding: number;
}

function fmtPhp(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function nextOrNumber(last: string | null, padding: number): string {
  if (!last) return '1'.padStart(padding, '0');
  const n = parseInt(last, 10);
  if (!Number.isFinite(n)) return '1'.padStart(padding, '0');
  return String(n + 1).padStart(padding, '0');
}

const PLAN_LABELS: Record<string, string> = {
  SOLO_LITE:     'Solo Lite',
  SOLO_STANDARD: 'Solo Standard',
  SOLO_PRO:      'Solo Pro',
};

const STATUS_COLORS: Record<string, string> = {
  AWAITING_PROOF:  'bg-zinc-100 text-zinc-700',
  PROOF_SUBMITTED: 'bg-amber-100 text-amber-800',
  CONFIRMED:       'bg-emerald-100 text-emerald-800',
  REJECTED:        'bg-red-100 text-red-800',
  EXPIRED:         'bg-zinc-200 text-zinc-600',
};

export default function PaymentsPendingPage() {
  const [statusFilter, setStatusFilter] = useState<string>('PROOF_SUBMITTED');
  const qc = useQueryClient();

  const { data: payments, isLoading, refetch } = useQuery<PendingPayment[]>({
    queryKey: ['pending-payments', statusFilter],
    queryFn:  () => api.get(`/subscription-payments/admin${statusFilter ? `?status=${statusFilter}` : ''}`).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const { data: platform } = useQuery<PlatformConfig>({
    queryKey: ['platform-config'],
    queryFn:  () => api.get('/admin/platform/config').then((r) => r.data),
  });

  const counts = useMemo(() => {
    // Backend already filters by status; this is just a count for the badge if/when refactored
    return { items: payments?.length ?? 0 };
  }, [payments]);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-6 py-5 shrink-0">
        <h1 className="text-xl font-bold text-foreground">Pending Subscription Payments</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Verify customer payments and issue BIR Official Receipts from your paper booklet.
        </p>
      </div>

      <div className="p-4 sm:p-6 max-w-6xl">
        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(['PROOF_SUBMITTED', 'AWAITING_PROOF', 'CONFIRMED', 'REJECTED', 'EXPIRED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                statusFilter === s ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:border-foreground/40'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-secondary inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && payments && payments.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No payments with status {statusFilter.replace('_', ' ')}.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {payments?.map((p) => (
            <PaymentCard
              key={p.id}
              payment={p}
              platform={platform}
              onUpdated={() => {
                qc.invalidateQueries({ queryKey: ['pending-payments'] });
                qc.invalidateQueries({ queryKey: ['platform-config'] });
              }}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground mt-6">
          Showing {counts.items} payments. Pulls every 30 seconds.
        </p>
      </div>
    </div>
  );
}

function PaymentCard({
  payment,
  platform,
  onUpdated,
}: {
  payment: PendingPayment;
  platform: PlatformConfig | undefined;
  onUpdated: () => void;
}) {
  const [confirming, setConfirming]       = useState(false);
  const [rejecting,  setRejecting]        = useState(false);
  const [orNumber,   setOrNumber]         = useState('');
  const [scannedUrl, setScannedUrl]       = useState('');
  const [rejection,  setRejection]        = useState('');

  // Auto-suggest the next OR number from platform's lastOrNumber.
  useEffect(() => {
    if (platform && !orNumber && (confirming || payment.status === 'PROOF_SUBMITTED')) {
      setOrNumber(nextOrNumber(platform.lastOrNumber, platform.orNumberPadding));
    }
  }, [platform, confirming, payment.status, orNumber]);

  const confirmMutation = useMutation({
    mutationFn: () =>
      api.patch(`/subscription-payments/admin/${payment.id}/confirm`, {
        orNumber:       orNumber.trim(),
        scannedCopyUrl: scannedUrl.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(`Confirmed. OR #${orNumber} issued.`);
      setConfirming(false);
      setOrNumber('');
      setScannedUrl('');
      onUpdated();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Could not confirm payment.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      api.patch(`/subscription-payments/admin/${payment.id}/reject`, {
        reason: rejection.trim(),
      }),
    onSuccess: () => {
      toast.success('Payment rejected. Customer was notified by email.');
      setRejecting(false);
      setRejection('');
      onUpdated();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Could not reject payment.');
    },
  });

  const planLabel = PLAN_LABELS[payment.planCode] ?? payment.planCode;
  const statusClass = STATUS_COLORS[payment.status] ?? 'bg-zinc-100 text-zinc-700';

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-foreground">{payment.tenant.name}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${statusClass}`}>
                {payment.status.replace('_', ' ')}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 uppercase font-semibold">
                {payment.reason.replace('_', ' ')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {payment.tenant.contactEmail ?? '(no email)'}
              {payment.tenant.tin && <> · TIN {payment.tenant.tin}</>}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold font-mono text-foreground">{fmtPhp(payment.amountPhpCents)}</div>
            <div className="text-[11px] text-muted-foreground">{planLabel}</div>
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4 p-3 rounded-lg bg-muted/40">
          <div>
            <div className="text-muted-foreground mb-0.5">Reference</div>
            <div className="font-mono font-semibold text-foreground">{payment.referenceCode}</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Created</div>
            <div className="text-foreground">{fmtDate(payment.createdAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Submitted</div>
            <div className="text-foreground">{payment.submittedAt ? fmtDate(payment.submittedAt) : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Method</div>
            <div className="text-foreground">{payment.submittedMethod ?? '—'}</div>
          </div>
          {payment.submittedRefId && (
            <div className="col-span-2 sm:col-span-4">
              <div className="text-muted-foreground mb-0.5">Tx reference</div>
              <div className="font-mono text-foreground">{payment.submittedRefId}</div>
            </div>
          )}
          {payment.submittedNotes && (
            <div className="col-span-2 sm:col-span-4">
              <div className="text-muted-foreground mb-0.5">Customer notes</div>
              <div className="text-foreground">{payment.submittedNotes}</div>
            </div>
          )}
          {payment.submittedProofUrl && (
            <div className="col-span-2 sm:col-span-4">
              <a href={payment.submittedProofUrl} target="_blank" rel="noopener noreferrer"
                 className="text-xs underline inline-flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                View receipt screenshot <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {payment.officialReceiptId && (
            <div className="col-span-2 sm:col-span-4">
              <div className="text-muted-foreground mb-0.5">Issued OR</div>
              <div className="font-mono font-semibold text-foreground">{payment.officialReceiptId}</div>
            </div>
          )}
          {payment.rejectionReason && (
            <div className="col-span-2 sm:col-span-4">
              <div className="text-muted-foreground mb-0.5">Rejection reason</div>
              <div className="text-red-700">{payment.rejectionReason}</div>
            </div>
          )}
        </div>

        {/* Action buttons (only on actionable statuses) */}
        {(payment.status === 'PROOF_SUBMITTED' || payment.status === 'AWAITING_PROOF') && (
          <div className="flex items-center gap-2 flex-wrap">
            {!confirming && !rejecting && (
              <>
                <button
                  onClick={() => setConfirming(true)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-white inline-flex items-center gap-1.5"
                  style={{ background: '#10b981' }}
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirm + Issue OR
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5"
                >
                  <X className="h-4 w-4" /> Reject
                </button>
              </>
            )}

            {/* Confirm form */}
            {confirming && (
              <div className="w-full mt-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-emerald-900 mb-1">
                    BIR OR number (from your paper booklet) <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={orNumber}
                    onChange={(e) => setOrNumber(e.target.value)}
                    placeholder={platform ? nextOrNumber(platform.lastOrNumber, platform.orNumberPadding) : '000001'}
                    className="w-full h-9 px-3 rounded-md border border-emerald-300 bg-white text-sm font-mono"
                  />
                  <p className="text-[11px] text-emerald-700 mt-1">
                    Must be sequential — system rejects out-of-order numbers per BIR rule.
                    {platform?.lastOrNumber && <> Last used: <strong>{platform.lastOrNumber}</strong></>}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-emerald-900 mb-1">
                    Scanned OR copy URL (optional)
                  </label>
                  <input
                    value={scannedUrl}
                    onChange={(e) => setScannedUrl(e.target.value)}
                    type="url"
                    placeholder="Upload to Google Drive / R2; paste link"
                    className="w-full h-9 px-3 rounded-md border border-emerald-300 bg-white text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => confirmMutation.mutate()}
                    disabled={confirmMutation.isPending || !orNumber.trim()}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                    style={{ background: '#10b981' }}
                  >
                    {confirmMutation.isPending ? 'Confirming…' : 'Confirm payment'}
                  </button>
                  <button
                    onClick={() => { setConfirming(false); setOrNumber(''); setScannedUrl(''); }}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Reject form */}
            {rejecting && (
              <div className="w-full mt-2 p-3 rounded-lg bg-red-50 border border-red-200 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-red-900 mb-1">
                    Reason for rejection <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={rejection}
                    onChange={(e) => setRejection(e.target.value)}
                    rows={2}
                    minLength={5}
                    placeholder="e.g., 'Amount received is ₱389, expected ₱399 — short by ₱10'"
                    className="w-full px-3 py-2 rounded-md border border-red-300 bg-white text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => rejectMutation.mutate()}
                    disabled={rejectMutation.isPending || rejection.trim().length < 5}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-red-600 disabled:opacity-50"
                  >
                    {rejectMutation.isPending ? 'Rejecting…' : 'Reject + notify customer'}
                  </button>
                  <button
                    onClick={() => { setRejecting(false); setRejection(''); }}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
