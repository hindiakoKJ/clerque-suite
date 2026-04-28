'use client';

/**
 * Demo Ledger — Chart of Accounts.  Shows the 30 sample accounts that
 * power the demo.  Disclaimer banner notes that the real subscription
 * includes the full 186-account BIR-compliant set.
 */

import { useMemo } from 'react';
import { useDemoStore } from '@/lib/demo/store';
import { Info } from 'lucide-react';
import {
  DEMO_FULL_COA_COUNT,
  DEMO_VISIBLE_COA_COUNT,
} from '@/lib/demo/seed';

const TYPE_COLORS: Record<string, string> = {
  ASSET: 'bg-blue-100 text-blue-700',
  LIABILITY: 'bg-amber-100 text-amber-700',
  EQUITY: 'bg-purple-100 text-purple-700',
  REVENUE: 'bg-emerald-100 text-emerald-700',
  EXPENSE: 'bg-rose-100 text-rose-700',
};

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DemoCoaPage() {
  const accounts = useDemoStore((s) => s.accounts);
  const journalEntries = useDemoStore((s) => s.journalEntries);

  // Compute running balances per account from journal entries
  const balances = useMemo(() => {
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
    const result: Record<string, number> = {};
    for (const a of accounts) {
      const t = totals[a.id];
      result[a.id] = a.normalBalance === 'DEBIT' ? t.debit - t.credit : t.credit - t.debit;
    }
    return result;
  }, [accounts, journalEntries]);

  // Group by type
  const groups = useMemo(() => {
    const order = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
    return order.map((type) => ({
      type,
      accounts: accounts.filter((a) => a.type === type),
    }));
  }, [accounts]);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Chart of Accounts</h1>
        <p className="text-sm text-stone-500">
          The accounts where every transaction posts.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
        <Info className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-amber-900">
            Showing {DEMO_VISIBLE_COA_COUNT} of {DEMO_FULL_COA_COUNT} accounts
          </p>
          <p className="text-amber-800 mt-0.5 leading-relaxed">
            The full Philippine BIR-compliant Chart of Accounts (186 accounts including SSS,
            PhilHealth, Pag-IBIG, EWT, CWT, and audit trail accounts) ships with every paid plan.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.type} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${TYPE_COLORS[group.type]}`}>
                  {group.type}
                </span>
                <span className="text-xs text-stone-500">
                  {group.accounts.length} account(s)
                </span>
              </div>
            </div>
            <table className="w-full">
              <thead className="text-[10px] uppercase text-stone-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold w-20">Code</th>
                  <th className="text-left px-4 py-2 font-semibold">Account Name</th>
                  <th className="text-center px-4 py-2 font-semibold hidden sm:table-cell">Normal Bal</th>
                  <th className="text-right px-4 py-2 font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-sm">
                {group.accounts.map((a) => {
                  const balance = balances[a.id] ?? 0;
                  return (
                    <tr key={a.id} className="hover:bg-stone-50">
                      <td className="px-4 py-2 font-mono text-xs text-stone-600">{a.code}</td>
                      <td className="px-4 py-2 text-stone-900">{a.name}</td>
                      <td className="px-4 py-2 text-center hidden sm:table-cell text-xs text-stone-500">
                        {a.normalBalance}
                      </td>
                      <td className={`px-4 py-2 text-right font-medium ${balance > 0 ? 'text-stone-900' : 'text-stone-400'}`}>
                        {peso(balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
