'use client';

/**
 * Daily reconciliation — cash collected vs meter-derived sales.
 *
 * For every (branch, day):
 *   meter total       = sum of completed dispenses' totalCents
 *   cash collected    = sum of Order totals where the Order is linked to a dispense
 *   un-rung liters    = meter total minus cash collected
 *
 * Mismatch = the cashier ended a dispense but never rang the sale. Owner
 * uses this for end-of-day cash counting + shift handoff.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt, Calendar, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

interface ReconRow {
  branchId: string;
  date: string;
  dispenseCount: number;
  completedCount: number;
  voidedCount: number;
  meterTotalCents: number;
  cashCollectedCents: number;
  unrungLitersValueCents: number;
}

function lastNDaysYmd(n: number) {
  const to = new Date();
  const from = new Date(to.getTime() - n * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function ReconciliationPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? undefined;
  const defaults = lastNDaysYmd(7);
  const [from, setFrom] = useState(defaults.from);
  const [to,   setTo]   = useState(defaults.to);

  const q = useQuery<ReconRow[]>({
    queryKey: ['fuel-reconciliation', from, to, branchId],
    queryFn: () => api.get('/fuel/reports/daily-reconciliation', {
      params: { from, to, ...(branchId ? { branchId } : {}) },
    }).then((r) => r.data),
    staleTime: 30_000,
  });

  const totals = (q.data ?? []).reduce(
    (a, r) => ({
      meter: a.meter + r.meterTotalCents,
      cash:  a.cash  + r.cashCollectedCents,
      unrung: a.unrung + r.unrungLitersValueCents,
    }),
    { meter: 0, cash: 0, unrung: 0 },
  );

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="w-6 h-6 text-purple-600" />
          Daily fuel reconciliation
        </h1>
        <p className="text-sm text-gray-600 mt-1 max-w-2xl">
          Cash collected at the till vs meter-derived sales from completed
          dispenses. Mismatch flags a dispense that finished pumping but never
          got rung up — chase the cashier before the shift closes.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-gray-700">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-700">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" />
        </label>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Days" value={String(q.data?.length ?? 0)} />
        <Stat label="Meter total" value={formatPeso(totals.meter)} />
        <Stat label="Cash collected" value={formatPeso(totals.cash)} />
        <Stat label="Un-rung" value={formatPeso(totals.unrung)} tone={totals.unrung > 0 ? 'warning' : 'default'} />
      </div>

      {q.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (q.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No dispenses in this window.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="text-left p-2">Date</th>
                <th className="text-right p-2">Dispenses</th>
                <th className="text-right p-2">Completed</th>
                <th className="text-right p-2">Voided</th>
                <th className="text-right p-2">Meter total</th>
                <th className="text-right p-2">Cash collected</th>
                <th className="text-right p-2 bg-purple-50">Un-rung</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((r, i) => {
                const unrung = r.unrungLitersValueCents > 0;
                return (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="p-2 text-xs">{new Date(r.date + 'T00:00:00').toLocaleDateString()}</td>
                    <td className="p-2 text-right font-mono">{r.dispenseCount}</td>
                    <td className="p-2 text-right font-mono text-green-700">{r.completedCount}</td>
                    <td className="p-2 text-right font-mono text-red-700">{r.voidedCount > 0 ? r.voidedCount : '—'}</td>
                    <td className="p-2 text-right font-mono">{formatPeso(r.meterTotalCents)}</td>
                    <td className="p-2 text-right font-mono">{formatPeso(r.cashCollectedCents)}</td>
                    <td className={`p-2 text-right font-mono font-bold ${unrung ? 'bg-amber-50 text-amber-800' : 'text-gray-400'}`}>
                      {unrung ? formatPeso(r.unrungLitersValueCents) : '—'}
                      {unrung ? <AlertTriangle className="w-3 h-3 inline ml-1" /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'default' }) {
  return (
    <div className={`p-3 rounded-lg border ${tone === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
      <div className="text-xs uppercase tracking-wide font-bold text-gray-700">{label}</div>
      <div className="text-lg font-extrabold font-mono mt-1">{value}</div>
    </div>
  );
}
