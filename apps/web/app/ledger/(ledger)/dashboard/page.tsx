'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, DollarSign, ShieldCheck,
  Zap, CheckCircle2, XCircle, AlertCircle, ArrowRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

function fmtPeso(n: number) {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentMonthRange() {
  const now  = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const to   = now.toISOString().split('T')[0];
  return { from, to };
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

interface PLSummary {
  from: string; to: string;
  totalRevenue: number; totalExpenses: number; netIncome: number;
  revenueAccounts: { code: string; name: string; balance: number }[];
  expenseAccounts: { code: string; name: string; balance: number }[];
}
interface EventStats { pending: number; synced: number; failed: number }

export default function LedgerDashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const { from, to } = currentMonthRange();

  const monthLabel = new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

  const { data: pl, isLoading: plLoading } = useQuery<PLSummary>({
    queryKey: ['pl-summary', from, to],
    queryFn: () => api.get(`/accounting/accounts/pl-summary?from=${from}&to=${to}`).then((r) => r.data),
    enabled: !!user,
  });

  const { data: tb } = useQuery<{ totalDebits: number; totalCredits: number; isBalanced: boolean }>({
    queryKey: ['trial-balance'],
    queryFn: () => api.get('/accounting/accounts/trial-balance').then((r) => r.data),
    enabled: !!user,
  });

  const { data: stats, refetch: refetchStats } = useQuery<EventStats>({
    queryKey: ['accounting-event-stats'],
    queryFn: () => api.get('/accounting/events/stats').then((r) => r.data),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const netPositive = (pl?.netIncome ?? 0) >= 0;

  return (
    <div className="min-h-full bg-muted/30">

      {/* Page header */}
      <div className="bg-background border-b border-border px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm text-muted-foreground mb-0.5">
            {getGreeting()}, {user?.name?.split(' ')[0] ?? 'there'}
          </p>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Showing month-to-date figures for{' '}
            <span className="font-medium text-foreground">{monthLabel}</span>
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Hero Net Income card */}
        <div
          className="bg-background rounded-xl border border-border border-l-4 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4"
          style={{ borderLeftColor: netPositive ? 'var(--accent)' : 'hsl(349 75% 51%)' }}
        >
          <div className="flex-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Net Income (MTD)
            </p>
            {plLoading ? (
              <div className="h-10 w-48 bg-muted rounded animate-pulse" />
            ) : (
              <p className={`text-2xl sm:text-3xl md:text-4xl font-bold leading-none ${
                netPositive ? 'text-foreground' : 'text-red-600 dark:text-red-400'
              }`}>
                {fmtPeso(pl?.netIncome ?? 0)}
              </p>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              {monthLabel} · Revenue minus Expenses
            </p>
          </div>
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl"
            style={{
              background: netPositive
                ? 'color-mix(in oklab, var(--accent) 10%, transparent)'
                : 'hsl(349 75% 51% / 0.1)',
              color: netPositive ? 'var(--accent)' : 'hsl(349 75% 51%)',
            }}
          >
            {netPositive ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
            <span className="text-sm font-semibold">
              {netPositive ? 'Profitable' : 'Net Loss'}
            </span>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <KpiCard
            label="Revenue (MTD)"
            value={plLoading ? null : fmtPeso(pl?.totalRevenue ?? 0)}
            icon={TrendingUp}
            accentColor="var(--accent)"
            accentBg="color-mix(in oklab, var(--accent) 10%, transparent)"
          />
          <KpiCard
            label="Expenses (MTD)"
            value={plLoading ? null : fmtPeso(pl?.totalExpenses ?? 0)}
            icon={TrendingDown}
            accentColor="hsl(349 75% 51%)"
            accentBg="hsl(349 75% 51% / 0.1)"
          />
          <KpiCard
            label="Net Income (MTD)"
            value={plLoading ? null : fmtPeso(pl?.netIncome ?? 0)}
            icon={DollarSign}
            accentColor={netPositive ? 'hsl(221 83% 53%)' : 'hsl(349 75% 51%)'}
            accentBg={netPositive ? 'hsl(221 83% 53% / 0.1)' : 'hsl(349 75% 51% / 0.1)'}
            valueColor={netPositive ? undefined : 'text-red-600 dark:text-red-400'}
          />
          <KpiCard
            label="Books Balanced"
            value={tb ? (tb.isBalanced ? 'Balanced' : 'Out of balance') : null}
            icon={ShieldCheck}
            accentColor={tb?.isBalanced ? 'var(--accent)' : 'hsl(349 75% 51%)'}
            accentBg={tb?.isBalanced
              ? 'color-mix(in oklab, var(--accent) 10%, transparent)'
              : 'hsl(349 75% 51% / 0.1)'}
            valueColor={tb?.isBalanced ? 'text-[var(--accent)]' : 'text-red-600 dark:text-red-400'}
            badge={tb ? (tb.isBalanced ? '✓' : '!') : undefined}
          />
        </div>

        {/* Event queue alert */}
        {(stats?.pending ?? 0) > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-100 dark:bg-amber-900/40 rounded-lg flex items-center justify-center shrink-0">
                <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {stats!.pending} pending {stats!.pending === 1 ? 'event' : 'events'} waiting to be posted
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  POS sales won&apos;t appear in your ledger until events are processed.
                </p>
              </div>
            </div>
            <ProcessButton onDone={() => refetchStats()} />
          </div>
        )}

        {/* Event queue summary */}
        <div className="bg-background rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Accounting Event Queue</h2>
            </div>
            <button
              onClick={() => router.push('/ledger/events')}
              className="text-xs font-medium flex items-center gap-1 transition-colors hover:opacity-80"
              style={{ color: 'var(--accent)' }}
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="px-5 py-4 grid grid-cols-3 gap-4">
            <StatBadge icon={AlertCircle}  label="Pending" count={stats?.pending ?? 0} color="amber" />
            <StatBadge icon={CheckCircle2} label="Synced"  count={stats?.synced  ?? 0} color="teal"  />
            <StatBadge icon={XCircle}      label="Failed"  count={stats?.failed  ?? 0} color="rose"  />
          </div>
        </div>

        {/* Revenue & Expense breakdown */}
        {pl && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AccountBreakdown title="Revenue"  accounts={pl.revenueAccounts}  total={pl.totalRevenue}  color="teal" />
            <AccountBreakdown title="Expenses" accounts={pl.expenseAccounts}  total={pl.totalExpenses} color="rose" />
          </div>
        )}

        {plLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="bg-background rounded-xl border border-border p-5">
                <div className="h-4 w-24 bg-muted rounded animate-pulse mb-4" />
                {[0, 1, 2].map((j) => (
                  <div key={j} className="flex justify-between mb-3">
                    <div className="h-3 w-40 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, accentColor, accentBg,
  valueColor, badge,
}: {
  label: string;
  value: string | null;
  icon: React.ElementType;
  accentColor: string;
  accentBg: string;
  valueColor?: string;
  badge?: string;
}) {
  return (
    <div className="bg-background rounded-xl border border-border p-3 sm:p-5 flex flex-col justify-between min-h-[96px]">
      <div className="flex items-start justify-between mb-2">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: accentBg }}>
          <Icon className="h-4 w-4" style={{ color: accentColor }} />
        </div>
        {badge && (
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-md"
            style={{ background: accentBg, color: accentColor }}
          >
            {badge}
          </span>
        )}
      </div>
      <div>
        <p className="text-[11px] sm:text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
        {value === null ? (
          <div className="h-6 w-24 bg-muted rounded animate-pulse" />
        ) : (
          <p className={`text-base sm:text-xl md:text-2xl font-bold leading-tight truncate ${valueColor ?? 'text-foreground'}`}>
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

function StatBadge({ icon: Icon, label, count, color }: {
  icon: React.ElementType;
  label: string;
  count: number;
  color: 'amber' | 'teal' | 'rose';
}) {
  const styles = {
    amber: { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', icon: 'text-amber-500 dark:text-amber-400' },
    teal:  { bg: 'bg-teal-50 dark:bg-teal-900/20',   text: 'text-teal-700 dark:text-teal-400',   icon: 'text-teal-500 dark:text-teal-400'   },
    rose:  { bg: 'bg-rose-50 dark:bg-rose-900/20',   text: 'text-rose-700 dark:text-rose-400',   icon: 'text-rose-500 dark:text-rose-400'   },
  }[color];

  return (
    <div className={`${styles.bg} rounded-lg px-3 py-3 flex flex-col items-center gap-1.5`}>
      <Icon className={`h-5 w-5 ${styles.icon}`} />
      <span className={`text-2xl font-bold ${styles.text}`}>{count}</span>
      <span className={`text-xs font-medium ${styles.text} opacity-80`}>{label}</span>
    </div>
  );
}

function ProcessButton({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<string | null>(null);

  async function process() {
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/accounting/events/process-all');
      setResult(`${data.synced} synced · ${data.failed} failed · ${data.skipped} skipped`);
      onDone();
    } catch {
      setResult('Error processing events');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 shrink-0">
      {result && <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">{result}</p>}
      <button
        onClick={process}
        disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 shrink-0"
      >
        <Zap className="h-3.5 w-3.5" />
        {loading ? 'Processing…' : 'Process All'}
      </button>
    </div>
  );
}

function AccountBreakdown({ title, accounts, total, color }: {
  title: string;
  accounts: { code: string; name: string; balance: number }[];
  total: number;
  color: 'teal' | 'rose';
}) {
  const textColor = color === 'teal' ? 'text-teal-700 dark:text-teal-400' : 'text-rose-700 dark:text-rose-400';
  const barColor  = color === 'teal' ? 'bg-teal-500' : 'bg-rose-500';

  return (
    <div className="bg-background rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className={`text-sm font-semibold ${textColor}`}>{title}</h2>
        <span className="text-sm font-bold text-foreground">{fmtPeso(total)}</span>
      </div>
      <div className="px-5 py-3">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-2">No transactions this period</p>
        ) : (
          <div className="space-y-2.5">
            {accounts.map((a) => (
              <div key={a.code} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground shrink-0">{a.code}</span>
                  <span className="text-sm text-foreground truncate">{a.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColor} rounded-full`}
                      style={{ width: total > 0 ? `${Math.min((a.balance / total) * 100, 100)}%` : '0%' }}
                    />
                  </div>
                  <span className="text-sm font-medium text-foreground w-24 text-right">{fmtPeso(a.balance)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
