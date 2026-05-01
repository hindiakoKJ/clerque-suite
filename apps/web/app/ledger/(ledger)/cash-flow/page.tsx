'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet, AlertCircle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';

interface FlowRow {
  label:        string;
  code:         string;
  name:         string;
  delta:        number;
  effectOnCash: number;
}

interface CashFlow {
  periodStart:    string;
  periodEnd:      string;
  netIncome:      number;
  operating:      FlowRow[];
  operatingTotal: number;
  investing:      FlowRow[];
  investingTotal: number;
  financing:      FlowRow[];
  financingTotal: number;
  netChange:      number;
  openingCash:    number;
  endingCash:     number;
  reconciles:     boolean;
}

const READ_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_LEAD'];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function startOfMonth() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

function FlowSection({
  title, subtitle, rows, total, accent,
}: {
  title: string;
  subtitle?: string;
  rows:  FlowRow[];
  total: number;
  accent?: 'positive' | 'negative';
}) {
  return (
    <div className="space-y-1 mt-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        {title}
      </div>
      {subtitle && <p className="text-[11px] text-muted-foreground italic mb-2">{subtitle}</p>}
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-4 italic">No movements in this section.</p>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="flex justify-between text-sm pl-4">
            <span className="text-muted-foreground">
              <span className="font-mono text-xs mr-2">{r.code}</span>
              {r.name}
            </span>
            <span className={`tabular-nums ${r.effectOnCash >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {r.effectOnCash >= 0 ? '+' : ''}{formatPeso(r.effectOnCash)}
            </span>
          </div>
        ))
      )}
      <div
        className={`flex justify-between pt-1 mt-1 border-t border-border text-sm font-semibold ${
          accent === 'positive' ? 'text-emerald-600' :
          accent === 'negative' ? 'text-red-500' : ''
        }`}
      >
        <span>Net Cash from {title}</span>
        <span className="tabular-nums">{total >= 0 ? '+' : ''}{formatPeso(total)}</span>
      </div>
    </div>
  );
}

export default function CashFlowPage() {
  const user = useAuthStore((s) => s.user);
  const [from, setFrom] = useState(startOfMonth());
  const [to,   setTo]   = useState(todayIso());

  const canRead = user ? READ_ROLES.includes(user.role) : false;

  const { data, isLoading, error } = useQuery<CashFlow>({
    queryKey: ['cash-flow', from, to],
    queryFn:  () => api.get(`/accounting/accounts/cash-flow?from=${from}&to=${to}`).then((r) => r.data),
    enabled:  !!user && canRead,
  });

  if (!canRead) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        Cash Flow Statement is restricted to Business Owner, Accountant, Branch Manager, and Finance Lead.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[var(--accent)]" />
          Cash Flow Statement
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Indirect method — net income adjusted for working-capital changes, investing, and financing
          activities. Required for BIR audit + lender reviews.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm" />
        </div>
      </div>

      {isLoading ? (
        <Spinner size="lg" message="Computing cash flow…" />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          Failed to load cash flow.
        </div>
      ) : data ? (
        <>
          {!data.reconciles && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <div className="font-semibold">Cash flow doesn&apos;t reconcile to the balance sheet.</div>
                <div className="leading-snug">
                  Opening cash {formatPeso(data.openingCash)} + net change {formatPeso(data.netChange)}
                  {' = '}{formatPeso(data.openingCash + data.netChange)}, but the balance sheet shows ending cash of
                  {' '}{formatPeso(data.endingCash)}. Difference: {formatPeso(data.endingCash - (data.openingCash + data.netChange))}.
                  Likely cause: a journal entry that touched cash without a matching counter-entry, or
                  unposted accounting events. Check the Event Queue.
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-background p-5 sm:p-6 space-y-3">
            {/* Net Income — anchor of indirect method */}
            <div className="flex justify-between text-sm pb-3 border-b border-border">
              <span className="font-semibold">Net Income (from P&amp;L)</span>
              <span className={`tabular-nums font-semibold ${data.netIncome >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {data.netIncome >= 0 ? '+' : ''}{formatPeso(data.netIncome)}
              </span>
            </div>

            <FlowSection
              title="Operating Activities"
              subtitle="Net income adjusted for changes in receivables, inventory, payables, and accruals."
              rows={data.operating}
              total={data.operatingTotal}
              accent={data.operatingTotal >= 0 ? 'positive' : 'negative'}
            />

            <FlowSection
              title="Investing Activities"
              subtitle="Purchases / disposals of long-term assets (PPE, intangibles)."
              rows={data.investing}
              total={data.investingTotal}
              accent={data.investingTotal >= 0 ? 'positive' : 'negative'}
            />

            <FlowSection
              title="Financing Activities"
              subtitle="Owner contributions / drawings, loan proceeds / repayments."
              rows={data.financing}
              total={data.financingTotal}
              accent={data.financingTotal >= 0 ? 'positive' : 'negative'}
            />

            {/* Bottom summary */}
            <div className="border-t-2 border-foreground/20 pt-3 mt-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="font-semibold">Net change in cash</span>
                <span className={`tabular-nums font-semibold ${data.netChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {data.netChange >= 0 ? '+' : ''}{formatPeso(data.netChange)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>+ Opening cash balance ({data.periodStart})</span>
                <span className="tabular-nums">{formatPeso(data.openingCash)}</span>
              </div>
              <div className="flex justify-between border-t border-[var(--accent)] pt-2 mt-2 text-base font-bold text-[var(--accent)]">
                <span>= Ending cash balance ({data.periodEnd})</span>
                <span className="tabular-nums">{formatPeso(data.endingCash)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                {data.operatingTotal >= 0 ? <ArrowUpRight className="w-3 h-3 text-emerald-600" /> : <ArrowDownRight className="w-3 h-3 text-red-500" />}
                Operating
              </div>
              <div className={`font-semibold tabular-nums ${data.operatingTotal >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {formatPeso(data.operatingTotal)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                {data.investingTotal >= 0 ? <ArrowUpRight className="w-3 h-3 text-emerald-600" /> : <ArrowDownRight className="w-3 h-3 text-red-500" />}
                Investing
              </div>
              <div className={`font-semibold tabular-nums ${data.investingTotal >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {formatPeso(data.investingTotal)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                {data.financingTotal >= 0 ? <ArrowUpRight className="w-3 h-3 text-emerald-600" /> : <ArrowDownRight className="w-3 h-3 text-red-500" />}
                Financing
              </div>
              <div className={`font-semibold tabular-nums ${data.financingTotal >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {formatPeso(data.financingTotal)}
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground border-t border-border pt-3 leading-relaxed">
            <strong>Method:</strong> Indirect — starts with net income from the P&amp;L for the period, then
            reverses non-cash items by tracking changes in working-capital balance-sheet accounts. Asset
            increases consume cash (negative effect); liability increases provide cash (positive effect).
            Depreciation / amortization adjustments are not yet automated; if your books include those
            entries, they&apos;re already netted into net income and the working-capital changes.
          </div>
        </>
      ) : null}
    </div>
  );
}
