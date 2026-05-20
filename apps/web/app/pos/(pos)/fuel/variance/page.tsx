'use client';

/**
 * Tank-dip variance report.
 *
 *   expected_evening = morning_dip + deliveries − meter_sold
 *   variance         = actual_evening − expected_evening
 *
 * Positive variance = phantom liters (over-dipping or stolen sale not rung).
 * Negative variance = shrinkage (leak / theft / measurement drift).
 * Anything beyond ±1% of opening volume is worth investigating.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Calendar, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface VarianceRow {
  branchId: string;
  fuelGrade: string;
  date: string;
  morningLiters:   number | string | null;
  eveningLiters:   number | string | null;
  deliveryLiters:  number | string;
  soldLiters:      number | string;
  expectedEvening: number | string | null;
  varianceLiters:  number | string | null;
}

function lastNDaysYmd(n: number) {
  const to = new Date();
  const from = new Date(to.getTime() - n * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function TankVariancePage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? undefined;
  const defaults = lastNDaysYmd(7);
  const [from, setFrom] = useState(defaults.from);
  const [to,   setTo]   = useState(defaults.to);

  const q = useQuery<VarianceRow[]>({
    queryKey: ['fuel-variance', from, to, branchId],
    queryFn: () => api.get('/fuel/reports/tank-variance', {
      params: { from, to, ...(branchId ? { branchId } : {}) },
    }).then((r) => r.data),
    staleTime: 30_000,
  });

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="w-6 h-6 text-purple-600" />
          Tank variance report
        </h1>
        <p className="text-sm text-gray-600 mt-1 max-w-2xl">
          Per-day, per-grade comparison of expected vs actual closing tank levels.
          Expected = morning dip + deliveries − meter-derived sales. Variance flags
          phantom liters (theft, un-rung sales) or shrinkage (leaks, measurement).
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

      {q.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (q.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No data in this window. Record morning + evening tank dips on{' '}
          <a href="/pos/fuel/tank-dips" className="text-purple-600 underline">Tank dips</a> first.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Grade</th>
                <th className="text-right p-2">Morning dip</th>
                <th className="text-right p-2">+ Deliveries</th>
                <th className="text-right p-2">− Meter sales</th>
                <th className="text-right p-2">= Expected eve</th>
                <th className="text-right p-2">Actual eve</th>
                <th className="text-right p-2 bg-purple-50">Variance</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((r, i) => {
                const variance = r.varianceLiters != null ? Number(r.varianceLiters) : null;
                const abs = variance != null ? Math.abs(variance) : 0;
                const sev = abs > 50 ? 'severe' : abs > 10 ? 'medium' : 'ok';
                return (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="p-2 text-xs">{new Date(r.date + 'T00:00:00').toLocaleDateString()}</td>
                    <td className="p-2 font-bold text-xs">{r.fuelGrade}</td>
                    <td className="p-2 text-right font-mono text-xs">
                      {r.morningLiters != null ? Number(r.morningLiters).toFixed(3) : '—'}
                    </td>
                    <td className="p-2 text-right font-mono text-xs text-blue-700">
                      {Number(r.deliveryLiters) > 0 ? '+' + Number(r.deliveryLiters).toFixed(3) : '—'}
                    </td>
                    <td className="p-2 text-right font-mono text-xs text-amber-700">
                      −{Number(r.soldLiters).toFixed(3)}
                    </td>
                    <td className="p-2 text-right font-mono text-xs">
                      {r.expectedEvening != null ? Number(r.expectedEvening).toFixed(3) : '—'}
                    </td>
                    <td className="p-2 text-right font-mono text-xs">
                      {r.eveningLiters != null ? Number(r.eveningLiters).toFixed(3) : '—'}
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${
                      sev === 'severe' ? 'bg-red-50 text-red-800' :
                      sev === 'medium' ? 'bg-amber-50 text-amber-800' :
                                         'bg-green-50 text-green-800'
                    }`}>
                      {variance == null ? '—' : (variance >= 0 ? '+' : '') + variance.toFixed(3) + ' L'}
                      {sev === 'severe' ? <AlertTriangle className="w-3 h-3 inline ml-1" /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500 max-w-2xl">
        <p className="mb-2"><b>How to read this:</b></p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Variance within ±10 L → measurement noise, fine.</li>
          <li>Variance −10 to −50 L → small shrinkage. Watch for a few days; if persistent, check pumps for leaks.</li>
          <li>Variance &gt; 50 L either way → investigate immediately. Could be un-rung sale, fuel theft, or a misread dip.</li>
        </ul>
      </div>
    </div>
  );
}
