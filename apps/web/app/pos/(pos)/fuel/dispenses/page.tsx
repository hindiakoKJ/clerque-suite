'use client';

/**
 * Clerque Cloud — Fuel Dispense Log
 *
 * Read-only ledger of every fuel dispense ever rung. Filterable by date
 * range, branch, and status. Used by the owner for daily reconciliation
 * + audit trail vs the cashier's Z-read.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

interface Dispense {
  id: string;
  status: 'OPEN' | 'COMPLETED' | 'VOIDED';
  openingMeter: number | string;
  closingMeter: number | string | null;
  litersDispensed: number | string | null;
  pricePerLiter: number | string;
  totalCents: number | null;
  startedAt: string;
  endedAt: string | null;
  voidReason: string | null;
  pump: { id: string; label: string; product: { id: string; name: string } };
  attendant: { id: string; name: string };
}

function todayYmd(): string {
  const off = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + off).toISOString().slice(0, 10);
}

export default function FuelDispensesPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? undefined;
  const [from, setFrom] = useState(todayYmd());
  const [to,   setTo]   = useState(todayYmd());

  const q = useQuery<Dispense[]>({
    queryKey: ['fuel-dispenses', from, to, branchId],
    queryFn: () => api.get('/fuel/dispenses', {
      params: { from, to, ...(branchId ? { branchId } : {}) },
    }).then((r) => r.data),
    staleTime: 30_000,
  });

  const total = (q.data ?? []).reduce((a, d) => a + (d.totalCents ?? 0), 0);
  const liters = (q.data ?? []).reduce((a, d) => a + (Number(d.litersDispensed) || 0), 0);

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-purple-600" />
          Fuel dispense log
        </h1>
        <p className="text-sm text-gray-600 mt-1 max-w-2xl">
          Audit trail of every pump dispense. Cross-check against your daily Z-read.
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded p-3">
          <div className="text-xs uppercase tracking-wide font-bold text-gray-700">Dispenses</div>
          <div className="text-xl font-extrabold font-mono mt-1">{q.data?.length ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded p-3">
          <div className="text-xs uppercase tracking-wide font-bold text-gray-700">Liters</div>
          <div className="text-xl font-extrabold font-mono mt-1">{liters.toFixed(3)} L</div>
        </div>
        <div className="bg-white border border-gray-200 rounded p-3">
          <div className="text-xs uppercase tracking-wide font-bold text-gray-700">Revenue</div>
          <div className="text-xl font-extrabold font-mono mt-1">{formatPeso(total)}</div>
        </div>
      </div>

      {q.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (q.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No dispenses in this date window.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="text-left p-2">Started</th>
                <th className="text-left p-2">Pump · Fuel</th>
                <th className="text-left p-2">Attendant</th>
                <th className="text-right p-2">Opening</th>
                <th className="text-right p-2">Closing</th>
                <th className="text-right p-2">Liters</th>
                <th className="text-right p-2">Price/L</th>
                <th className="text-right p-2">Total</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="p-2 text-xs">{new Date(d.startedAt).toLocaleString()}</td>
                  <td className="p-2">{d.pump.label} <span className="text-xs text-gray-500">· {d.pump.product.name}</span></td>
                  <td className="p-2 text-xs">{d.attendant.name}</td>
                  <td className="p-2 text-right font-mono text-xs">{Number(d.openingMeter).toFixed(3)}</td>
                  <td className="p-2 text-right font-mono text-xs">{d.closingMeter != null ? Number(d.closingMeter).toFixed(3) : '—'}</td>
                  <td className="p-2 text-right font-mono">{d.litersDispensed != null ? Number(d.litersDispensed).toFixed(3) + ' L' : '—'}</td>
                  <td className="p-2 text-right font-mono">{formatPeso(Math.round(Number(d.pricePerLiter) * 100))}</td>
                  <td className="p-2 text-right font-mono font-bold">{d.totalCents != null ? formatPeso(d.totalCents) : '—'}</td>
                  <td className="p-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                      d.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                      d.status === 'OPEN'      ? 'bg-amber-100 text-amber-800' :
                                                 'bg-red-100 text-red-800'
                    }`}>{d.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
