'use client';

/**
 * 13th-month pay computation page.
 *
 * Philippine law (PD 851): every rank-and-file employee with at least one
 * month of service in a calendar year is entitled to 1/12 of their basic
 * salary YTD, paid on or before December 24. This page lets the owner /
 * payroll master compute, review, and (in a future sprint) lock + remit.
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Users, RefreshCw, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

interface ThirteenthMonthRow {
  id:              string;
  userId:          string;
  year:            number;
  basicSalaryYTD:  string | number;
  amount:          string | number;
  user:            { id: string; name: string };
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

export default function ThirteenthMonthPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const canGenerate =
    user?.role === 'BUSINESS_OWNER' ||
    user?.role === 'PAYROLL_MASTER' ||
    user?.role === 'SUPER_ADMIN';

  const { data: rows = [], isLoading } = useQuery<ThirteenthMonthRow[]>({
    queryKey: ['payroll-13th', year],
    queryFn:  () => api.get(`/payroll/thirteenth-month?year=${year}`).then((r) => r.data),
    enabled:  !!user,
    staleTime: 60_000,
  });

  const generate = useMutation({
    mutationFn: () =>
      api.post(`/payroll/thirteenth-month?year=${year}`).then((r) => r.data),
    onSuccess: (res: { count: number; totalAmount: number }) => {
      toast.success(`Computed 13th-month for ${res.count} employees — ${formatPeso(res.totalAmount)} total`);
      qc.invalidateQueries({ queryKey: ['payroll-13th', year] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message ?? 'Failed to compute 13th-month');
    },
  });

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    const ytd   = rows.reduce((s, r) => s + Number(r.basicSalaryYTD), 0);
    return { total, ytd, count: rows.length };
  }, [rows]);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Gift className="h-5 w-5" style={{ color: 'var(--accent)' }} />
              13th-Month Pay
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              PD 851 — paid on or before December 24 every year.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-border bg-background rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {canGenerate && (
              <button
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                className="flex items-center gap-1.5 text-sm rounded-lg px-3 py-1.5 text-white transition-colors disabled:opacity-60"
                style={{ background: 'var(--accent)' }}
              >
                {generate.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                {rows.length > 0 ? 'Recompute' : 'Compute'} for {year}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground">Employees</span>
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-sky-500" />
              </div>
            </div>
            {isLoading
              ? <Skeleton className="h-7 w-20" />
              : <p className="text-xl font-bold text-foreground">{totals.count}</p>}
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground">Basic Salary YTD (sum)</span>
            </div>
            {isLoading
              ? <Skeleton className="h-7 w-28" />
              : <p className="text-xl font-bold text-foreground">{formatPeso(totals.ytd)}</p>}
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground">13th-Month Total</span>
            </div>
            {isLoading
              ? <Skeleton className="h-7 w-28" />
              : <p className="text-xl font-bold" style={{ color: 'var(--accent)' }}>{formatPeso(totals.total)}</p>}
          </div>
        </div>

        {/* Info banner */}
        <div className="border border-border bg-muted/30 rounded-xl p-4 flex gap-3">
          <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong className="text-foreground">Formula:</strong> total basic salary earned in {year} ÷ 12.</p>
            <p>Tax-exempt up to ₱90,000 per employee per year (TRAIN Law). Excess is taxable.</p>
            <p>Recomputes from posted payslips — re-run after any new pay run to refresh.</p>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Per-Employee Breakdown — {year}</h2>
          </div>
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1,2,3,4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No 13th-month rows yet for {year}. {canGenerate ? 'Click Compute to generate.' : 'Ask your payroll master to compute.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Employee</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Basic Salary YTD</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">÷ 12</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Taxable portion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const amt     = Number(r.amount);
                    const taxable = Math.max(0, amt - 90_000);
                    return (
                      <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-foreground font-medium">{r.user?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{formatPeso(Number(r.basicSalaryYTD))}</td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--accent)' }}>{formatPeso(amt)}</td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {taxable > 0 ? formatPeso(taxable) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td className="px-4 py-3 text-xs font-semibold text-foreground">Total ({totals.count})</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">{formatPeso(totals.ytd)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: 'var(--accent)' }}>{formatPeso(totals.total)}</td>
                    <td className="px-4 py-3" />
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
