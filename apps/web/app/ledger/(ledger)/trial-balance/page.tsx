'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, XCircle, ChevronRight, CalendarDays, AlertTriangle, Download,
} from 'lucide-react';
import { api } from '@/lib/api';
import { downloadAuthFile } from '@/lib/utils';
import { toast } from 'sonner';

type AccountType    = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
type NormalBalance  = 'DEBIT' | 'CREDIT';
type PostingControl = 'OPEN' | 'AP_ONLY' | 'AR_ONLY' | 'SYSTEM_ONLY';

interface TBRow {
  id:             string;
  code:           string;
  name:           string;
  type:           AccountType;
  normalBalance:  NormalBalance;
  postingControl: PostingControl;
  debit:          number;
  credit:         number;
  balance:        number;
}

interface TrialBalance {
  rows:          TBRow[];
  totalDebits:   number;
  totalCredits:  number;
  isBalanced:    boolean;
}

const TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const TYPE_CONFIG: Record<AccountType, { label: string; color: string }> = {
  ASSET:     { label: 'Assets',      color: 'text-blue-600 bg-blue-500/10 border-blue-400/20' },
  LIABILITY: { label: 'Liabilities', color: 'text-rose-600 bg-rose-500/10 border-rose-400/20' },
  EQUITY:    { label: 'Equity',      color: 'text-purple-600 bg-purple-500/10 border-purple-400/20' },
  REVENUE:   { label: 'Revenue',     color: 'text-green-600 bg-green-500/10 border-green-400/20' },
  EXPENSE:   { label: 'Expenses',    color: 'text-amber-600 bg-amber-500/10 border-amber-400/20' },
};

function fmtPeso(n: number) {
  if (n === 0) return '—';
  return `₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function TrialBalancePage() {
  const router   = useRouter();
  const [asOf, setAsOf]         = useState(todayStr());
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await downloadAuthFile(
        `${API_URL}/api/v1/export/trial-balance?asOf=${asOf}`,
        `trial-balance-${asOf}.xlsx`,
      );
    } catch {
      toast.error('Failed to download Trial Balance. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  const { data, isLoading, isFetching } = useQuery<TrialBalance>({
    queryKey: ['trial-balance', asOf],
    queryFn: () => api.get(`/accounting/accounts/trial-balance?asOf=${asOf}`).then((r) => r.data),
  });

  const grouped = TYPE_ORDER.reduce<Record<AccountType, TBRow[]>>((acc, t) => {
    acc[t] = (data?.rows ?? []).filter((r) => r.type === t);
    return acc;
  }, {} as Record<AccountType, TBRow[]>);

  const groupTotals = (rows: TBRow[]) => ({
    debit:  rows.reduce((s, r) => s + r.debit, 0),
    credit: rows.reduce((s, r) => s + r.credit, 0),
  });

  const loading = isLoading || isFetching;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Trial Balance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All accounts with posted activity as of the selected date
          </p>
        </div>

        {/* As-of date picker + export */}
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
          <label className="text-sm text-muted-foreground whitespace-nowrap">As of</label>
          <input
            type="date"
            value={asOf}
            max={todayStr()}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <button
            onClick={handleExport}
            disabled={exporting || !data}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export to Excel"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{exporting ? 'Exporting…' : '.xlsx'}</span>
          </button>
        </div>
      </div>

      {/* Balance status banner */}
      {data && (
        <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
          data.isBalanced
            ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)]'
            : 'border-red-400/30 bg-red-500/5'
        }`}>
          {data.isBalanced
            ? <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-[var(--accent)]" />
            : <XCircle      className="w-5 h-5 mt-0.5 shrink-0 text-red-500" />
          }
          <div className="flex-1">
            <p className={`text-sm font-semibold ${data.isBalanced ? 'text-[var(--accent)]' : 'text-red-600 dark:text-red-400'}`}>
              {data.isBalanced ? 'Books are balanced' : 'Books are out of balance — investigate immediately'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Total Debits: <span className="font-medium text-foreground">
                ₱{data.totalDebits.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </span>
              {' · '}
              Total Credits: <span className="font-medium text-foreground">
                ₱{data.totalCredits.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </span>
              {!data.isBalanced && (
                <span className="text-red-500 ml-2 font-medium">
                  · Difference: ₱{Math.abs(data.totalDebits - data.totalCredits).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Out-of-balance warning */}
      {data && !data.isBalanced && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            An imbalance usually means a journal entry was posted with unequal debits and credits,
            or a system error occurred during event processing. Review recent journal entries and the event queue.
          </span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="h-10 bg-muted/40 animate-pulse" />
              {[1, 2, 3].map((j) => (
                <div key={j} className="flex justify-between px-4 py-3 border-t border-border">
                  <div className="h-3 w-48 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Tables by type */}
      {!isLoading && data && (
        <div className="space-y-6">
          {TYPE_ORDER.map((type) => {
            const rows = grouped[type];
            if (!rows.length) return null;
            const cfg    = TYPE_CONFIG[type];
            const totals = groupTotals(rows);

            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{rows.length} accounts</span>
                </div>

                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase">
                        <th className="px-4 py-2.5 text-left font-semibold w-20">Code</th>
                        <th className="px-4 py-2.5 text-left font-semibold">Account Name</th>
                        <th className="px-4 py-2.5 text-right font-semibold w-36">Debit</th>
                        <th className="px-4 py-2.5 text-right font-semibold w-36">Credit</th>
                        <th className="px-4 py-2.5 text-right font-semibold w-36 hidden md:table-cell">Balance</th>
                        <th className="px-4 py-2.5 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => router.push(`/ledger/accounts/${row.id}`)}
                          className="hover:bg-muted/30 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{row.code}</td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{row.name}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm text-foreground">
                            {row.debit > 0 ? fmtPeso(row.debit) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm text-foreground">
                            {row.credit > 0 ? fmtPeso(row.credit) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm hidden md:table-cell">
                            <span className={row.balance >= 0 ? 'text-foreground' : 'text-red-500'}>
                              {fmtPeso(row.balance)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            <ChevronRight className="w-4 h-4" />
                          </td>
                        </tr>
                      ))}
                    </tbody>

                    {/* Group subtotal */}
                    <tfoot>
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">
                          {cfg.label} Subtotal
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-foreground">
                          {totals.debit > 0 ? fmtPeso(totals.debit) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-foreground">
                          {totals.credit > 0 ? fmtPeso(totals.credit) : '—'}
                        </td>
                        <td className="hidden md:table-cell" />
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Grand total row */}
          {data.rows.length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <tfoot>
                  <tr className="bg-muted/40">
                    <td className="px-4 py-3 w-20" />
                    <td className="px-4 py-3 text-sm font-bold text-foreground">Grand Total</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-foreground w-36">
                      ₱{data.totalDebits.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-foreground w-36">
                      ₱{data.totalCredits.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-right font-mono font-bold w-36">
                      {data.isBalanced ? (
                        <span className="text-[var(--accent)]">Balanced ✓</span>
                      ) : (
                        <span className="text-red-500">
                          Diff ₱{Math.abs(data.totalDebits - data.totalCredits).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                    <td className="w-8" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {data.rows.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No posted journal entries found as of {asOf}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
