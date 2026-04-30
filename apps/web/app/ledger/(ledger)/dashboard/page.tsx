'use client';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, ArrowRight, RefreshCw,
  Clock, Scale, ListChecks, ShieldAlert, FileWarning, Zap, Inbox,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface ProcessMetrics {
  generatedAt: string;
  timeliness: {
    avgEventLagMs:           number;
    pendingEvents:           number;
    failedEvents:            number;
    daysSalesOutstanding:    number;
    daysPayableOutstanding:  number;
    daysSinceLastClose:      number | null;
  };
  accuracy: {
    tbVariance:      number;
    tbTotalDebits:   number;
    tbTotalCredits:  number;
    isBalanced:      boolean;
    voidsLast30d:    number;
    voidRateLast30d: number;
    reopensLast90d:  number;
  };
  volume: {
    jesToday:                number;
    jesThisMonth:            number;
    eventsProcessedLast24h:  number;
    openArInvoices:          number;
    openArValue:             number;
    openApBills:             number;
    openApValue:             number;
  };
  control: {
    pendingExpenseClaims: number;
    sodOverridesLast30d:  number;
    productsMissingCost:  number;
    auditEntriesLast24h:  number;
    offlineSyncsLast24h:  number;
  };
}

function fmtPeso(n: number) {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtLag(ms: number) {
  if (ms === 0) return '—';
  if (ms < 60_000)        return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000)     return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000)    return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}
function fmtPct(p: number) {
  return `${(p * 100).toFixed(2)}%`;
}

type Severity = 'good' | 'warn' | 'bad' | 'neutral';

const SEVERITY_STYLES: Record<Severity, { border: string; text: string; bg: string; }> = {
  good:    { border: 'border-emerald-500/40', text: 'text-emerald-400',  bg: 'bg-emerald-500/5' },
  warn:    { border: 'border-amber-500/40',   text: 'text-amber-400',    bg: 'bg-amber-500/5' },
  bad:     { border: 'border-red-500/40',     text: 'text-red-400',      bg: 'bg-red-500/10' },
  neutral: { border: 'border-border',         text: 'text-foreground',   bg: 'bg-background' },
};

