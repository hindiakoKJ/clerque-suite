'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale, AlertCircle, Download } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso, downloadAuthFile } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { todayIso } from '@/lib/today';

import {
  type StatementRow as Row,
  type RowGroup,
  ASSET_BUCKETS, LIABILITY_BUCKETS, segmentRows, visibleRows, emptyCount, shownGroups,
} from '../_lib/statement-rows';

interface BalanceSheet {
  asOf:                       string;
  assets:                     Row[];
  liabilities:                Row[];
  equity:                     Row[];
  /** Sub-headings with subtotals where contra accounts reduce their group. */
  assetGroups?:               RowGroup<Row>[];
  liabilityGroups?:           RowGroup<Row>[];
  totalAssets:                number;
  totalLiabilities:           number;
  totalEquity:                number;
  totalLiabilitiesAndEquity:  number;
  retainedEarnings:           number;
  balanced:                   boolean;
}

const READ_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR'];

// The groups (cash, receivables, inventory ...) and the hide-empty-rows rule
// live in ../_lib/statement-rows.ts, where they are tested.

function Group({ label, rows, total }: { label: string; rows: Row[]; total: number }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2">
        {label}
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex justify-between text-sm pl-3">
          <span className="text-muted-foreground">
            <span className="font-mono text-xs mr-2">{r.code}</span>{r.name}
          </span>
          <span className="tabular-nums">{formatPeso(r.balance)}</span>
        </div>
      ))}
      <div className="flex justify-between text-sm font-medium pt-1 border-t border-border/50">
        <span>Total {label}</span>
        <span className="tabular-nums">{formatPeso(total)}</span>
      </div>
    </div>
  );
}

export default function BalanceSheetPage() {
  const user = useAuthStore((s) => s.user);
  const [asOf, setAsOf] = useState(todayIso());
  const [exporting, setExporting] = useState(false);
  // Accounts with nothing in them are hidden until asked for: the seeded chart
  // has about a hundred, and a cafe uses a dozen.
  const [showEmpty, setShowEmpty] = useState(false);
  const canRead = user ? READ_ROLES.includes(user.role) : false;

  const { data, isLoading, error } = useQuery<BalanceSheet>({
    queryKey: ['balance-sheet', asOf],
    queryFn:  () => api.get(`/accounting/accounts/balance-sheet?asOf=${asOf}`).then((r) => r.data),
    enabled:  !!user && canRead,
  });

  async function handleExport() {
    setExporting(true);
    try {
      await downloadAuthFile(`/export/balance-sheet?asOf=${asOf}`, `balance-sheet-${asOf}.xlsx`);
    } catch {
      toast.error('Failed to download Balance Sheet. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  if (!canRead) {
    return <div className="p-8 text-center text-muted-foreground">Balance Sheet is restricted to finance roles.</div>;
  }

  // Prefer the API's groups: their subtotals subtract contra accounts
  // (Accumulated Depreciation). The local grouping is only a fallback.
  const assetGroups = !data ? null
    : data.assetGroups ? { groups: shownGroups(data.assetGroups, showEmpty), overflow: [] as Row[] }
    : segmentRows(visibleRows(data.assets, showEmpty), ASSET_BUCKETS);
  const liabilityGroups = !data ? null
    : data.liabilityGroups ? { groups: shownGroups(data.liabilityGroups, showEmpty), overflow: [] as Row[] }
    : segmentRows(visibleRows(data.liabilities, showEmpty), LIABILITY_BUCKETS);
  const equityRows = data ? visibleRows(data.equity, showEmpty) : [];
  const hiddenCount = data ? emptyCount(data.assets, data.liabilities, data.equity) : 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Scale className="w-5 h-5 text-[var(--accent)]" />
            Balance Sheet
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Snapshot of Assets = Liabilities + Equity at a point in time.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">As of</label>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-background text-sm" />
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !data}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? 'Exporting…' : 'XLSX'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <Spinner size="lg" message="Computing balance sheet…" />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          Failed to load Balance Sheet.
        </div>
      ) : data && assetGroups && liabilityGroups ? (
        <>
          {!data.balanced && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <div className="font-semibold">Books are not balanced.</div>
                <div className="leading-snug">
                  Assets {formatPeso(data.totalAssets)} ≠ Liabilities + Equity {formatPeso(data.totalLiabilitiesAndEquity)}.
                  Difference: {formatPeso(data.totalAssets - data.totalLiabilitiesAndEquity)}.
                  Investigate posted journal entries — there may be one-sided lines or invalid entries.
                </div>
              </div>
            </div>
          )}

          {hiddenCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={showEmpty}
                onChange={(e) => setShowEmpty(e.target.checked)}
                className="rounded border-border"
              />
              Show empty accounts ({hiddenCount})
            </label>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ASSETS */}
            <div className="rounded-xl border border-border bg-background p-5 space-y-3">
              <div className="text-sm font-bold text-foreground">ASSETS</div>
              {assetGroups.groups.map((g) => <Group key={g.label} {...g} />)}
              {assetGroups.overflow.length > 0 && (
                <Group label="Other Assets" rows={assetGroups.overflow} total={assetGroups.overflow.reduce((s, r) => s + r.balance, 0)} />
              )}
              <div className="flex justify-between text-base font-bold border-t-2 border-[var(--accent)] pt-2 mt-3">
                <span>Total Assets</span>
                <span className="tabular-nums text-[var(--accent)]">{formatPeso(data.totalAssets)}</span>
              </div>
            </div>

            {/* LIABILITIES + EQUITY */}
            <div className="rounded-xl border border-border bg-background p-5 space-y-3">
              <div className="text-sm font-bold text-foreground">LIABILITIES &amp; EQUITY</div>

              {liabilityGroups.groups.map((g) => <Group key={g.label} {...g} />)}
              {liabilityGroups.overflow.length > 0 && (
                <Group label="Other Liabilities" rows={liabilityGroups.overflow} total={liabilityGroups.overflow.reduce((s, r) => s + r.balance, 0)} />
              )}
              <div className="flex justify-between text-sm font-medium border-t border-border pt-1">
                <span>Total Liabilities</span>
                <span className="tabular-nums">{formatPeso(data.totalLiabilities)}</span>
              </div>

              <Group label="Equity" rows={equityRows} total={data.totalEquity} />

              <div className="flex justify-between text-base font-bold border-t-2 border-[var(--accent)] pt-2 mt-3">
                <span>Total Liabilities + Equity</span>
                <span className="tabular-nums text-[var(--accent)]">{formatPeso(data.totalLiabilitiesAndEquity)}</span>
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground text-center pt-2">
            Retained earnings (current period): <span className="tabular-nums font-medium">{formatPeso(data.retainedEarnings)}</span> — derived
            from the sum of revenue minus expenses across all posted entries through {data.asOf}. Closing entries to formalise this into
            an equity account require a period-close run.
          </div>
        </>
      ) : null}
    </div>
  );
}
