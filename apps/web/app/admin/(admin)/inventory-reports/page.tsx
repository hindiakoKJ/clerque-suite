'use client';

/**
 * Sprint 25 — Inventory reports (advancedReports plan feature).
 * Three sections backed by /inventory-reports/{variance,margin,depletion-forecast}:
 *   1. Variance — expected vs actual raw-material qty
 *   2. Per-product margin — revenue, COGS, gross margin %
 *   3. Depletion forecast — days until stockout for lot-tracked materials
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, TrendingDown, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';

interface Branch { id: string; name: string }

interface VarianceRow {
  rawMaterialId: string;
  name:          string;
  unit:          string;
  startingQty:   number;
  receiptsQty:   number;
  expectedConsumption: number;
  expectedEndingQty:   number;
  actualEndingQty:     number;
  deltaQty:            number;
  deltaPct:            number | null;
}
interface MarginRow {
  productId:   string;
  productName: string;
  qtySold:     number;
  revenue:     number;
  cogs:        number;
  grossMargin: number;
  marginPct:   number | null;
}
interface DepletionRow {
  rawMaterialId: string;
  name:          string;
  unit:          string;
  currentStock:  number;
  avgDailyConsumption: number;
  daysUntilStockout:   number | null;
}

function fmt(n: number, frac = 2) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

export default function InventoryReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo]     = useState(today);

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get<Branch[]>('/tenant/branches').then((r) => r.data).catch(() => []),
  });

  const enabled = !!branchId;
  const { data: variance } = useQuery<VarianceRow[]>({
    queryKey: ['inv-variance', branchId, from, to],
    queryFn:  () => api.get<VarianceRow[]>(`/inventory-reports/variance?branchId=${branchId}&from=${from}&to=${to}`).then((r) => r.data),
    enabled,
  });
  const { data: margin } = useQuery<MarginRow[]>({
    queryKey: ['inv-margin', from, to],
    queryFn:  () => api.get<MarginRow[]>(`/inventory-reports/margin?from=${from}&to=${to}`).then((r) => r.data),
  });
  const { data: depletion } = useQuery<DepletionRow[]>({
    queryKey: ['inv-depletion', branchId],
    queryFn:  () => api.get<DepletionRow[]>(`/inventory-reports/depletion-forecast?branchId=${branchId}`).then((r) => r.data),
    enabled,
  });

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Inventory Reports</h1>

      <div className="rounded-lg border bg-white p-4 grid grid-cols-3 gap-4">
        <div>
          <label className="text-sm font-medium">Branch</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-sm font-medium">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Variance */}
      <section className="rounded-lg border bg-white p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <Activity className="h-5 w-5" /> Raw Material Variance
        </h2>
        {!enabled ? <p className="text-sm text-slate-500">Pick a branch to load variance.</p> : !variance ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Material</th>
                <th className="py-2">Starting</th>
                <th className="py-2">Receipts</th>
                <th className="py-2">Expected Use</th>
                <th className="py-2">Expected End</th>
                <th className="py-2">Actual End</th>
                <th className="py-2">Δ Qty</th>
                <th className="py-2">Δ %</th>
              </tr>
            </thead>
            <tbody>
              {variance.map((v) => (
                <tr key={v.rawMaterialId} className="border-t">
                  <td className="py-2">{v.name} <span className="text-xs text-slate-400">({v.unit})</span></td>
                  <td className="py-2">{fmt(v.startingQty, 4)}</td>
                  <td className="py-2">{fmt(v.receiptsQty, 4)}</td>
                  <td className="py-2">{fmt(v.expectedConsumption, 4)}</td>
                  <td className="py-2">{fmt(v.expectedEndingQty, 4)}</td>
                  <td className="py-2">{fmt(v.actualEndingQty, 4)}</td>
                  <td className={`py-2 ${v.deltaQty < 0 ? 'text-red-600' : v.deltaQty > 0 ? 'text-emerald-600' : ''}`}>
                    {fmt(v.deltaQty, 4)}
                  </td>
                  <td className="py-2">{v.deltaPct != null ? `${fmt(v.deltaPct)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Margin */}
      <section className="rounded-lg border bg-white p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <BarChart3 className="h-5 w-5" /> Product Margin
        </h2>
        {!margin ? <p className="text-sm text-slate-500">Loading…</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Product</th>
                <th className="py-2">Qty Sold</th>
                <th className="py-2">Revenue</th>
                <th className="py-2">COGS</th>
                <th className="py-2">Gross Margin</th>
                <th className="py-2">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {margin.map((m) => (
                <tr key={m.productId} className="border-t">
                  <td className="py-2">{m.productName}</td>
                  <td className="py-2">{fmt(m.qtySold, 2)}</td>
                  <td className="py-2">₱{fmt(m.revenue)}</td>
                  <td className="py-2">₱{fmt(m.cogs)}</td>
                  <td className={`py-2 ${m.grossMargin < 0 ? 'text-red-600' : ''}`}>₱{fmt(m.grossMargin)}</td>
                  <td className="py-2">{m.marginPct != null ? `${fmt(m.marginPct)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Depletion */}
      <section className="rounded-lg border bg-white p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <TrendingDown className="h-5 w-5" /> Depletion Forecast (30-day avg)
        </h2>
        {!enabled ? <p className="text-sm text-slate-500">Pick a branch to load forecast.</p> : !depletion ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Material</th>
                <th className="py-2">Current Stock</th>
                <th className="py-2">Avg / Day</th>
                <th className="py-2">Days Until Stockout</th>
              </tr>
            </thead>
            <tbody>
              {depletion.map((d) => (
                <tr key={d.rawMaterialId} className="border-t">
                  <td className="py-2">{d.name} <span className="text-xs text-slate-400">({d.unit})</span></td>
                  <td className="py-2">{fmt(d.currentStock, 4)}</td>
                  <td className="py-2">{fmt(d.avgDailyConsumption, 4)}</td>
                  <td className={`py-2 font-medium ${d.daysUntilStockout != null && d.daysUntilStockout < 7 ? 'text-red-600' : d.daysUntilStockout != null && d.daysUntilStockout < 14 ? 'text-amber-600' : ''}`}>
                    {d.daysUntilStockout != null ? `${fmt(d.daysUntilStockout, 1)} days` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
