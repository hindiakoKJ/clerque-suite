'use client';
import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Package, Layers, History, AlertTriangle, ShoppingBag,
  FlaskConical, ExternalLink, Calendar,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

// ─── Types ───────────────────────────────────────────────────────────────────

interface IngredientInfo {
  id:        string;
  name:      string;
  unit:      string;
  costPrice: number | null;
}

interface MovementRow {
  id:            string;
  kind:          'RECEIPT' | 'CONSUMPTION';
  occurredAt:    string;
  quantity:      number;
  qtyRemaining:  number;
  unitCost:      number;
  totalValue:    number;
  reference:     string | null;
  paymentMethod: string | null;
  branchId:      string | null;
  orderId:       string | null;
  orderNumber:   string | null;
}

interface MovementsResponse {
  ingredient: IngredientInfo;
  movements:  MovementRow[];
}

interface LotRow {
  id:             string;
  receivedAt:     string;
  qtyReceived:    number;
  qtyRemaining:   number;
  qtyConsumed:    number;
  pctRemaining:   number;
  unitCost:       number;
  valueRemaining: number;
  valueOriginal:  number;
  reference:      string | null;
  paymentMethod:  string | null;
  branchId:       string | null;
  ageDays:        number;
}

interface LotsResponse {
  ingredient: { id: string; name: string; unit: string };
  lots:       LotRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const qty = (n: number, unit: string) =>
  `${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${unit}`;

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function IngredientDrilldownPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useAuthStore((s) => s.user);
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to,   setTo]   = useState(init.to);

  const { data: movResp, isLoading: movLoading } = useQuery<MovementsResponse>({
    queryKey: ['ingredient-movements', id, from, to, user?.branchId ?? null],
    queryFn:  () => api.get(`/inventory/raw-materials/${id}/movements`, {
      params: { from, to, branchId: user?.branchId ?? undefined, limit: 500 },
    }).then((r) => r.data),
    enabled:   !!user,
    staleTime: 15_000,
  });

  const { data: lotsResp, isLoading: lotsLoading } = useQuery<LotsResponse>({
    queryKey: ['ingredient-lots', id, user?.branchId ?? null],
    queryFn:  () => api.get(`/inventory/raw-materials/${id}/lots`, {
      params: { branchId: user?.branchId ?? undefined },
    }).then((r) => r.data),
    enabled:   !!user,
    staleTime: 15_000,
  });

  // Derived summary from the movements list (so it's always perfectly
  // consistent with the timeline shown below).
  const summary = useMemo(() => {
    const movements = movResp?.movements ?? [];
    let purchasesQty = 0, purchasesValue = 0;
    let consumptionQty = 0, consumptionValue = 0;
    for (const m of movements) {
      if (m.kind === 'RECEIPT') {
        purchasesQty   += m.quantity;
        purchasesValue += m.totalValue;
      } else {
        consumptionQty   += -m.quantity;       // quantity is negative
        consumptionValue += -m.totalValue;     // totalValue is negative
      }
    }
    const lotsRemaining = (lotsResp?.lots ?? []).reduce((s, l) => s + l.qtyRemaining, 0);
    const lotsValue     = (lotsResp?.lots ?? []).reduce((s, l) => s + l.valueRemaining, 0);
    return { purchasesQty, purchasesValue, consumptionQty, consumptionValue, lotsRemaining, lotsValue };
  }, [movResp, lotsResp]);

  const ingredient = movResp?.ingredient ?? lotsResp?.ingredient ?? null;
  const unit = ingredient?.unit ?? '';

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 p-4 sm:px-6 border-b border-border shrink-0 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/pos/inventory"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Back to Ingredients"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
              <h1 className="text-base sm:text-lg font-semibold text-foreground truncate">
                {ingredient?.name ?? 'Ingredient'}
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tracked in <span className="font-mono">{unit}</span>
              {ingredient && 'costPrice' in ingredient && ingredient.costPrice != null && (
                <> · WAC {peso(ingredient.costPrice as number)} / {unit}</>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="text-xs border border-border bg-background rounded-md px-2 py-1.5 text-foreground"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="text-xs border border-border bg-background rounded-md px-2 py-1.5 text-foreground"
          />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 sm:p-6 shrink-0">
        <KpiCard
          icon={Package}
          label="On Hand"
          primary={qty(summary.lotsRemaining, unit)}
          secondary={peso(summary.lotsValue)}
          tone="neutral"
        />
        <KpiCard
          icon={ShoppingBag}
          label="Purchased (range)"
          primary={qty(summary.purchasesQty, unit)}
          secondary={peso(summary.purchasesValue)}
          tone="positive"
        />
        <KpiCard
          icon={FlaskConical}
          label="Consumed (range)"
          primary={qty(summary.consumptionQty, unit)}
          secondary={peso(summary.consumptionValue)}
          tone="negative"
        />
        <KpiCard
          icon={Layers}
          label="Active Lots"
          primary={`${(lotsResp?.lots ?? []).filter((l) => l.qtyRemaining > 0).length} lot${(lotsResp?.lots ?? []).filter((l) => l.qtyRemaining > 0).length === 1 ? '' : 's'}`}
          secondary={`${(lotsResp?.lots ?? []).length} lifetime`}
          tone="neutral"
        />
      </div>

      {/* Two-column layout: Lots (left) + Movement Timeline (right) */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* FIFO Lots */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">FIFO Lots</h2>
              <span className="text-xs text-muted-foreground">— oldest drained first</span>
            </div>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              {lotsLoading ? (
                <div className="text-center text-muted-foreground text-xs py-6">Loading lots…</div>
              ) : (lotsResp?.lots ?? []).length === 0 ? (
                <div className="text-center text-muted-foreground text-xs py-6">
                  No deliveries recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wide border-b border-border">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Received</th>
                        <th className="px-3 py-2 text-right font-semibold">Original</th>
                        <th className="px-3 py-2 text-right font-semibold">Remaining</th>
                        <th className="px-3 py-2 text-right font-semibold">Cost</th>
                        <th className="px-3 py-2 text-right font-semibold">Value Left</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lotsResp!.lots.map((lot) => {
                        const drained = lot.qtyRemaining <= 0;
                        return (
                          <tr key={lot.id} className={drained ? 'opacity-50' : ''}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-foreground">{fmtDate(lot.receivedAt)}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {lot.ageDays}d old
                                {lot.reference && <> · {lot.reference}</>}
                                {lot.paymentMethod && <> · {lot.paymentMethod.toLowerCase()}</>}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {qty(lot.qtyReceived, unit)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <span className={drained ? 'text-muted-foreground' : 'font-semibold text-foreground'}>
                                {qty(lot.qtyRemaining, unit)}
                              </span>
                              <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
                                <div
                                  className="h-full transition-all"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, lot.pctRemaining))}%`,
                                    background: drained ? 'hsl(0 0% 70%)' : 'var(--accent)',
                                  }}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {peso(lot.unitCost)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground">
                              {peso(lot.valueRemaining)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              Lots are draining FIFO if your tenant is on the FIFO valuation method (Settings → Costing).
              On WAC, the running average cost is used and lot drain is informational only.
            </p>
          </section>

          {/* Movement Timeline */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <History className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Movement Timeline</h2>
            </div>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              {movLoading ? (
                <div className="text-center text-muted-foreground text-xs py-6">Loading movements…</div>
              ) : (movResp?.movements ?? []).length === 0 ? (
                <div className="text-center text-muted-foreground text-xs py-6">
                  No movements in this date range.
                </div>
              ) : (
                <ul className="divide-y divide-border max-h-[600px] overflow-y-auto">
                  {movResp!.movements.map((m) => {
                    const isReceipt = m.kind === 'RECEIPT';
                    return (
                      <li key={m.id} className="px-3 py-2.5 flex items-start gap-3 hover:bg-muted/40 transition-colors">
                        <div className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                          isReceipt
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        }`}>
                          {isReceipt ? <ShoppingBag className="h-3.5 w-3.5" /> : <FlaskConical className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">
                              {isReceipt ? 'Stock received' : 'Consumed for sale'}
                            </span>
                            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {fmtDateTime(m.occurredAt)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {isReceipt ? (
                              <>
                                +{qty(m.quantity, unit)} @ {peso(m.unitCost)}/{unit} = {peso(m.totalValue)}
                                {m.reference && <> · ref {m.reference}</>}
                                {m.paymentMethod && <> · {m.paymentMethod.toLowerCase()}</>}
                              </>
                            ) : (
                              <>
                                −{qty(-m.quantity, unit)} (cost {peso(-m.totalValue)})
                                {m.orderNumber && (
                                  <> · order{' '}
                                    <Link
                                      href={`/pos/orders?focus=${m.orderId ?? ''}`}
                                      className="hover:underline inline-flex items-center gap-0.5"
                                      style={{ color: 'var(--accent)' }}
                                    >
                                      {m.orderNumber}
                                      <ExternalLink className="h-2.5 w-2.5" />
                                    </Link>
                                  </>
                                )}
                                {m.reference && <div className="text-[10px] mt-0.5 italic">{m.reference}</div>}
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, primary, secondary, tone,
}: {
  icon: React.ElementType;
  label: string;
  primary: string;
  secondary: string;
  tone: 'neutral' | 'positive' | 'negative';
}) {
  const toneCls =
    tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' :
    tone === 'negative' ? 'text-blue-600 dark:text-blue-400 bg-blue-500/10' :
                          'text-muted-foreground bg-muted';
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${toneCls}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="mt-2 text-base font-semibold text-foreground tabular-nums truncate">{primary}</div>
      <div className="text-[11px] text-muted-foreground tabular-nums truncate">{secondary}</div>
    </div>
  );
}

void AlertTriangle;
