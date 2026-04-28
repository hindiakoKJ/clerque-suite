'use client';

/**
 * Demo POS — Products catalog.  Read-only product list grouped by
 * category.  Shows the full set of items the demo business sells.
 */

import { useMemo } from 'react';
import { useDemoStore } from '@/lib/demo/store';

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DemoProductsPage() {
  const products = useDemoStore((s) => s.products);

  const grouped = useMemo(() => {
    const map = new Map<string, { categoryName: string; items: typeof products }>();
    for (const p of products) {
      if (!map.has(p.categoryId)) {
        map.set(p.categoryId, { categoryName: p.categoryName, items: [] });
      }
      map.get(p.categoryId)!.items.push(p);
    }
    return Array.from(map.values());
  }, [products]);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Products</h1>
        <p className="text-sm text-stone-500 dark:text-stone-500">
          The catalog Bambu Coffee sells. {products.length} active items across {grouped.length} categories.
        </p>
      </div>

      {grouped.map((group) => (
        <div key={group.categoryName} className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-stone-50 dark:bg-stone-900/30 border-b border-stone-200 dark:border-stone-800">
            <h2 className="font-semibold text-stone-900 dark:text-stone-100">{group.categoryName}</h2>
            <p className="text-xs text-stone-500 dark:text-stone-500">{group.items.length} item(s)</p>
          </div>
          <table className="w-full">
            <thead className="bg-stone-50/50 dark:bg-stone-900/40 border-b border-stone-100 dark:border-stone-800 text-[11px]">
              <tr className="text-stone-500 dark:text-stone-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-semibold">Name</th>
                <th className="text-left px-4 py-2 font-semibold hidden sm:table-cell">SKU</th>
                <th className="text-left px-4 py-2 font-semibold hidden md:table-cell">Barcode</th>
                <th className="text-right px-4 py-2 font-semibold">Sell price</th>
                <th className="text-right px-4 py-2 font-semibold hidden lg:table-cell">Cost</th>
                <th className="text-center px-4 py-2 font-semibold">VAT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {group.items.map((p) => (
                <tr key={p.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/50 dark:bg-stone-900/30">
                  <td className="px-4 py-2.5 font-medium text-stone-900 dark:text-stone-100">{p.name}</td>
                  <td className="px-4 py-2.5 text-stone-600 dark:text-stone-400 font-mono text-xs hidden sm:table-cell">{p.sku}</td>
                  <td className="px-4 py-2.5 text-stone-600 dark:text-stone-400 font-mono text-xs hidden md:table-cell">
                    {p.barcode ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-stone-900 dark:text-stone-100">
                    {peso(p.price)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-stone-600 dark:text-stone-400 hidden lg:table-cell">
                    {peso(p.costPrice)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {p.isVatable ? (
                      <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-100 text-blue-700">
                        12%
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400">
                        Exempt
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
