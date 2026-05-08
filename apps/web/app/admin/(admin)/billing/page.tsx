'use client';
/**
 * Console → Subscription Billing
 *
 * HNS Corp PH's billing relationship with each Clerque tenant. This page
 * shows ONLY platform-layer subscription data (the SaaS fees tenants pay
 * us). It deliberately surfaces NO tenant-business financials — no order
 * totals, no payroll, no AR, no P&L. The privacy invariant holds.
 *
 * Surfaces:
 *  - Top-row metrics: active tenants, MRR (ours), past-due count, paid this month
 *  - Invoice table: filterable by tenant / status / date range
 *  - Mark-paid + Write-off actions per row
 *  - Manual issuance (for off-cycle billing or backfill)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Plus, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Status = 'DRAFT' | 'ISSUED' | 'PAID' | 'PAST_DUE' | 'WRITTEN_OFF' | 'REFUNDED';

interface Invoice {
  id:            string;
  invoiceNumber: string;
  tenantId:      string;
  periodStart:   string;
  periodEnd:     string;
  planCode:      string;
  baseAmount:    string;
  addonAmount:   string;
  vatAmount:     string;
  totalAmount:   string;
  status:        Status;
  issuedAt:      string | null;
  dueDate:       string;
  paidAt:        string | null;
  paidVia:       string | null;
  externalRef:   string | null;
  tenant: {
    id:       string;
    name:     string;
    slug:     string;
    planCode: string | null;
    status:   string;
  };
}

interface Metrics {
  activeTenants:   number;
  issuedThisMonth: number;
  paidThisMonth:   { count: number; amount: number };
  pastDueCount:    number;
  mrr:             number;
  vatRegistered:   boolean;
  dueDaysWindow:   number;
}

const STATUS_TINT: Record<Status, string> = {
  DRAFT:       'bg-muted text-muted-foreground',
  ISSUED:      'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  PAID:        'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  PAST_DUE:    'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  WRITTEN_OFF: 'bg-red-500/15 text-red-600',
  REFUNDED:    'bg-purple-500/15 text-purple-700 dark:text-purple-400',
};

function fmtPeso(n: number | string) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

function fmtPeriod(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  if (s.getMonth() === e.getMonth() - 1 || (s.getMonth() === 11 && e.getMonth() === 0)) {
    return s.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  }
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

export default function BillingPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status | 'ALL'>('ALL');

  const { data: metrics } = useQuery<Metrics>({
    queryKey: ['admin-billing-metrics'],
    queryFn:  () => api.get('/admin/billing/metrics').then((r) => r.data),
  });

  const { data: invoices = [], refetch, isFetching } = useQuery<Invoice[]>({
    queryKey: ['admin-billing-invoices', statusFilter],
    queryFn:  () => api.get('/admin/billing/invoices', {
      params: statusFilter !== 'ALL' ? { status: statusFilter } : {},
    }).then((r) => r.data),
  });

  const [paying, setPaying] = useState<Invoice | null>(null);

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Subscription Billing</h1>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border border-border hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          HNS Corp PH&rsquo;s subscription invoices to Clerque tenants. Operational data only —
          contains no tenant business financials.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Metrics row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Active tenants" value={metrics?.activeTenants ?? '—'} />
          <Stat label="MRR (this month)" value={metrics ? fmtPeso(metrics.mrr) : '—'} hint="base + add-ons" />
          <Stat label="Paid this month" value={metrics ? fmtPeso(metrics.paidThisMonth.amount) : '—'} hint={`${metrics?.paidThisMonth.count ?? 0} invoices`} />
          <Stat label="Past due" value={metrics?.pastDueCount ?? '—'} hint={`> ${metrics?.dueDaysWindow ?? '—'} days`} tone={metrics && metrics.pastDueCount > 0 ? 'warn' : undefined} />
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['ALL', 'ISSUED', 'PAST_DUE', 'PAID', 'DRAFT', 'WRITTEN_OFF'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ' +
                (statusFilter === s
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-border text-muted-foreground hover:bg-muted')
              }
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Invoices table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {invoices.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No invoices for this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 font-medium">Invoice #</th>
                    <th className="px-4 py-2.5 font-medium">Tenant</th>
                    <th className="px-4 py-2.5 font-medium">Plan</th>
                    <th className="px-4 py-2.5 font-medium">Period</th>
                    <th className="px-4 py-2.5 font-medium text-right">Total</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Due / Paid</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-mono text-xs">{inv.invoiceNumber}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{inv.tenant.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{inv.tenant.slug}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono">{inv.planCode}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtPeriod(inv.periodStart, inv.periodEnd)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{fmtPeso(inv.totalAmount)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_TINT[inv.status]}`}>
                          {inv.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {inv.status === 'PAID'
                          ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {fmtDate(inv.paidAt)}</span>
                          : inv.status === 'PAST_DUE'
                          ? <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" /> due {fmtDate(inv.dueDate)}</span>
                          : <span><Calendar className="h-3 w-3 inline mr-1" /> {fmtDate(inv.dueDate)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {(inv.status === 'ISSUED' || inv.status === 'PAST_DUE') && (
                          <button
                            onClick={() => setPaying(inv)}
                            className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25"
                          >
                            Mark paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {paying && (
        <MarkPaidModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onSuccess={() => {
            setPaying(null);
            qc.invalidateQueries({ queryKey: ['admin-billing-invoices'] });
            qc.invalidateQueries({ queryKey: ['admin-billing-metrics'] });
          }}
        />
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'warn' }) {
  return (
    <div className={
      'rounded-xl border border-border bg-card p-4 ' +
      (tone === 'warn' ? 'border-amber-500/40' : '')
    }>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function MarkPaidModal({
  invoice, onClose, onSuccess,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [paidVia, setPaidVia]         = useState('Bank Transfer');
  const [externalRef, setExternalRef] = useState('');
  const [paidAt, setPaidAt]           = useState(new Date().toISOString().slice(0, 10));

  const mut = useMutation({
    mutationFn: () => api.post(`/admin/billing/invoices/${invoice.id}/mark-paid`, {
      paidVia, externalRef: externalRef || undefined, paidAt: new Date(paidAt).toISOString(),
    }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Invoice marked as paid.');
      onSuccess();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Mark invoice paid</h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{invoice.invoiceNumber}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <XCircle className="h-5 w-5" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
            <div><span className="text-muted-foreground">Tenant:</span> {invoice.tenant.name}</div>
            <div><span className="text-muted-foreground">Amount:</span> <span className="font-mono">{fmtPeso(invoice.totalAmount)}</span></div>
          </div>

          <label className="text-sm block">
            <span className="text-xs font-medium text-foreground">Payment method</span>
            <select
              value={paidVia}
              onChange={(e) => setPaidVia(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option>Bank Transfer</option>
              <option>GCash</option>
              <option>PayMongo</option>
              <option>Xendit</option>
              <option>Cash</option>
              <option>Check</option>
            </select>
          </label>

          <label className="text-sm block">
            <span className="text-xs font-medium text-foreground">Reference number / txn id (optional)</span>
            <input
              type="text"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
              placeholder="e.g. BPI ref 1234567"
            />
          </label>

          <label className="text-sm block">
            <span className="text-xs font-medium text-foreground">Date received</span>
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Mark paid'}
          </button>
        </footer>
      </div>
    </div>
  );
}
