'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, DollarSign, CalendarClock, CheckCircle2,
  AlertCircle, Clock, TrendingUp, RefreshCw, ArrowRight,
  UserCheck, UserX,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

function currentMonthLabel() {
  return new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

interface PayrollSummary {
  activeEmployees:    number;
  onLeaveToday:       number;
  totalGrossMtd:      number;
  totalDeductionsMtd: number;
  totalNetMtd:        number;
  completedRuns:      number;
  pendingRuns:        number;
  nextRunDate:        string | null;
  nextRunEmployees:   number;
  averageGross:       number;
  departmentBreakdown: { department: string; headcount: number; grossPay: number }[];
  recentRuns: {
    id: string;
    label: string;
    status: 'COMPLETED' | 'PROCESSING' | 'DRAFT' | 'FAILED';
    periodEnd: string;
    totalNet: number;
    employeeCount: number;
  }[];
}

const RUN_STATUS_STYLES: Record<
  PayrollSummary['recentRuns'][number]['status'],
  { tone: 'success' | 'warn' | 'default' | 'danger'; label: string }
> = {
  COMPLETED:  { tone: 'success', label: 'Completed'  },
  PROCESSING: { tone: 'warn',    label: 'Processing' },
  DRAFT:      { tone: 'default', label: 'Draft'      },
  FAILED:     { tone: 'danger',  label: 'Failed'     },
};

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

export default function PayrollDashboard() {
  const { user } = useAuthStore();
  const router = useRouter();

  const { data, isLoading, refetch, isFetching } = useQuery<PayrollSummary>({
    queryKey: ['payroll-summary'],
    queryFn: () => api.get('/payroll/summary').then((r) => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  const monthLabel = currentMonthLabel();

  return (
    <div className="flex flex-col h-full overflow-auto">

      {/* Page header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground mb-0.5">
              {getGreeting()}, {user?.name?.split(' ')[0] ?? 'there'}
            </p>
            <h1 className="text-xl font-semibold text-foreground">Payroll Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Month-to-date · <span className="font-medium text-foreground">{monthLabel}</span>
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors self-start mt-1"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 text-muted-foreground ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-5 sm:space-y-6">

        {/* Hero: Net Pay MTD */}
        <div className="bg-background rounded-lg border border-border border-l-4 border-l-[var(--accent)] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              NET PAY · MTD
            </p>
            {isLoading ? (
              <Skeleton className="h-10 w-48" />
            ) : (
              <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground leading-none">
                {formatPeso(data?.totalNetMtd ?? 0)}
              </p>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              {monthLabel} · Gross minus deductions
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <TrendingUp className="h-6 w-6" />
            <span className="text-sm font-semibold">
              {data?.completedRuns ?? 0} run{data?.completedRuns !== 1 ? 's' : ''} done
            </span>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {[
            {
              icon: Users,
              label: 'Active Staff',
              value: isLoading ? null : String(data?.activeEmployees ?? 0),
              sub: isLoading ? null : `${data?.onLeaveToday ?? 0} on leave today`,
              accent: false,
              warn: false,
            },
            {
              icon: DollarSign,
              label: 'Gross Pay (MTD)',
              value: isLoading ? null : formatPeso(data?.totalGrossMtd ?? 0),
              sub: isLoading ? null : `Avg ${formatPeso(data?.averageGross ?? 0)}`,
              accent: false,
              warn: false,
            },
            {
              icon: TrendingUp,
              label: 'Deductions (MTD)',
              value: isLoading ? null : formatPeso(data?.totalDeductionsMtd ?? 0),
              sub: 'Tax + SSS + PhilHealth + Pag-IBIG',
              accent: false,
              warn: false,
            },
            {
              icon: CheckCircle2,
              label: 'Net Pay (MTD)',
              value: isLoading ? null : formatPeso(data?.totalNetMtd ?? 0),
              sub: isLoading ? null : `${data?.completedRuns ?? 0} completed runs`,
              accent: true,
              warn: false,
            },
            {
              icon: AlertCircle,
              label: 'Pending Runs',
              value: isLoading ? null : String(data?.pendingRuns ?? 0),
              sub: 'Awaiting approval',
              accent: false,
              warn: (data?.pendingRuns ?? 0) > 0,
            },
            {
              icon: CalendarClock,
              label: 'Next Run',
              value: isLoading ? null : (
                data?.nextRunDate
                  ? new Date(data.nextRunDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
                  : '—'
              ),
              sub: isLoading ? null : data?.nextRunDate
                ? `${data.nextRunEmployees} employees`
                : 'No upcoming run',
              accent: false,
              warn: false,
            },
          ].map((card) => (
            <div
              key={card.label}
              className={`bg-background rounded-lg border border-border p-3 sm:p-4 flex flex-col justify-between min-h-[88px] ${
                card.accent ? 'border-l-4 border-l-[var(--accent)]' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-1">
                <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                  card.accent ? 'bg-[var(--accent-soft)]' : 'bg-muted'
                }`}>
                  <card.icon className={`h-3.5 w-3.5 ${
                    card.accent ? 'text-[var(--accent)]' : 'text-muted-foreground'
                  }`} />
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-0.5 leading-tight">{card.label}</p>
                {card.value === null ? (
                  <Skeleton className="h-5 w-20" />
                ) : (
                  <p className={`text-base sm:text-lg font-bold leading-tight truncate ${
                    card.warn
                      ? 'text-amber-600 dark:text-amber-400'
                      : card.accent
                        ? 'text-[var(--accent)]'
                        : 'text-foreground'
                  }`}>
                    {card.value}
                  </p>
                )}
                {card.sub && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{card.sub}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">

          {/* Recent Pay Runs */}
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Recent Pay Runs</h2>
              </div>
              <button
                onClick={() => router.push('/payroll/runs')}
                className="text-xs font-medium flex items-center gap-1 transition-colors hover:opacity-80"
                style={{ color: 'var(--accent)' }}
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {isLoading ? (
              <div className="p-5 space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            ) : !data?.recentRuns.length ? (
              <p className="px-5 py-6 text-sm text-muted-foreground italic">No pay runs yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {data.recentRuns.map((run) => {
                  const s = RUN_STATUS_STYLES[run.status];
                  return (
                    <div key={run.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{run.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(run.periodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {' · '}
                          {run.employeeCount} employees
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold text-foreground">{formatPeso(run.totalNet)}</span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Department Breakdown */}
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">By Department</h2>
              </div>
              <button
                onClick={() => router.push('/payroll/staff')}
                className="text-xs font-medium flex items-center gap-1 transition-colors hover:opacity-80"
                style={{ color: 'var(--accent)' }}
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {isLoading ? (
              <div className="p-5 space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : !data?.departmentBreakdown.length ? (
              <p className="px-5 py-6 text-sm text-muted-foreground italic">No department data yet.</p>
            ) : (
              <div className="px-5 py-4 space-y-3">
                {data.departmentBreakdown.map((dept) => {
                  const maxGross = Math.max(...data.departmentBreakdown.map((d) => d.grossPay), 1);
                  const pct = (dept.grossPay / maxGross) * 100;
                  return (
                    <div key={dept.department}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-foreground truncate">{dept.department}</span>
                        <span className="text-muted-foreground shrink-0 ml-2">
                          {dept.headcount} staff · {formatPeso(dept.grossPay)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct.toFixed(1)}%`, background: 'var(--accent)' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Attendance snapshot */}
        {!isLoading && data && (
          <div className="bg-background rounded-lg border border-border p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Attendance Snapshot · Today
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                {
                  icon: UserCheck, label: 'Present',
                  value: data.activeEmployees - data.onLeaveToday,
                  color: 'text-emerald-600 dark:text-emerald-400',
                  bg: 'bg-emerald-500/10',
                },
                {
                  icon: UserX, label: 'On Leave',
                  value: data.onLeaveToday,
                  color: 'text-amber-600 dark:text-amber-400',
                  bg: 'bg-amber-500/10',
                },
                {
                  icon: Users, label: 'Total Staff',
                  value: data.activeEmployees,
                  color: 'text-foreground',
                  bg: 'bg-muted',
                },
                {
                  icon: Clock, label: 'Pending Runs',
                  value: data.pendingRuns,
                  color: data.pendingRuns > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                  bg: data.pendingRuns > 0 ? 'bg-amber-500/10' : 'bg-muted',
                },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
