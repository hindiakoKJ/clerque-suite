'use client';

/**
 * Demo POS — Dashboard.  Today's KPIs computed live from the demo store.
 */

import { useMemo } from 'react';
import { useDemoStore } from '@/lib/demo/store';
import { ShoppingCart, TrendingUp, Ban, CreditCard } from 'lucide-react';

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  GCASH_PERSONAL: 'GCash Personal',
  GCASH_BUSINESS: 'GCash Business',
  MAYA_PERSONAL: 'Maya Personal',
  MAYA_BUSINESS: 'Maya Business',
  QR_PH: 'QR Ph',
  CHARGE: 'Charge (B2B)',
};

export default function DemoPosDashboard() {
  const orders = useDemoStore((s) => s.orders);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter(
      (o) => new Date(o.createdAt) >= today && o.status === 'COMPLETED',
    );
    const voided = orders.filter(
      (o) => new Date(o.createdAt) >= today && o.status === 'VOIDED',
    );
    const totalRevenue = todayOrders.reduce((s, o) => s + o.totalAmount, 0);
    const cashRevenue = todayOrders
      .flatMap((o) => o.payments)
      .filter((p) => p.method === 'CASH')
      .reduce((s, p) => s + p.amount, 0);

    // Per-method totals
    const methodMap: Record<string, { method: string; total: number; count: number }> = {};
    for (const o of todayOrders) {
      for (const p of o.payments) {
        if (!methodMap[p.method]) methodMap[p.method] = { method: p.method, total: 0, count: 0 };
        methodMap[p.method].total += p.amount;
        methodMap[p.method].count += 1;
      }
    }
    const byMethod = Object.values(methodMap).sort((a, b) => b.total - a.total);

    // Top products
    const productAgg: Record<string, { id: string; name: string; qty: number; revenue: number }> = {};
    for (const o of todayOrders) {
      for (const item of o.items) {
        if (!productAgg[item.productId]) {
          productAgg[item.productId] = { id: item.productId, name: item.productName, qty: 0, revenue: 0 };
        }
        productAgg[item.productId].qty += item.quantity;
        productAgg[item.productId].revenue += item.lineTotal;
      }
    }
    const topProducts = Object.values(productAgg)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      totalOrders: todayOrders.length,
      totalRevenue,
      cashRevenue,
      nonCashRevenue: Math.max(0, totalRevenue - cashRevenue),
      avgOrderValue: todayOrders.length > 0 ? totalRevenue / todayOrders.length : 0,
      voidCount: voided.length,
      byMethod,
      topProducts,
    };
  }, [orders]);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Sales Dashboard</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Today, {new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          icon={TrendingUp}
          label="Total Revenue"
          value={peso(stats.totalRevenue)}
          sub={`${stats.totalOrders} orders`}
          accent="emerald"
        />
        <Stat
          icon={CreditCard}
          label="Avg Order Value"
          value={peso(stats.avgOrderValue)}
          sub={`Cash: ${peso(stats.cashRevenue)}`}
          accent="blue"
        />
        <Stat
          icon={ShoppingCart}
          label="Non-Cash Sales"
          value={peso(stats.nonCashRevenue)}
          sub="Digital + B2B"
          accent="purple"
        />
        <Stat
          icon={Ban}
          label="Voids"
          value={String(stats.voidCount)}
          sub="Cancelled orders"
          accent="rose"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">Payment Methods</h2>
          {stats.byMethod.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400 py-4 text-center">No sales yet today.</p>
          ) : (
            <div className="space-y-2.5">
              {stats.byMethod.map((m) => {
                const pct = stats.totalRevenue > 0 ? (m.total / stats.totalRevenue) * 100 : 0;
                return (
                  <div key={m.method}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-stone-700 dark:text-stone-300">{METHOD_LABELS[m.method] ?? m.method}</span>
                      <span className="font-semibold text-stone-900 dark:text-stone-100">{peso(m.total)}</span>
                    </div>
                    <div className="h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">Top Products</h2>
          {stats.topProducts.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400 py-4 text-center">No sales yet today.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400 border-b border-stone-100 dark:border-stone-800">
                <tr>
                  <th className="text-left py-1.5 font-semibold">Product</th>
                  <th className="text-right py-1.5 font-semibold">Qty</th>
                  <th className="text-right py-1.5 font-semibold">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {stats.topProducts.map((p, i) => (
                  <tr key={p.id}>
                    <td className="py-2">
                      <span className="text-stone-400 dark:text-stone-500 mr-2">#{i + 1}</span>
                      <span className="text-stone-900 dark:text-stone-100">{p.name}</span>
                    </td>
                    <td className="py-2 text-right text-stone-700 dark:text-stone-300">{p.qty}</td>
                    <td className="py-2 text-right font-semibold text-stone-900 dark:text-stone-100">
                      {peso(p.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: 'emerald' | 'blue' | 'purple' | 'rose';
}) {
  const accentMap = {
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
    purple: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30',
    rose: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30',
  };
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg mb-3 ${accentMap[accent]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</p>
      <p className="text-xl font-bold text-stone-900 dark:text-stone-100 mt-0.5">{value}</p>
      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{sub}</p>
    </div>
  );
}
