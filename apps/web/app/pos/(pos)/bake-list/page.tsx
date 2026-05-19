'use client';

/**
 * Clerque Cloud — Bake list (Production plan)
 *
 * Bakery dashboard widget: shows the recommended bake quantity per product
 * for a target date. The recommendation is:
 *
 *   max(7-day rolling sales average, confirmed pre-orders on the date)
 *
 * So the baker never under-bakes a promised cake and never falls short of
 * a typical day's pandesal run. They can hit Print to send the list to the
 * thermal printer as an 80mm production slip.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChefHat, Calendar, Printer, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface BakeRow {
  productId:        string;
  productName:      string;
  averageDaily:     number;
  preOrderQuantity: number;
  recommendedQty:   number;
}

function tomorrowYmdPh(): string {
  const off = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + off + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function todayYmdPh(): string {
  const off = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + off).toISOString().slice(0, 10);
}

export default function BakeListPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';
  const [date, setDate] = useState(tomorrowYmdPh());

  const q = useQuery<BakeRow[]>({
    queryKey: ['bake-list', branchId, date],
    enabled:  !!branchId,
    queryFn:  () => api.get('/reports/bake-list', {
      params: { branchId, date },
    }).then((r) => r.data),
    staleTime: 60_000,
  });

  const totalUnits = useMemo(
    () => (q.data ?? []).reduce((acc, r) => acc + r.recommendedQty, 0),
    [q.data],
  );

  const handlePrint = () => {
    window.print();
  };

  const isTomorrow = date === tomorrowYmdPh();
  const isToday    = date === todayYmdPh();

  return (
    <div className="max-w-4xl mx-auto p-4 lg:p-8">
      <header className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-purple-600" />
            Bake list
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Recommended production quantities for the target date. Takes the
            larger of your 7-day rolling sales average or confirmed pre-orders.
            The baker can hit <b>Print</b> to send the list to the thermal printer.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => q.refetch()}
            className="text-sm border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={handlePrint}
            disabled={(q.data?.length ?? 0) === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-1.5 rounded font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </header>

      {/* Date picker */}
      <div className="flex flex-wrap items-center gap-3 mb-4 print:hidden">
        <label className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-gray-700">Bake for</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </label>
        <button
          onClick={() => setDate(todayYmdPh())}
          className={`text-xs rounded px-2.5 py-1 border ${isToday ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
        >
          Today
        </button>
        <button
          onClick={() => setDate(tomorrowYmdPh())}
          className={`text-xs rounded px-2.5 py-1 border ${isTomorrow ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
        >
          Tomorrow
        </button>
      </div>

      {/* Print header (shown only on print) */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold">Bake list — {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
        <div className="text-sm text-gray-600 mt-1">
          {totalUnits} units across {q.data?.length ?? 0} products · printed {new Date().toLocaleString()}
        </div>
      </div>

      {/* Table */}
      {q.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (q.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          Nothing to bake yet. Once you ring a few days of sales (or take some
          pre-orders for this date), the recommendation engine kicks in.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
              <tr>
                <th className="text-left p-3">Product</th>
                <th className="text-right p-3">7-day avg / day</th>
                <th className="text-right p-3">Pre-orders</th>
                <th className="text-right p-3 bg-purple-50 text-purple-900">Bake</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((r) => (
                <tr key={r.productId} className="border-b border-gray-100 last:border-b-0">
                  <td className="p-3 font-medium">{r.productName}</td>
                  <td className="p-3 text-right font-mono text-gray-700">{r.averageDaily}</td>
                  <td className="p-3 text-right font-mono text-gray-700">
                    {r.preOrderQuantity > 0 ? r.preOrderQuantity : '—'}
                  </td>
                  <td className="p-3 text-right font-mono font-extrabold text-lg bg-purple-50 text-purple-900">
                    {r.recommendedQty}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50">
                <td className="p-3 font-bold uppercase text-xs tracking-wider text-gray-700">Total</td>
                <td colSpan={2}></td>
                <td className="p-3 text-right font-mono font-extrabold text-lg bg-purple-100 text-purple-900">
                  {totalUnits}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500 mt-4 print:hidden">
        Tip: bake a little extra on slow days to keep the display case looking
        stocked. If you regularly oversell or undersell, adjust by eye over a
        couple of weeks — the 7-day window absorbs the change automatically.
      </p>
    </div>
  );
}
