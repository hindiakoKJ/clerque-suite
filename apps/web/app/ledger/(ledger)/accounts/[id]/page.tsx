'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft, BookOpen, Lock, ShieldAlert, ChevronLeft, ChevronRight,
  CalendarDays, TrendingUp, TrendingDown, Minus, Download,
} from 'lucide-react';
import { api } from '@/lib/api';
import { downloadAuthFile } from '@/lib/utils';
import { toast } from 'sonner';

type AccountType    = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
type NormalBalance  = 'DEBIT' | 'CREDIT';
type PostingControl = 'OPEN' | 'AP_ONLY' | 'AR_ONLY' | 'SYSTEM_ONLY';
type JournalSource  = 'MANUAL' | 'SYSTEM' | 'AP' | 'AR';

interface AccountInfo {
  id:            string;
  code:          string;
  name:          string;
  type:          AccountType;
  normalBalance: NormalBalance;
}

interface LedgerRow {
  id:             string;
  documentDate:   string;   // When the economic event occurred
  postingDate:    string;   // Which period it landed in (used for ordering + display)
  entryNumber:    string;
  entryId:        string;
  description:    string | null;
  reference:      string | null;
  source:         JournalSource;
  debit:          number;
  credit:         number;
  runningBalance: number;
}

interface LedgerResponse {
  account: AccountInfo;
  rows:    LedgerRow[];
  total:   number;
  page:    number;
  pages:   number;
}

const TYPE_CONFIG: Record<AccountType, { label: string; color: string }> = {
  ASSET:     { label: 'Asset',     color: 'text-blue-600 bg-blue-500/10 border-blue-400/20' },
  LIABILITY: { label: 'Liability', color: 'text-rose-600 bg-rose-500/10 border-rose-400/20' },
  EQUITY:    { label: 'Equity',    color: 'text-purple-600 bg-purple-500/10 border-purple-400/20' },
  REVENUE:   { label: 'Revenue',   color: 'text-green-600 bg-green-500/10 border-green-400/20' },
  EXPENSE:   { label: 'Expense',   color: 'text-amber-600 bg-amber-500/10 border-amber-400/20' },
};

const SOURCE_CONFIG: Record<JournalSource, { label: string; color: string }> = {
  MANUAL: { label: 'Manual',   color: 'text-[var(--accent)] bg-[var(--accent-soft)]' },
  SYSTEM: { label: 'System',   color: 'text-muted-foreground bg-muted/60' },
  AP:     { label: 'AP',       color: 'text-amber-600 bg-amber-500/10' },
  AR:     { label: 'AR',       color: 'text-sky-600 bg-sky-500/10' },
};

const CTRL_CONFIG: Record<PostingControl, { label: string; Icon: React.ElementType; color: string }> = {
  OPEN:        { label: 'Open',    Icon: BookOpen,    color: 'text-[var(--accent)] bg-[var(--accent-soft)]' },
  AP_ONLY:     { label: 'AP Only', Icon: ShieldAlert, color: 'text-amber-600 bg-amber-500/10' },
  AR_ONLY:     { label: 'AR Only', Icon: ShieldAlert, color: 'text-sky-600 bg-sky-500/10' },
  SYSTEM_ONLY: { label: 'System',  Icon: Lock,        color: 'text-muted-foreground bg-muted/60' },
};

