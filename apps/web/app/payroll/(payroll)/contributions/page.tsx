'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HeartHandshake, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContributionRow {
  employeeName: string;
  sss: number;
  philhealth: number;
  pagibig: number;
  withholdingTax: number;
  totalDeductions: number;
}

interface ContributionSummaryDto {
  month: string;
  totalSss: number;
  totalPhilhealth: number;
  totalPagibig: number;
  totalWithholdingTax: number;
  totalDeductions: number;
  employeeCount: number;
  rows: ContributionRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  isLoading,
}: {
  label: string;
  value: number;
  isLoading: boolean;
}) {
  return (
    <div className="bg-background rounded-lg border border-border p-4 sm:p-5 flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      {isLoading ? (
        <Skeleton className="h-7 w-36" />
      ) : (
        <p className="text-xl sm:text-2xl font-bold text-foreground tabular-nums">{formatPeso(value)}</p>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ContributionsPage() {
  const { user }   = useAuthStore();
  const [month, setMonth] = useState(currentMonthValue());

  const { data, isLoading } = useQuery<ContributionSummaryDto>({
    queryKey: ['contributions', month],
    queryFn: () => api.get(`/payroll/contributions?month=${month}`).then((r) => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <HeartHandshake className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Government Contributions</h1>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Month:</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-5">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <SummaryCard label="SSS Contributions"  value={data?.totalSss ?? 0}              isLoading={isLoading} />
          <SummaryCard label="PhilHealth"          value={data?.totalPhilhealth ?? 0}       isLoading={isLoading} />
          <SummaryCard label="Pag-IBIG"            value={data?.totalPagibig ?? 0}          isLoading={isLoading} />
          <SummaryCard label="Withholding Tax"     value={data?.totalWithholdingTax ?? 0}   isLoading={isLoading} />
        </div>

        {/* Rates info box */}
        <div className="rounded-lg border border-border bg-muted/40 p-4 sm:p-5">
          <div className="flex items-start gap-2 mb-3">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs font-semibold text-foreground">2024 Philippine Contribution Rates (Employee Share)</p>
          </div>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>
              <strong className="text-foreground">SSS:</strong>{' '}
              4% of Monthly Salary Credit — range ₱4,000–₱30,000 (employee portion of 14% total rate)
            </li>
            <li>
              <strong className="text-foreground">PhilHealth:</strong>{' '}
              2.5% of basic salary per period — min ₱125/period, max ₱1,250/period (employee share of 5%)
            </li>
            <li>
              <strong className="text-foreground">Pag-IBIG:</strong>{' '}
              1–2% of monthly compensation, capped at ₱100/month (₱50/semi-monthly period)
            </li>
            <li>
              <strong className="text-foreground">Withholding Tax:</strong>{' '}
              BIR TRAIN Law graduated rates — 0% on compensation up to ₱250,000/year; 15–35% above
            </li>
          </ul>
        </div>

        {/* Table */}
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between gap-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <HeartHandshake className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No payslips found for this month.</p>
              <p className="text-xs mt-1">Process a pay run first to generate contribution data.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">SSS</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">PhilHealth</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pag-IBIG</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">WHT</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Deductions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, i) => (
                    <tr key={`${row.employeeName}-${i}`} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{row.employeeName}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{formatPeso(row.sss)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{formatPeso(row.philhealth)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{formatPeso(row.pagibig)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{formatPeso(row.withholdingTax)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground tabular-nums">{formatPeso(row.totalDeductions)}</td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals footer */}
                {data && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                      <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                        Total · {data.employeeCount} employee{data.employeeCount !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--accent)' }}>{formatPeso(data.totalSss)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--accent)' }}>{formatPeso(data.totalPhilhealth)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--accent)' }}>{formatPeso(data.totalPagibig)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--accent)' }}>{formatPeso(data.totalWithholdingTax)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--accent)' }}>{formatPeso(data.totalDeductions)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
