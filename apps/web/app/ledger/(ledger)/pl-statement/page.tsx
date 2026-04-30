'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { downloadAuthFile } from '@/lib/utils';

interface Row {
  id:      string;
  code:    string;
  name:    string;
  balance: number;
}

interface PlSummary {
  from:             string;
  to:               string;
  revenueAccounts:  Row[];
  expenseAccounts:  Row[];
  totalRevenue:     number;
  totalExpenses:    number;
  netIncome:        number;
}

const READ_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_LEAD'];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function startOfMonth() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}

/**
 * Segment expense accounts:
 *   5000-5999 → Cost of Goods Sold
 *   6000-6999 → Operating Expenses (admin / general)
 *   7000-7999 → Other Operating Expenses
 *   8000+     → Non-Operating / Other Expenses
 *
 * This matches the seeded PH-standard COA.
 */
function segmentExpenses(expenses: Row[]) {
  const cogs:    Row[] = [];
  const opex:    Row[] = [];
  const otherOp: Row[] = [];
  const nonOp:   Row[] = [];
  for (const e of expenses) {
    const code = parseInt(e.code, 10);
    if      (code >= 5000 && code < 6000) cogs.push(e);
    else if (code >= 6000 && code < 7000) opex.push(e);
    else if (code >= 7000 && code < 8000) otherOp.push(e);
    else                                   nonOp.push(e);
  }
  const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.balance, 0);
  return {
    cogs,    cogsTotal:    sum(cogs),
    opex,    opexTotal:    sum(opex),
    otherOp, otherOpTotal: sum(otherOp),
    nonOp,   nonOpTotal:   sum(nonOp),
  };
}

function Section({ title, rows, total, accent }: {
  title: string; rows: Row[]; total: number; accent?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-1">
        {title}
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex justify-between text-sm pl-4">
          <span className="text-muted-foreground">
            <span className="font-mono text-xs mr-2">{r.code}</span>
            {r.name}
          </span>
          <span className="tabular-nums">{formatPeso(r.balance)}</span>
        </div>
      ))}
      <div className={`flex justify-between pt-1 mt-1 border-t border-border text-sm font-semibold ${accent ? 'text-[var(--accent)]' : ''}`}>
        <span>Total {title}</span>
        <span className="tabular-nums">{formatPeso(total)}</span>
      </div>
    </div>
  );
}

export default function PLStatementPage() {
  const user = useAuthStore((s) => s.user);
  const [from, setFrom] = useState(startOfMonth());
  const [to,   setTo]   = useState(todayIso());

  const canRead = user ? READ_ROLES.includes(user.role) : false;

  const { data, isLoading, error } = useQuery<PlSummary>({
    queryKey: ['pl-summary', from, to],
    queryFn:  () => api.get(`/accounting/accounts/pl-summary?from=${from}&to=${to}`).then((r) => r.data),
    enabled:  !!user && canRead,
  });

  if (!canRead) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Income Statement is restricted to Business Owners, Accountants, Branch Managers, and Finance Leads.
      </div>
    );
  }

  const seg = data ? segmentExpenses(data.expenseAccounts) : null;
  const grossProfit = data && seg ? data.totalRevenue - seg.cogsTotal : 0;
  const operatingIncome = seg ? grossProfit - seg.opexTotal - seg.otherOpTotal : 0;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[var(--accent)]" />
            Income Statement (P&amp;L)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Revenue minus expenses for the selected period. Period must be within an open accounting period for live data.
          </p>
        </div>
        <button
          onClick={() => downloadAuthFile(`/export/pl-summary?from=${from}&to=${to}`, `pl-statement-${from}-to-${to}.xlsx`)}
          className="h-9 px-3 text-sm border border-border rounded-lg hover:bg-muted flex items-center gap-2 self-start"
        >
          <Download className="w-4 h-4" /> Export .xlsx
        </button>
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
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          Failed to load P&amp;L. Check that the period contains posted journal entries.
        </div>
      ) : data && seg ? (
        <div className="rounded-xl border border-border bg-background p-5 sm:p-6 space-y-5">
          <Section title="Revenue" rows={data.revenueAccounts} total={data.totalRevenue} accent />
          <Section title="Cost of Goods Sold" rows={seg.cogs} total={seg.cogsTotal} />
          <div className="flex justify-between text-sm font-bold border-y-2 border-foreground/20 py-2">
            <span>Gross Profit</span>
            <span className="tabular-nums">{formatPeso(grossProfit)}</span>
          </div>
          <Section title="Operating Expenses" rows={seg.opex} total={seg.opexTotal} />
          <Section title="Other Operating Expenses" rows={seg.otherOp} total={seg.otherOpTotal} />
          <div className="flex justify-between text-sm font-bold border-y-2 border-foreground/20 py-2">
            <span>Operating Income</span>
            <span className="tabular-nums">{formatPeso(operatingIncome)}</span>
          </div>
          <Section title="Non-Operating / Other" rows={seg.nonOp} total={seg.nonOpTotal} />
          <div className="flex justify-between text-base font-bold border-y-2 border-[var(--accent)] py-3 text-[var(--accent)]">
            <span>Net Income</span>
            <span className="tabular-nums">{formatPeso(data.netIncome)}</span>
          </div>
          <div className="text-xs text-muted-foreground border-t border-border pt-3 space-y-0.5">
            <div className="flex justify-between"><span>Margin (Gross)</span><span className="tabular-nums">
              {data.totalRevenue > 0 ? ((grossProfit / data.totalRevenue) * 100).toFixed(2) : '0.00'}%
            </span></div>
            <div className="flex justify-between"><span>Margin (Operating)</span><span className="tabular-nums">
              {data.totalRevenue > 0 ? ((operatingIncome / data.totalRevenue) * 100).toFixed(2) : '0.00'}%
            </span></div>
            <div className="flex justify-between"><span>Margin (Net)</span><span className="tabular-nums">
              {data.totalRevenue > 0 ? ((data.netIncome / data.totalRevenue) * 100).toFixed(2) : '0.00'}%
            </span></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
