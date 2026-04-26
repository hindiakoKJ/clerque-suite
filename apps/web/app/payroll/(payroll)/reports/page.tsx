'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart2, TrendingUp, TrendingDown, Users, DollarSign,
  CalendarDays, Building2, Download, HeartHandshake,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { downloadAuthFile } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayRunDto {
  id: string; label: string; periodStart: string; periodEnd: string;
  frequency: string; status: string;
  totalGross: number; totalDeductions: number; totalNet: number;
  employeeCount: number; processedAt: string | null; createdAt: string;
}

interface PayrollSummary {
  activeEmployees: number; totalGrossMtd: number;
  totalDeductionsMtd: number; totalNetMtd: number;
  departmentBreakdown: { department: string; headcount: number; grossPay: number }[];
}

interface ContributionSummary {
  month: string;
  totalSss: number; totalPhilhealth: number; totalPagibig: number;
  totalWithholdingTax: number; totalDeductions: number; employeeCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return formatPeso(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function getYearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}`,
  );
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleString('en-PH', { month: 'short' });
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PayrollReportsPage() {
  const { user } = useAuthStore();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const currentMonth = new Date().toISOString().slice(0, 7);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: allRuns = [], isLoading: runsLoading } = useQuery<PayRunDto[]>({
    queryKey: ['payroll-runs'],
    queryFn: () => api.get('/payroll/runs').then((r) => r.data),
    staleTime: 60_000,
    enabled: !!user,
  });

  const { data: summary } = useQuery<PayrollSummary>({
    queryKey: ['payroll-summary'],
    queryFn: () => api.get('/payroll/summary').then((r) => r.data),
    staleTime: 60_000,
    enabled: !!user,
  });

  const { data: contributions } = useQuery<ContributionSummary>({
    queryKey: ['payroll-contributions', currentMonth],
    queryFn: () => api.get(`/payroll/contributions?month=${currentMonth}`).then((r) => r.data),
    staleTime: 60_000,
    enabled: !!user,
  });

  // ── Derived analytics ─────────────────────────────────────────────────
  const completedRuns = useMemo(
    () => allRuns.filter((r) => r.status === 'COMPLETED'),
    [allRuns],
  );

  // YTD aggregates from completed runs in the selected year
  const yearRuns = useMemo(
    () => completedRuns.filter((r) => r.periodStart.startsWith(String(selectedYear))),
    [completedRuns, selectedYear],
  );

  const ytd = useMemo(() => ({
    gross:       yearRuns.reduce((s, r) => s + r.totalGross, 0),
    deductions:  yearRuns.reduce((s, r) => s + r.totalDeductions, 0),
    net:         yearRuns.reduce((s, r) => s + r.totalNet, 0),
    runs:        yearRuns.length,
    employees:   yearRuns.length > 0 ? Math.max(...yearRuns.map((r) => r.employeeCount)) : 0,
  }), [yearRuns]);

  // Monthly bar chart data — group completed runs by period start YYYY-MM
  const monthlyData = useMemo(() => {
    const months = getYearMonths(selectedYear);
    const grouped = new Map<string, { gross: number; net: number }>();
    for (const r of yearRuns) {
      const ym = r.periodStart.slice(0, 7);
      const prev = grouped.get(ym) ?? { gross: 0, net: 0 };
      grouped.set(ym, { gross: prev.gross + r.totalGross, net: prev.net + r.totalNet });
    }
    return months.map((ym) => ({
      ym, label: monthLabel(ym),
      gross: grouped.get(ym)?.gross ?? 0,
      net:   grouped.get(ym)?.net   ?? 0,
    }));
  }, [yearRuns, selectedYear]);

  const maxMonthGross = Math.max(...monthlyData.map((m) => m.gross), 1);

  // Department cost breakdown from summary (MTD)
  const deptRows = summary?.departmentBreakdown ?? [];
  const deptTotal = deptRows.reduce((s, d) => s + d.grossPay, 0) || 1;

  const canExport = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN' || user?.role === 'PAYROLL_MASTER';

  return (
    <div className="flex flex-col h-full overflow-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <BarChart2 className="h-5 w-5" style={{ color: 'var(--accent)' }} />
              Payroll Reports
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Year-to-date payroll analytics and government remittance summary
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border border-border bg-background rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {canExport && (
              <button
                onClick={() => downloadAuthFile(`/export/payroll-ytd?year=${selectedYear}`, `payroll-ytd-${selectedYear}.xlsx`).catch(() => {})}
                className="flex items-center gap-1.5 text-sm border border-border rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-muted transition-colors"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-6">

        {/* ── YTD Summary Cards ───────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: `${selectedYear} Gross Payroll`, value: ytd.gross, icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            { label: `${selectedYear} Total Deductions`, value: ytd.deductions, icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-500/10' },
            { label: `${selectedYear} Net Payroll`, value: ytd.net, icon: TrendingUp, color: 'var(--accent)', bg: 'bg-[var(--accent-soft)]', accent: true },
            { label: 'Pay Runs Completed', value: ytd.runs, icon: CalendarDays, color: 'text-sky-500', bg: 'bg-sky-500/10', isCount: true },
          ].map((card) => (
            <div key={card.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
                <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>
                  <card.icon
                    className={`h-4 w-4 ${!card.accent ? card.color : ''}`}
                    style={card.accent ? { color: 'var(--accent)' } : undefined}
                  />
                </div>
              </div>
              {runsLoading ? (
                <Skeleton className="h-7 w-28" />
              ) : (
                <p className="text-xl font-bold text-foreground" style={card.accent ? { color: 'var(--accent)' } : {}}>
                  {card.isCount ? card.value : fmt(card.value)}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ── Monthly Gross/Net Bar Chart ──────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">
            Monthly Payroll Cost — {selectedYear}
          </h2>
          {runsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="flex items-end gap-1 h-40 px-1">
              {monthlyData.map((m) => {
                const grossH = m.gross > 0 ? Math.max((m.gross / maxMonthGross) * 100, 4) : 0;
                const netH   = m.net   > 0 ? Math.max((m.net   / maxMonthGross) * 100, 2) : 0;
                return (
                  <div key={m.ym} className="flex-1 flex flex-col items-center gap-1 group relative">
                    {/* Tooltip */}
                    {m.gross > 0 && (
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 bg-popover border border-border rounded-lg shadow-lg p-2 text-xs min-w-[120px] text-center">
                        <p className="font-semibold text-foreground">{m.label}</p>
                        <p className="text-muted-foreground">Gross: {fmt(m.gross)}</p>
                        <p className="text-muted-foreground">Net:   {fmt(m.net)}</p>
                      </div>
                    )}
                    <div className="w-full flex items-end gap-0.5" style={{ height: '100%' }}>
                      <div
                        className="flex-1 rounded-t-sm transition-all"
                        style={{ height: `${grossH}%`, background: 'var(--accent)', opacity: 0.7 }}
                      />
                      <div
                        className="flex-1 rounded-t-sm transition-all bg-emerald-500"
                        style={{ height: `${netH}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{m.label}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'var(--accent)', opacity: 0.7 }} />
              Gross Pay
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm inline-block bg-emerald-500" />
              Net Pay
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Department Cost Breakdown (MTD) ─────────────────────── */}
          <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Department Cost Breakdown (MTD)
            </h2>
            {deptRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No department data for this month. Process a pay run first.
              </p>
            ) : (
              <div className="space-y-3">
                {deptRows.map((dept) => {
                  const pct = deptTotal > 0 ? (dept.grossPay / deptTotal) * 100 : 0;
                  return (
                    <div key={dept.department}>
                      <div className="flex justify-between items-center text-sm mb-1">
                        <span className="font-medium text-foreground truncate">{dept.department}</span>
                        <div className="flex items-center gap-3 text-right shrink-0 ml-2">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="h-3 w-3" />{dept.headcount}
                          </span>
                          <span className="font-semibold text-foreground">{fmt(dept.grossPay)}</span>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: 'var(--accent)' }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(1)}% of payroll</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Government Remittance Summary (MTD) ─────────────────── */}
          <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <HeartHandshake className="h-4 w-4 text-muted-foreground" />
              Government Remittance (MTD)
            </h2>
            {!contributions ? (
              <div className="space-y-3">
                {[1,2,3,4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : contributions.employeeCount === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No contributions recorded this month.
              </p>
            ) : (
              <div className="space-y-2">
                {[
                  { label: 'SSS (Employee Share)',        amount: contributions.totalSss,             note: '4% of MSC' },
                  { label: 'PhilHealth (Employee Share)', amount: contributions.totalPhilhealth,       note: '2.5% of salary' },
                  { label: 'Pag-IBIG (Employee Share)',   amount: contributions.totalPagibig,         note: 'Max ₱100/mo' },
                  { label: 'Withholding Tax (BIR)',       amount: contributions.totalWithholdingTax,  note: 'TRAIN Law' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-2 px-3 bg-muted/40 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-foreground">{row.label}</p>
                      <p className="text-[10px] text-muted-foreground">{row.note}</p>
                    </div>
                    <span className="text-sm font-bold text-foreground">{fmt(row.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between py-2.5 px-3 rounded-lg border border-border mt-1">
                  <span className="text-sm font-semibold text-foreground">Total to Remit (Employee)</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                    {fmt(contributions.totalDeductions)}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  * Employer share (SSS: 8.5%, PhilHealth: 2.5%, Pag-IBIG: 2%) is not included above.
                  Total employer remittance is approximately {fmt(contributions.totalDeductions * 1.4)}.
                </p>
              </div>
            )}
          </div>

        </div>

        {/* ── Pay Run History ─────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Pay Run History — {selectedYear}
            </h2>
            <span className="text-xs text-muted-foreground">{yearRuns.length} completed run{yearRuns.length !== 1 ? 's' : ''}</span>
          </div>
          {runsLoading ? (
            <div className="p-4 space-y-3">
              {[1,2,3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : yearRuns.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No completed pay runs for {selectedYear}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Period</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Label</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">Employees</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Gross</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Deductions</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Net Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {yearRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-foreground hidden sm:table-cell">{run.label}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{run.employeeCount}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">{fmt(run.totalGross)}</td>
                      <td className="px-4 py-3 text-right text-red-500 hidden sm:table-cell">-{fmt(run.totalDeductions)}</td>
                      <td className="px-4 py-3 text-right font-bold" style={{ color: 'var(--accent)' }}>{fmt(run.totalNet)}</td>
                    </tr>
                  ))}
                </tbody>
                {/* Running totals footer */}
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td className="px-4 py-3 text-xs font-semibold text-foreground" colSpan={2}>YTD Total</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{ytd.employees} max</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">{fmt(ytd.gross)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-red-500 hidden sm:table-cell">-{fmt(ytd.deductions)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: 'var(--accent)' }}>{fmt(ytd.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
