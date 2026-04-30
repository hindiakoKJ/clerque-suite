'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

interface Row {
  id:      string;
  code:    string;
  name:    string;
  balance: number;
}

interface BalanceSheet {
  asOf:                       string;
  assets:                     Row[];
  liabilities:                Row[];
  equity:                     Row[];
  totalAssets:                number;
  totalLiabilities:           number;
  totalEquity:                number;
  totalLiabilitiesAndEquity:  number;
  retainedEarnings:           number;
  balanced:                   boolean;
}

const READ_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR'];

function todayIso() { return new Date().toISOString().slice(0, 10); }

/**
 * Segment assets by code:
 *   1000-1099 → Cash & Cash Equivalents
 *   1100-1299 → Receivables
 *   1300-1499 → Inventory
 *   1500-1799 → Prepaid / Other Current
 *   1800-1899 → PPE (Property, Plant & Equipment)
 *   1900+     → Intangible / Other Non-Current
 *
 * Liabilities by code:
 *   2000-2099 → AP & Trade Payables
 *   2100-2299 → Tax Payables (VAT, WHT)
 *   2300-2499 → Accrued / Short-term
 *   2500+     → Long-term debt
 */
function segmentRows(rows: Row[], buckets: { label: string; from: number; to: number }[]) {
  const out: { label: string; rows: Row[]; total: number }[] = buckets.map((b) => ({ label: b.label, rows: [], total: 0 }));
  const overflow: Row[] = [];
  for (const r of rows) {
    const code = parseInt(r.code, 10);
    const idx = buckets.findIndex((b) => code >= b.from && code <= b.to);
    if (idx >= 0) { out[idx].rows.push(r); out[idx].total += r.balance; }
    else overflow.push(r);
  }
  return { groups: out.filter((g) => g.rows.length > 0), overflow };
}

const ASSET_BUCKETS = [
  { label: 'Cash & Cash Equivalents', from: 1000, to: 1099 },
  { label: 'Receivables',             from: 1100, to: 1299 },
  { label: 'Inventory',               from: 1300, to: 1499 },
  { label: 'Prepayments & Other Current', from: 1500, to: 1799 },
  { label: 'Property, Plant & Equipment', from: 1800, to: 1899 },
  { label: 'Intangible & Other Non-Current', from: 1900, to: 1999 },
];
const LIABILITY_BUCKETS = [
  { label: 'Trade Payables',          from: 2000, to: 2099 },
  { label: 'Tax Payables',            from: 2100, to: 2299 },
  { label: 'Accrued & Short-term',    from: 2300, to: 2499 },
  { label: 'Long-term Debt',          from: 2500, to: 2999 },
];

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
  const canRead = user ? READ_ROLES.includes(user.role) : false;

  const { data, isLoading, error } = useQuery<BalanceSheet>({
    queryKey: ['balance-sheet', asOf],
    queryFn:  () => api.get(`/accounting/accounts/balance-sheet?asOf=${asOf}`).then((r) => r.data),
    enabled:  !!user && canRead,
  });

  if (!canRead) {
    return <div className="p-8 text-center text-muted-foreground">Balance Sheet is restricted to finance roles.</div>;
  }

  const assetGroups = data ? segmentRows(data.assets, ASSET_BUCKETS) : null;
  const liabilityGroups = data ? segmentRows(data.liabilities, LIABILITY_BUCKETS) : null;

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
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">As of</label>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm" />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
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

              <Group label="Equity" rows={data.equity} total={data.totalEquity} />

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
