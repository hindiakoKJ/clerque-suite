'use client';

/**
 * LTFRB monthly operator summary.
 *
 * LTFRB does NOT publish a public e-filing API — operators submit a paper
 * monthly report. This page aggregates the data the operator needs to fill
 * the LTFRB template (trips, revenue, routes, days active per vehicle +
 * driver). Owner exports the table to CSV and copies into the template.
 *
 * E-filing integration depends on LTFRB releasing an API; deferred.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Calendar, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';

interface SummaryRow {
  plate:        string;
  vehicle:      string;
  driverId:     string | null;
  driverName:   string;
  tripCount:    number;
  revenue:      number;
  uniqueRoutes: number;
  topRoutes:    string[];
  daysActive:   number;
}

function defaultMonth(): string {
  const now = new Date();
  return now.toISOString().slice(0, 7);
}

export default function LtfrbSummaryPage() {
  const [month, setMonth] = useState(defaultMonth());

  const q = useQuery<SummaryRow[]>({
    queryKey: ['ltfrb-summary', month],
    queryFn: () => api.get('/trucking/reports/ltfrb-monthly', {
      params: { month },
    }).then((r) => r.data),
    staleTime: 30_000,
  });

  const totals = useMemo(() => {
    const list = q.data ?? [];
    return {
      trips:    list.reduce((a, r) => a + r.tripCount, 0),
      revenue:  list.reduce((a, r) => a + r.revenue, 0),
      vehicles: new Set(list.map((r) => r.plate)).size,
      drivers:  new Set(list.map((r) => r.driverId).filter(Boolean) as string[]).size,
    };
  }, [q.data]);

  const exportCsv = () => {
    if (!q.data?.length) return;
    const lines = [
      ['Plate', 'Vehicle', 'Driver', 'Trips', 'Revenue (PHP)', 'Routes', 'Days active', 'Top routes'].join(','),
      ...q.data.map((r) => [
        r.plate, r.vehicle, r.driverName, r.tripCount, r.revenue.toFixed(2),
        r.uniqueRoutes, r.daysActive, `"${r.topRoutes.join(' | ')}"`,
      ].join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ltfrb-monthly-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-purple-600" />
            LTFRB monthly summary
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Per-vehicle + per-driver aggregation for the LTFRB monthly operator
            report. Trips, revenue, routes, days in service. Export to CSV and
            paste into the LTFRB template — there&apos;s no public e-filing API
            (yet).
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={(q.data?.length ?? 0) === 0}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-2 disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </header>

      <div className="flex items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-gray-700">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-2 py-1" />
        </label>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Vehicles" value={String(totals.vehicles)} />
        <Stat label="Drivers"  value={String(totals.drivers)} />
        <Stat label="Trips"    value={String(totals.trips)} />
        <Stat label="Revenue"  value={formatPeso(Math.round(totals.revenue * 100))} />
      </div>

      {q.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (q.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No trips closed in this month.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="text-left p-2">Plate</th>
                <th className="text-left p-2">Vehicle</th>
                <th className="text-left p-2">Driver</th>
                <th className="text-right p-2">Trips</th>
                <th className="text-right p-2">Revenue</th>
                <th className="text-right p-2">Routes</th>
                <th className="text-right p-2">Days active</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((r, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="p-2 font-mono">{r.plate}</td>
                  <td className="p-2 text-xs">{r.vehicle}</td>
                  <td className="p-2 text-xs">{r.driverName}</td>
                  <td className="p-2 text-right font-mono">{r.tripCount}</td>
                  <td className="p-2 text-right font-mono">{formatPeso(Math.round(r.revenue * 100))}</td>
                  <td className="p-2 text-right font-mono">
                    {r.uniqueRoutes}
                    {r.topRoutes.length > 0 ? (
                      <div className="text-[10px] text-gray-500 italic">
                        {r.topRoutes.slice(0, 2).join(', ')}{r.topRoutes.length > 2 ? '…' : ''}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-2 text-right font-mono">{r.daysActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg border bg-white border-gray-200">
      <div className="text-xs uppercase tracking-wide font-bold text-gray-700">{label}</div>
      <div className="text-lg font-extrabold font-mono mt-1">{value}</div>
    </div>
  );
}