function fmtPeso(n: number) {
  if (n === 0) return '—';
  return `₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function AccountLedgerPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [from, setFrom]         = useState(firstDayOfMonth());
  const [to,   setTo]           = useState(todayStr());
  const [page, setPage]         = useState(1);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ from, to });
      await downloadAuthFile(
        `${API_URL}/api/v1/export/account-ledger/${id}?${params}`,
        `ledger-${id}-${from}_to_${to}.xlsx`,
      );
    } catch {
      toast.error('Failed to download account ledger. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  const { data, isLoading } = useQuery<LedgerResponse>({
    queryKey: ['account-ledger', id, from, to, page],
    queryFn: () =>
      api.get(`/accounting/accounts/${id}/ledger`, {
        params: { from, to, page },
      }).then((r) => r.data),
    enabled: !!id,
  });

  // Also fetch account detail for the posting control badge
  const { data: accountDetail } = useQuery<{
    id: string; code: string; name: string; type: AccountType;
    normalBalance: NormalBalance; postingControl: PostingControl;
    isSystem: boolean; description: string | null;
  }>({
    queryKey: ['account', id],
    queryFn: () => api.get(`/accounting/accounts/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const account = data?.account ?? accountDetail;
  const rows    = data?.rows ?? [];

  // Summarise the visible page
  const pageDebit  = rows.reduce((s, r) => s + r.debit,  0);
  const pageCredit = rows.reduce((s, r) => s + r.credit, 0);
  const endBalance = rows.at(-1)?.runningBalance ?? 0;

  const typeCfg = account ? TYPE_CONFIG[account.type] : null;
  const ctrlCfg = accountDetail ? CTRL_CONFIG[accountDetail.postingControl] : null;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">

      {/* Back */}
      <button
        onClick={() => router.push('/ledger/accounts')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Chart of Accounts
      </button>

      {/* Account header */}
      {account ? (
        <div className="bg-card rounded-xl border border-border p-5 flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <span className="font-mono text-sm text-muted-foreground">{account.code}</span>
              {typeCfg && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${typeCfg.color}`}>
                  {typeCfg.label}
                </span>
              )}
              {ctrlCfg && (
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${ctrlCfg.color}`}>
                  <ctrlCfg.Icon className="w-3 h-3" />
                  {ctrlCfg.label}
                </span>
              )}
              {accountDetail?.isSystem && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="w-3 h-3" /> System
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-foreground">{account.name}</h1>
            {accountDetail?.description && (
              <p className="text-sm text-muted-foreground mt-1">{accountDetail.description}</p>
            )}
          </div>

          {/* Balance summary */}
          <div className="flex gap-4 shrink-0">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Normal Balance</p>
              <span className={`text-sm font-semibold px-2 py-1 rounded-lg ${
                account.normalBalance === 'DEBIT'
                  ? 'bg-blue-500/10 text-blue-600'
                  : 'bg-purple-500/10 text-purple-600'
              }`}>
                {account.normalBalance}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-28 bg-muted rounded-xl animate-pulse" />
      )}

      {/* Date range filters */}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-1.5">
          <label className="text-sm text-muted-foreground">From</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-sm text-muted-foreground">To</label>
          <input
            type="date"
            value={to}
            min={from}
            max={todayStr()}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        {data && (
          <span className="text-xs text-muted-foreground">
            {data.total} line{data.total !== 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={handleExport}
          disabled={exporting || !data?.rows.length}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          title="Export to Excel"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">{exporting ? 'Exporting…' : '.xlsx'}</span>
        </button>
      </div>

      {/* Page summary strip */}
      {data && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard
            label="Total Debits (page)"
            value={fmtPeso(pageDebit)}
            icon={TrendingUp}
            color="blue"
          />
          <SummaryCard
            label="Total Credits (page)"
            value={fmtPeso(pageCredit)}
            icon={TrendingDown}
            color="rose"
          />
          <SummaryCard
            label={endBalance >= 0 ? 'Closing Balance' : 'Closing Balance (Cr)'}
            value={`₱${Math.abs(endBalance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
            icon={Minus}
            color={endBalance >= 0 ? 'teal' : 'amber'}
          />
        </div>
      )}

      {/* Ledger table */}
      {isLoading ? (
        <div className="space-y-1">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase">
                <th className="px-4 py-2.5 text-left font-semibold w-32 whitespace-nowrap">Posting Date</th>
                <th className="px-4 py-2.5 text-left font-semibold w-28 hidden sm:table-cell">JE #</th>
                <th className="px-4 py-2.5 text-left font-semibold">Description</th>
                <th className="px-4 py-2.5 text-left font-semibold hidden md:table-cell w-20">Source</th>
                <th className="px-4 py-2.5 text-right font-semibold w-28">Debit</th>
                <th className="px-4 py-2.5 text-right font-semibold w-28">Credit</th>
                <th className="px-4 py-2.5 text-right font-semibold w-32 hidden lg:table-cell">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No posted transactions in this date range.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const srcCfg = SOURCE_CONFIG[row.source];
                  const bal    = row.runningBalance;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/ledger/journal?highlight=${row.entryId}`)}
                      className="hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        <span>{fmtDate(row.postingDate)}</span>
                        {row.documentDate !== row.postingDate && (
                          <span className="block text-[10px] opacity-60">Doc: {fmtDate(row.documentDate)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs hidden sm:table-cell">
                        <span
                          className="text-[var(--accent)] hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/ledger/journal?highlight=${row.entryId}`);
                          }}
                        >
                          {row.entryNumber}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-foreground max-w-xs truncate">
                        {row.description ?? <span className="text-muted-foreground italic">No description</span>}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${srcCfg.color}`}>
                          {srcCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm">
                        {row.debit > 0
                          ? <span className="text-foreground">{fmtPeso(row.debit)}</span>
                          : <span className="text-muted-foreground/30">—</span>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm">
                        {row.credit > 0
                          ? <span className="text-foreground">{fmtPeso(row.credit)}</span>
                          : <span className="text-muted-foreground/30">—</span>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm hidden lg:table-cell">
                        <span className={bal >= 0 ? 'text-foreground' : 'text-red-500 dark:text-red-400'}>
                          {`₱${Math.abs(bal).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                          {bal < 0 && <span className="text-xs ml-1 opacity-70">Cr</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {data.pages} · {data.total} transactions
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, icon: Icon, color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: 'blue' | 'rose' | 'teal' | 'amber';
}) {
  const styles = {
    blue:  { bg: 'bg-blue-500/10',  icon: 'text-blue-500',  text: 'text-blue-700 dark:text-blue-400'  },
    rose:  { bg: 'bg-rose-500/10',  icon: 'text-rose-500',  text: 'text-rose-700 dark:text-rose-400'  },
    teal:  { bg: 'bg-teal-500/10',  icon: 'text-teal-500',  text: 'text-teal-700 dark:text-teal-400'  },
    amber: { bg: 'bg-amber-500/10', icon: 'text-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  }[color];

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${styles.bg}`}>
        <Icon className={`w-4 h-4 ${styles.icon}`} />
      </div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-base font-bold font-mono ${styles.text}`}>{value}</p>
    </div>
  );
}
