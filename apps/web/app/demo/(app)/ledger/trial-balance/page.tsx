'use client';

/**
 * Demo Ledger — Trial Balance.  Computed live from journal entries.
 * Reflects today's POS sales auto-posted via the demo store.
 */

import { useMemo } from 'react';
import { useDemoStore } from '@/lib/demo/store';

const TYPE_LABELS: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expense',
};

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DemoTrialBalancePage() {
  const accounts = useDemoStore((s) => s.accounts);
  const journalEntries = useDemoStore((s) => s.journalEntries);

  const rows = useMemo(() => {
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
    return accounts.map((a) => {
      const balance = a.normalBalance === 'DEBIT'
        ? totals[a.id].debit - totals[a.id].credit
        : totals[a.id].credit - totals[a.id].debit;
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        debit: a.normalBalance === 'DEBIT' && balance > 0 ? balance : 0,
        credit: a.normalBalance === 'CREDIT' && balance > 0 ? balance : 0,
      };
    }).filter((r) => r.debit > 0 || r.credit > 0);
  }, [accounts, journalEntries]);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Trial Balance</h1>
          <p className="text-sm text-stone-500 dark:text-stone-500">
            As of {new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-stone-500 dark:text-stone-500">Bambu Coffee · TIN 012-345-678-000</p>
          <p className="text-xs text-stone-500 dark:text-stone-500">Demo data — VAT Registered</p>
        </div>
      </div>

      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-stone-50 dark:bg-stone-900/30 border-b border-stone-200 dark:border-stone-800">
            <tr className="text-[10px] uppercase tracking-wide text-stone-600 dark:text-stone-400">
              <th className="text-left px-4 py-2.5 font-semibold w-20">Code</th>
              <th className="text-left px-4 py-2.5 font-semibold">Account</th>
              <th className="text-left px-4 py-2.5 font-semibold hidden sm:table-cell">Type</th>
              <th className="text-right px-4 py-2.5 font-semibold">Debit</th>
              <th className="text-right px-4 py-2.5 font-semibold">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800 text-sm">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-stone-500 dark:text-stone-500">
                  No transactions posted yet. Make a sale on the POS terminal to see the
                  trial balance update.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.accountId} className="hover:bg-stone-50 dark:hover:bg-stone-800/50 dark:bg-stone-900/30">
                  <td className="px-4 py-2 font-mono text-xs text-stone-600 dark:text-stone-400">{r.code}</td>
                  <td className="px-4 py-2 text-stone-900 dark:text-stone-100">{r.name}</td>
                  <td className="px-4 py-2 hidden sm:table-cell text-xs text-stone-500 dark:text-stone-500">
                    {TYPE_LABELS[r.type] ?? r.type}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {r.debit > 0 ? peso(r.debit) : ''}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {r.credit > 0 ? peso(r.credit) : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-stone-50 dark:bg-stone-900/30 border-t-2 border-stone-300 dark:border-stone-700 font-bold">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right text-sm">TOTAL</td>
                <td className="px-4 py-3 text-right">{peso(totalDebit)}</td>
                <td className="px-4 py-3 text-right">{peso(totalCredit)}</td>
              </tr>
              {Math.abs(totalDebit - totalCredit) > 0.01 && (
                <tr className="bg-red-50 text-red-700 text-xs">
                  <td colSpan={5} className="px-4 py-2 text-center">
                    ⚠ Out of balance by {peso(Math.abs(totalDebit - totalCredit))}
                  </td>
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
