'use client';

/**
 * Demo Ledger — Dashboard.  Financial snapshot computed from journal
 * entries: net income, cash on hand, AR aging summary.
 */

import { useMemo } from 'react';
import { useDemoStore } from '@/lib/demo/store';
import { TrendingUp, Wallet, Clock, FileText } from 'lucide-react';

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DemoLedgerDashboard() {
  const accounts = useDemoStore((s) => s.accounts);
  const journalEntries = useDemoStore((s) => s.journalEntries);
  const orders = useDemoStore((s) => s.orders);

  const stats = useMemo(() => {
    const totals: Record<string, { debit: number; credit: number }> = {};
    for (const a of accounts) totals[a.id] = { debit: 0, credit: 0 };
    for (const je of journalEntries) {
      if (je.status !== 'POSTED') continue;
      for (const line of je.lines) {
        if (totals[line.accountId]) {
          totals[line.accountId].debit += line.debit;
          totals[line.accountId].credit += line.credit;
        }
      }
    }
    const balanceOf = (id: string) => {
      const a = accounts.find((x) => x.id === id);
      if (!a) return 0;
      const t = totals[id] ?? { debit: 0, credit: 0 };
      return a.normalBalance === 'DEBIT' ? t.debit - t.credit : t.credit - t.debit;
    };

    const cashOnHand = balanceOf('acc-1010') + balanceOf('acc-1020') + balanceOf('acc-1031');
    const accountsReceivable = balanceOf('acc-1030');
    const totalRevenue = accounts
      .filter((a) => a.type === 'REVENUE')
      .reduce((s, a) => s + balanceOf(a.id), 0);
    const totalExpense = accounts
      .filter((a) => a.type === 'EXPENSE')
      .reduce((s, a) => s + balanceOf(a.id), 0);
    const netIncome = totalRevenue - totalExpense;

    // AR aging summary
    const today = new Date();
    const arOrders = orders.filter(
      (o) => o.invoiceType === 'CHARGE' && o.amountDue > 0 && o.status === 'COMPLETED',
    );
    const arBuckets = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0 };
    for (const o of arOrders) {
      const due = o.dueDate ? new Date(o.dueDate) : new Date(o.createdAt);
      const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
      if (days <= 0) arBuckets.current += o.amountDue;
      else if (days <= 30) arBuckets.b30 += o.amountDue;
      else if (days <= 60) arBuckets.b60 += o.amountDue;
      else if (days <= 90) arBuckets.b90 += o.amountDue;
      else arBuckets.b90plus += o.amountDue;
    }

    const recentEntries = [...journalEntries]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);

    return {
      cashOnHand,
      accountsReceivable,
      totalRevenue,
      totalExpense,
      netIncome,
      arBuckets,
      arOrderCount: arOrders.length,
      recentEntries,
    };
  }, [accounts, journalEntries, orders]);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Ledger Dashboard</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Financial snapshot — recomputed live as transactions post.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          icon={Wallet}
          label="Cash on Hand"
          value={peso(stats.cashOnHand)}
          sub="Cash + Bank + Digital"
          accent="emerald"
        />
        <Stat
          icon={Clock}
          label="Accounts Receivable"
          value={peso(stats.accountsReceivable)}
          sub={`${stats.arOrderCount} unpaid invoice(s)`}
          accent="amber"
        />
        <Stat
          icon={TrendingUp}
          label="Net Income"
          value={peso(stats.netIncome)}
          sub={`Revenue ${peso(stats.totalRevenue)}`}
          accent={stats.netIncome >= 0 ? 'blue' : 'rose'}
        />
        <Stat
          icon={FileText}
          label="Journal Entries"
          value={String(stats.recentEntries.length > 0 ? journalEntries.length : 0)}
          sub="All-time, posted"
          accent="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">AR Aging</h2>
          <div className="space-y-2 text-sm">
            <AgingRow label="Current (not yet due)" value={stats.arBuckets.current} accent="emerald" />
            <AgingRow label="1 — 30 days overdue" value={stats.arBuckets.b30} accent="amber" />
            <AgingRow label="31 — 60 days overdue" value={stats.arBuckets.b60} accent="orange" />
            <AgingRow label="61 — 90 days overdue" value={stats.arBuckets.b90} accent="rose" />
            <AgingRow label="Over 90 days" value={stats.arBuckets.b90plus} accent="red" />
            <div className="border-t border-stone-200 dark:border-stone-800 pt-2 mt-2 flex justify-between font-bold">
              <span>Total</span>
              <span>{peso(stats.accountsReceivable)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">Recent Entries</h2>
          {stats.recentEntries.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400 py-4 text-center">
              No entries yet.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800 text-sm">
              {stats.recentEntries.map((je) => (
                <li key={je.id} className="py-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-stone-900 dark:text-stone-100 truncate">{je.description}</p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {je.entryNumber} · {new Date(je.date).toLocaleDateString('en-PH')}
                      {je.source === 'SYSTEM' ? ' · Auto' : ' · Manual'}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {peso(je.totalDebit)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: 'emerald' | 'blue' | 'purple' | 'amber' | 'rose';
}) {
  const accentMap = {
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
    purple: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
    rose: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30',
  };
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg mb-3 ${accentMap[accent]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</p>
      <p className="text-xl font-bold text-stone-900 dark:text-stone-100 mt-0.5">{value}</p>
      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{sub}</p>
    </div>
  );
}

function AgingRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: 'emerald' | 'amber' | 'orange' | 'rose' | 'red';
}) {
  const dotMap = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    orange: 'bg-orange-500',
    rose: 'bg-rose-500',
    red: 'bg-red-600',
  };
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotMap[accent]}`} />
        <span className="text-stone-700 dark:text-stone-300">{label}</span>
      </div>
      <span className="font-semibold text-stone-900 dark:text-stone-100">{peso(value)}</span>
    </div>
  );
}
