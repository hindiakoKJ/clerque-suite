'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ShoppingCart, TrendingUp, Ban, CreditCard,
  ChevronLeft, ChevronRight, RefreshCw, Tag,
  Wallet, Percent, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  GCASH_PERSONAL: 'GCash Personal',
  GCASH_BUSINESS: 'GCash Business',
  MAYA_PERSONAL: 'Maya Personal',
  MAYA_BUSINESS: 'Maya Business',
  QR_PH: 'QR Ph',
};

function todayPH() {
  const now = new Date();
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return ph.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string) {
  const today = todayPH();
  if (dateStr === today) return 'Today';
  const yesterday = new Date(new Date(`${today}T12:00:00+08:00`).getTime() - 86400000)
    .toISOString().slice(0, 10);
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(`${dateStr}T12:00:00+08:00`).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function offsetDate(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface DailyReport {
  date: string;
  totalOrders: number;
  voidCount: number;
  totalRevenue: number;
  avgOrderValue: number;
  cashRevenue: number;
  nonCashRevenue: number;
  byPaymentMethod: { method: string; totalAmount: number; orderCount: number }[];
  topProducts: { productId: string; productName: string; quantitySold: number; revenue: number }[];
  byHour: { hour: number; orderCount: number; revenue: number }[];
  totalCogs: number;
  grossProfit: number;
  grossMargin: number;
  itemsMissingCost: { lineCount: number; revenueLeak: number };
}

interface MissingCostProduct {
  id: string;
  name: string;
  sku: string | null;
  price: string | number;
  category: { name: string } | null;
}
interface MissingCostResponse { count: number; products: MissingCostProduct[]; }

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';
  const [date, setDate] = useState(todayPH());

  const { data, isLoading, refetch, isFetching } = useQuery<DailyReport>({
    queryKey: ['daily-report', branchId, date],
    queryFn: () =>
      api.get(`/reports/daily?branchId=${branchId}&date=${date}`).then((r) => r.data),
    enabled: !!branchId,
    staleTime: 60_000,
  });

  // Products with no cost price — silently skip COGS, breaking gross-profit reporting
  const { data: missingCost } = useQuery<MissingCostResponse>({
    queryKey: ['products-missing-cost'],
    queryFn:  () => api.get('/products/missing-cost').then((r) => r.data),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  });

  const maxHourRevenue = Math.max(...(data?.byHour.map((h) => h.revenue) ?? [1]), 1);

  return (
    <div className="flex flex-col h-full bg-muted/30 overflow-auto">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-background border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Sales Dashboard</h1>
        <div className="flex items-center gap-2">
          {/* Date navigator */}
          <div className="flex items-center gap-1 bg-muted rounded-lg px-1 py-1">
            <button
              onClick={() => setDate((d) => offsetDate(d, -1))}
              className="p-1 rounded hover:bg-background transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <span className="text-sm font-medium text-foreground px-2 min-w-20 text-center">
              {formatDateLabel(date)}
            </span>
            <button
              onClick={() => setDate((d) => offsetDate(d, 1))}
              disabled={date >= todayPH()}
              className="p-1 rounded hover:bg-background transition-colors disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <RefreshCw className={`h-4 w-4 text-muted-foreground ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
          Loading report…
        </div>
      ) : !data ? null : (
        <div className="flex-1 p-4 sm:p-6 space-y-4 sm:space-y-6">

          {/* ── Profit-accuracy warning ── */}
          {((missingCost?.count ?? 0) > 0 || data.itemsMissingCost.lineCount > 0) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm text-amber-900">
                <div className="font-semibold mb-1">Profit reporting accuracy at risk</div>
                {(missingCost?.count ?? 0) > 0 && (
                  <p className="leading-snug">
                    <strong>{missingCost!.count}</strong> active product{missingCost!.count === 1 ? ' has' : 's have'} no cost price set.
                    Sales of these products record revenue but skip COGS — gross profit will be overstated.
                  </p>
                )}
                {data.itemsMissingCost.lineCount > 0 && (
                  <p className="leading-snug mt-1">
                    Today: <strong>{data.itemsMissingCost.lineCount}</strong> sold line{data.itemsMissingCost.lineCount === 1 ? '' : 's'} had no cost recorded
                    ({formatPeso(data.itemsMissingCost.revenueLeak)} of revenue without a matching cost).
                  </p>
                )}
                <Link href="/pos/products" className="inline-block mt-2 text-amber-800 underline font-medium hover:text-amber-900">
                  Fix products now →
                </Link>
              </div>
            </div>
          )}

          {/* ── Profitability row ── */}
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Profitability {date === todayPH() ? '(today)' : `(${date})`}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              {[
                {
                  icon: Wallet,
                  label: 'Gross Profit',
                  value: formatPeso(data.grossProfit),
                  sub: `Revenue − COGS`,
                  color: 'hsl(142 76% 36%)',
                  accent: true,
                },
                {
                  icon: TrendingUp,
                  label: 'Cost of Goods Sold',
                  value: formatPeso(data.totalCogs),
                  sub: data.itemsMissingCost.lineCount > 0
                    ? `${data.itemsMissingCost.lineCount} line(s) untracked`
                    : 'Booked to GL 5010',
                  color: 'hsl(0 72% 51%)',
                },
                {
                  icon: Percent,
                  label: 'Gross Margin',
                  value: `${(data.grossMargin * 100).toFixed(1)}%`,
                  sub: data.grossMargin > 0
                    ? `₱${(data.grossProfit / Math.max(data.totalOrders, 1)).toFixed(2)} / order`
                    : '—',
                  color: 'hsl(43 96% 56%)',
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="bg-background rounded-lg border border-border border-l-4 p-3 sm:p-4 flex flex-col justify-between min-h-[88px]"
                  style={{ borderLeftColor: card.accent ? 'var(--accent)' : card.color }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {card.label}
                    </span>
                    <card.icon className="w-4 h-4" style={{ color: card.color }} />
                  </div>
                  <div className="text-xl sm:text-2xl font-bold text-foreground">{card.value}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{card.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Top products strip cards ── */}
          {data.topProducts.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Top Products Today
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {data.topProducts.slice(0, 5).map((p, i) => {
                  const colors = [
                    { bar: 'var(--accent)', icon: 'var(--accent)', bg: 'var(--accent-soft)' },
                    { bar: 'hsl(142 76% 36%)', icon: 'hsl(142 76% 36%)', bg: 'hsl(142 76% 36% / 0.1)' },
                    { bar: 'hsl(262 70% 58%)', icon: 'hsl(262 70% 58%)', bg: 'hsl(262 70% 58% / 0.1)' },
                    { bar: 'hsl(43 96% 56%)', icon: 'hsl(43 96% 56%)', bg: 'hsl(43 96% 56% / 0.1)' },
                    { bar: 'hsl(351 94% 71%)', icon: 'hsl(351 94% 71%)', bg: 'hsl(351 94% 71% / 0.1)' },
                  ];
                  const c = colors[i % colors.length];
                  return (
                    <div
                      key={p.productId}
                      className="flex-none w-40 bg-background rounded-lg border border-border overflow-hidden"
                    >
                      <div className="h-1.5 w-full" style={{ background: c.bar }} />
                      <div className="p-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center mb-2"
                          style={{ background: c.bg }}
                        >
                          <Tag className="h-4 w-4" style={{ color: c.icon }} />
                        </div>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                          #{i + 1} product
                        </p>
                        <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2 mb-2 min-h-[2.5rem]">
                          {p.productName}
                        </p>
                        <div className="flex items-end justify-between">
                          <span className="text-sm font-bold text-foreground">{formatPeso(p.revenue)}</span>
                          <span className="text-[10px] text-muted-foreground">{p.quantitySold} sold</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── KPI cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {[
              {
                icon: ShoppingCart,
                label: 'Total Revenue',
                value: formatPeso(data.totalRevenue),
                sub: `${data.totalOrders} orders`,
                accentBorder: true,
              },
              {
                icon: TrendingUp,
                label: 'Avg Order Value',
                value: formatPeso(data.avgOrderValue),
                sub: `${data.totalOrders} completed`,
                color: 'hsl(142 76% 36%)',
              },
              {
                icon: CreditCard,
                label: 'Non-Cash Sales',
                value: formatPeso(data.nonCashRevenue),
                sub: `Cash: ${formatPeso(data.cashRevenue)}`,
                color: 'hsl(262 70% 58%)',
              },
              {
                icon: Ban,
                label: 'Voids',
                value: String(data.voidCount),
                sub: 'Cancelled orders',
                color: 'hsl(0 72% 51%)',
              },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-background rounded-lg border border-border border-l-4 p-3 sm:p-4 flex flex-col justify-between min-h-[88px]"
                style={{ borderLeftColor: card.accentBorder ? 'var(--accent)' : card.color }}
              >
                <p className="text-[11px] sm:text-xs text-muted-foreground font-medium leading-tight">{card.label}</p>
                <p className="text-lg sm:text-xl md:text-2xl font-bold text-foreground leading-none my-1 truncate">{card.value}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{card.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Payment method breakdown */}
            <div className="bg-background rounded-lg border border-border p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Payment Methods</h2>
              {data.byPaymentMethod.length === 0 ? (
                <p className="text-xs text-muted-foreground">No transactions yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.byPaymentMethod
                    .sort((a, b) => b.totalAmount - a.totalAmount)
                    .map((p) => {
                      const pct = data.totalRevenue > 0
                        ? (p.totalAmount / data.totalRevenue) * 100
                        : 0;
                      return (
                        <div key={p.method}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-foreground font-medium">
                              {METHOD_LABELS[p.method] ?? p.method}
                            </span>
                            <span className="text-muted-foreground">
                              {formatPeso(p.totalAmount)}
                              <span className="mx-1 opacity-40">·</span>
                              {p.orderCount} orders
                            </span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct.toFixed(1)}%`, background: 'var(--accent)' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Top products table */}
            <div className="bg-background rounded-lg border border-border p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Top Products</h2>
              {data.topProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No sales yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[280px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left pb-2 font-semibold text-muted-foreground">#</th>
                        <th className="text-left pb-2 font-semibold text-muted-foreground">Product</th>
                        <th className="text-right pb-2 font-semibold text-muted-foreground">Qty</th>
                        <th className="text-right pb-2 font-semibold text-muted-foreground">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.topProducts.slice(0, 8).map((p, i) => (
                        <tr key={p.productId}>
                          <td className="py-2 text-muted-foreground font-mono">{i + 1}</td>
                          <td className="py-2 font-medium text-foreground truncate max-w-[140px]">
                            {p.productName}
                          </td>
                          <td className="py-2 text-right text-muted-foreground">{p.quantitySold}</td>
                          <td className="py-2 text-right font-semibold text-foreground">
                            {formatPeso(p.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Hourly sales bar chart */}
          {data.byHour.length > 0 && (
            <div className="bg-background rounded-lg border border-border p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Sales by Hour</h2>
              <div className="flex items-end gap-1.5 h-24">
                {data.byHour.map((h) => {
                  const heightPct = (h.revenue / maxHourRevenue) * 100;
                  return (
                    <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 group">
                      <div
                        className="relative w-full rounded-t transition-colors cursor-default"
                        style={{
                          height: `${Math.max(heightPct, 4)}%`,
                          background: 'color-mix(in oklab, var(--accent) 15%, transparent)',
                        }}
                        title={`${h.hour}:00 — ${h.orderCount} orders · ${formatPeso(h.revenue)}`}
                      />
                      <span className="text-[9px] text-muted-foreground tabular-nums">
                        {h.hour}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
