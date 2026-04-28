'use client';

/**
 * Demo POS — Inventory.  Read-only view of current stock levels with
 * low-stock highlighting.  No adjustment UI in demo (kept simple).
 */

import { useDemoStore } from '@/lib/demo/store';
import { AlertTriangle } from 'lucide-react';

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DemoInventoryPage() {
  const products = useDemoStore((s) => s.products);

  const lowStock = products.filter((p) => p.inventoryQty <= p.lowStockAlert);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Inventory</h1>
        <p className="text-sm text-stone-500">
          Current stock levels for all active products at Bambu Main Branch.
        </p>
      </div>

      {lowStock.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900">
              {lowStock.length} product{lowStock.length !== 1 ? 's' : ''} below low-stock threshold
            </p>
            <p className="text-sm text-amber-800 mt-0.5">
              Items: {lowStock.slice(0, 5).map((p) => p.name).join(', ')}
              {lowStock.length > 5 && ` and ${lowStock.length - 5} more`}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 uppercase tracking-wide">
                Product
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 uppercase tracking-wide">
                Category
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-stone-600 uppercase tracking-wide">
                Price
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-stone-600 uppercase tracking-wide">
                Stock
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-stone-600 uppercase tracking-wide hidden sm:table-cell">
                Low-stock alert
              </th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-stone-600 uppercase tracking-wide">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {products.map((p) => {
              const isLow = p.inventoryQty <= p.lowStockAlert;
              return (
                <tr key={p.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-900">{p.name}</p>
                    <p className="text-xs text-stone-500 font-mono">{p.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-stone-600">{p.categoryName}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-stone-900">
                    {peso(p.price)}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${isLow ? 'text-red-600' : 'text-stone-900'}`}>
                    {p.inventoryQty}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-stone-500 hidden sm:table-cell">
                    {p.lowStockAlert}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isLow ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-red-100 text-red-700">
                        Low
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-emerald-100 text-emerald-700">
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