function MetricCard({
  label, value, sub, severity = 'neutral', icon: Icon, onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  severity?: Severity;
  icon?: React.ElementType;
  onClick?: () => void;
}) {
  const s = SEVERITY_STYLES[severity];
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`
        rounded-lg border ${s.border} ${s.bg} p-4 text-left w-full
        ${onClick ? 'hover:opacity-80 transition cursor-pointer' : ''}
      `}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className={`w-4 h-4 ${s.text}`} />}
      </div>
      <div className={`text-xl font-bold tabular-nums ${s.text}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{sub}</div>}
    </Wrapper>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: React.ElementType; title: string; subtitle: string;
}) {
  return (
    <div className="flex items-start gap-2 mb-3">
      <div className="rounded-lg bg-[var(--accent-soft)] p-2 mt-0.5">
        <Icon className="w-4 h-4 text-[var(--accent)]" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground leading-tight">{subtitle}</p>
      </div>
    </div>
  );
}

export default function LedgerDashboardPage() {
  const { user } = useAuthStore();
  const router   = useRouter();

  const { data, isLoading, refetch, isFetching } = useQuery<ProcessMetrics>({
    queryKey: ['ledger-process-metrics'],
    queryFn:  () => api.get('/ledger/process-metrics').then((r) => r.data),
    enabled:  !!user,
    refetchInterval: 60_000, // refresh every minute
  });

  // ── Severity decisions per metric ───────────────────────────────────────
  // Tunable thresholds — adjust to your team's SLAs.
  const sev = {
    eventLag:    !data ? 'neutral' : data.timeliness.avgEventLagMs <= 60_000     ? 'good' : data.timeliness.avgEventLagMs <= 600_000   ? 'warn' : 'bad',
    pending:     !data ? 'neutral' : data.timeliness.pendingEvents === 0          ? 'good' : data.timeliness.pendingEvents <= 5         ? 'warn' : 'bad',
    failed:      !data ? 'neutral' : data.timeliness.failedEvents === 0           ? 'good' : data.timeliness.failedEvents <= 2          ? 'warn' : 'bad',
    dso:         !data ? 'neutral' : data.timeliness.daysSalesOutstanding <= 30   ? 'good' : data.timeliness.daysSalesOutstanding <= 60 ? 'warn' : 'bad',
    dpo:         !data ? 'neutral' : data.timeliness.daysPayableOutstanding <= 30 ? 'good' : data.timeliness.daysPayableOutstanding <= 45 ? 'warn' : 'bad',
    closeAge:    !data ? 'neutral' : data.timeliness.daysSinceLastClose == null   ? 'warn' : data.timeliness.daysSinceLastClose <= 35    ? 'good' : data.timeliness.daysSinceLastClose <= 60 ? 'warn' : 'bad',

    balanced:    !data ? 'neutral' : data.accuracy.isBalanced                     ? 'good' : 'bad',
    voidRate:    !data ? 'neutral' : data.accuracy.voidRateLast30d <= 0.02        ? 'good' : data.accuracy.voidRateLast30d <= 0.05      ? 'warn' : 'bad',
    reopens:     !data ? 'neutral' : data.accuracy.reopensLast90d === 0           ? 'good' : data.accuracy.reopensLast90d <= 1          ? 'warn' : 'bad',

    sodOverride: !data ? 'neutral' : data.control.sodOverridesLast30d === 0       ? 'good' : data.control.sodOverridesLast30d <= 2      ? 'warn' : 'bad',
    missingCost: !data ? 'neutral' : data.control.productsMissingCost === 0       ? 'good' : data.control.productsMissingCost <= 5      ? 'warn' : 'bad',
    pendingClaims: !data ? 'neutral' : data.control.pendingExpenseClaims === 0    ? 'good' : data.control.pendingExpenseClaims <= 5     ? 'warn' : 'bad',
  } as const;

  return (
    <div className="min-h-full bg-muted/30">
      {/* Header */}
      <div className="bg-background border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 text-[var(--accent)]" />
              Ledger Operations Health
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Process metrics — how fast, accurate, and under-control the books are.
              For financial KPIs (revenue, profit, balances) see Trial Balance, Income Statement,
              and Balance Sheet.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data && <span>Updated {new Date(data.generatedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Loading process metrics…
        </div>
      ) : (
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">

          {/* ── Critical alerts (only show when there's something to fix) ──── */}
          {(!data.accuracy.isBalanced ||
            data.timeliness.failedEvents > 0 ||
            data.control.productsMissingCost > 0 ||
            (data.timeliness.daysSinceLastClose ?? 0) > 60) && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h2 className="text-sm font-semibold text-red-400">Issues that need attention</h2>
              </div>
              <ul className="space-y-1 text-xs">
                {!data.accuracy.isBalanced && (
                  <li className="flex justify-between">
                    <span>Trial Balance is out of balance: variance {fmtPeso(data.accuracy.tbVariance)}</span>
                    <button onClick={() => router.push('/ledger/trial-balance')} className="text-red-400 hover:underline flex items-center gap-1">
                      Investigate <ArrowRight className="w-3 h-3" />
                    </button>
                  </li>
                )}
                {data.timeliness.failedEvents > 0 && (
                  <li className="flex justify-between">
                    <span>{data.timeliness.failedEvents} POS event{data.timeliness.failedEvents === 1 ? '' : 's'} stuck in FAILED</span>
                    <button onClick={() => router.push('/ledger/events')} className="text-red-400 hover:underline flex items-center gap-1">
                      Triage <ArrowRight className="w-3 h-3" />
                    </button>
                  </li>
                )}
                {data.control.productsMissingCost > 0 && (
                  <li className="flex justify-between">
                    <span>{data.control.productsMissingCost} active product{data.control.productsMissingCost === 1 ? '' : 's'} missing cost price (breaks COGS)</span>
                    <span className="text-muted-foreground">Fix in POS → Products</span>
                  </li>
                )}
                {(data.timeliness.daysSinceLastClose ?? 0) > 60 && (
                  <li className="flex justify-between">
                    <span>Last period close was {data.timeliness.daysSinceLastClose} days ago</span>
                    <button onClick={() => router.push('/ledger/periods')} className="text-red-400 hover:underline flex items-center gap-1">
                      Close period <ArrowRight className="w-3 h-3" />
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* ── Timeliness ──────────────────────────────────────────────── */}
          <section>
            <SectionHeader
              icon={Clock}
              title="Timeliness"
              subtitle="How fresh is the data? Lag, backlog, and cycle times."
            />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard
                label="POS → JE Lag"
                value={fmtLag(data.timeliness.avgEventLagMs)}
                sub="Avg time PENDING → POSTED, last 24h. Target: under 1 minute."
                severity={sev.eventLag}
                icon={Zap}
              />
              <MetricCard
                label="Pending Events"
                value={String(data.timeliness.pendingEvents)}
                sub="Awaiting auto-post. Cron runs every minute."
                severity={sev.pending}
                icon={Inbox}
                onClick={() => router.push('/ledger/events')}
              />
              <MetricCard
                label="Failed Events"
                value={String(data.timeliness.failedEvents)}
                sub="Stuck — needs manual triage."
                severity={sev.failed}
                icon={XCircle}
                onClick={() => router.push('/ledger/events')}
              />
              <MetricCard
                label="DSO"
                value={`${data.timeliness.daysSalesOutstanding.toFixed(1)} d`}
                sub="Days Sales Outstanding — invoice → cash. Target: ≤ 30."
                severity={sev.dso}
              />
              <MetricCard
                label="DPO"
                value={`${data.timeliness.daysPayableOutstanding.toFixed(1)} d`}
                sub="Days Payable Outstanding — bill → payment. Target: ≤ 30."
                severity={sev.dpo}
              />
              <MetricCard
                label="Last Period Close"
                value={data.timeliness.daysSinceLastClose == null ? 'Never' : `${data.timeliness.daysSinceLastClose} d ago`}
                sub="Days since the most recent monthly close. Target: ≤ 35."
                severity={sev.closeAge}
                onClick={() => router.push('/ledger/periods')}
              />
            </div>
          </section>

          {/* ── Accuracy ────────────────────────────────────────────────── */}
          <section>
            <SectionHeader
              icon={Scale}
              title="Accuracy & Integrity"
              subtitle="Is the data trustworthy? Balance check, voids, audit risk."
            />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <MetricCard
                label="Trial Balance"
                value={data.accuracy.isBalanced ? 'Balanced' : 'OFF'}
                sub={data.accuracy.isBalanced
                  ? `${fmtPeso(data.accuracy.tbTotalDebits)} both sides`
                  : `Variance ${fmtPeso(data.accuracy.tbVariance)}`}
                severity={sev.balanced}
                icon={data.accuracy.isBalanced ? CheckCircle2 : AlertTriangle}
                onClick={() => router.push('/ledger/trial-balance')}
              />
              <MetricCard
                label="Voids (30d)"
                value={String(data.accuracy.voidsLast30d)}
                sub={`${fmtPct(data.accuracy.voidRateLast30d)} of orders. Target: under 2%.`}
                severity={sev.voidRate}
              />
              <MetricCard
                label="Period Reopens (90d)"
                value={String(data.accuracy.reopensLast90d)}
                sub="Audit risk. Each reopen is logged with reason."
                severity={sev.reopens}
                icon={ShieldAlert}
              />
              <MetricCard
                label="Total Debits"
                value={fmtPeso(data.accuracy.tbTotalDebits)}
                sub="All POSTED journal lines."
                severity="neutral"
              />
              <MetricCard
                label="Total Credits"
                value={fmtPeso(data.accuracy.tbTotalCredits)}
                sub="Should match debits to the centavo."
                severity="neutral"
              />
            </div>
          </section>

          {/* ── Volume ──────────────────────────────────────────────────── */}
          <section>
            <SectionHeader
              icon={ListChecks}
              title="Volume & Throughput"
              subtitle="How busy is the team? JE counts, open AR/AP."
            />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard
                label="JEs Today"
                value={String(data.volume.jesToday)}
                sub="Posted journal entries."
                severity="neutral"
                onClick={() => router.push('/ledger/journal')}
              />
              <MetricCard
                label="JEs This Month"
                value={String(data.volume.jesThisMonth)}
                sub="Month-to-date."
                severity="neutral"
              />
              <MetricCard
                label="Events (24h)"
                value={String(data.volume.eventsProcessedLast24h)}
                sub="Auto-processed in the last day."
                severity="neutral"
              />
              <MetricCard
                label="Open AR"
                value={String(data.volume.openArInvoices)}
                sub={`Outstanding ${fmtPeso(data.volume.openArValue)}`}
                severity="neutral"
                onClick={() => router.push('/ledger/ar/billing')}
              />
              <MetricCard
                label="Open AP"
                value={String(data.volume.openApBills)}
                sub={`Net payable ${fmtPeso(data.volume.openApValue)}`}
                severity="neutral"
                onClick={() => router.push('/ledger/ap/bills')}
              />
              <MetricCard
                label="Offline Syncs (24h)"
                value={String(data.control.offlineSyncsLast24h)}
                sub="POS orders posted from offline queue."
                severity="neutral"
              />
            </div>
          </section>

          {/* ── Control ─────────────────────────────────────────────────── */}
          <section>
            <SectionHeader
              icon={ShieldAlert}
              title="Control & Compliance"
              subtitle="What needs the team's attention right now?"
            />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <MetricCard
                label="Pending Claims"
                value={String(data.control.pendingExpenseClaims)}
                sub="Expense claims awaiting approval."
                severity={sev.pendingClaims}
                icon={Inbox}
                onClick={() => router.push('/ledger/expense-approvals')}
              />
              <MetricCard
                label="SOD Overrides (30d)"
                value={String(data.control.sodOverridesLast30d)}
                sub="Times an owner overrode a Segregation-of-Duties warning."
                severity={sev.sodOverride}
                icon={ShieldAlert}
                onClick={() => router.push('/settings/sod-violations')}
              />
              <MetricCard
                label="Products Missing Cost"
                value={String(data.control.productsMissingCost)}
                sub="No cost price → COGS not booked → profit overstated."
                severity={sev.missingCost}
                icon={FileWarning}
                onClick={() => router.push('/pos/products')}
              />
              <MetricCard
                label="Audit Entries (24h)"
                value={String(data.control.auditEntriesLast24h)}
                sub="Logged sensitive actions in last day."
                severity="neutral"
                onClick={() => router.push('/ledger/audit')}
              />
              <MetricCard
                label="JE Posted Today"
                value={String(data.volume.jesToday)}
                sub="Cross-reference with expected daily volume."
                severity="neutral"
              />
            </div>
          </section>

          {/* Methodology footer */}
          <div className="text-xs text-muted-foreground border-t border-border pt-4 leading-relaxed space-y-1">
            <p><strong>How we compute these.</strong> Process metrics are derived live from the database — no caching. DSO/DPO are weighted averages over the last 90 days of paid invoices/bills. Event Lag is the average time from event creation to JE creation across the last 24 hours. Severity thresholds (good / warn / bad) are tunable per tenant — current values are sensible defaults for an MSME.</p>
            <p>For account-level financials (revenue by GL account, expense balances) see <button onClick={() => router.push('/ledger/trial-balance')} className="underline hover:text-foreground">Trial Balance</button>, <button onClick={() => router.push('/ledger/pl-statement')} className="underline hover:text-foreground">Income Statement</button>, and <button onClick={() => router.push('/ledger/balance-sheet')} className="underline hover:text-foreground">Balance Sheet</button>.</p>
          </div>
        </div>
      )}
    </div>
  );
}
