'use client';
import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Package, Layers, History, AlertTriangle, ShoppingBag,
  FlaskConical, ExternalLink, Calendar, ClipboardList,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useInventoryBase } from '@/lib/inventory-base';
import { todayIso, isoDaysFromToday } from '@/lib/today';
import { rowTitle, rowTone, summarize, onHandOf, orderHref, perUnitPeso, type TimelineKind, type TimelineTone } from './timeline-view';

// ─── Types ───────────────────────────────────────────────────────────────────

interface IngredientInfo {
  id:        string;
  name:      string;
  unit:      string;
  costPrice: number | null;
}

interface MovementRow {
  id:            string;
  /** Delivery, sale, prep batch, write-off or count; see ./timeline-view. */
  kind:          TimelineKind;
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
  /** A write-off's reason or a count's kind, when the record said. */
  reason?:       string | null;
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
  /** The stock book's figure for the shelf, valued at today's average cost. Optional because an older API does not send it. */
  onHand?:    { quantity: number; value: number } | null;
  lots:       LotRow[];
}

const TONE_CLS: Record<TimelineTone, string> = {
  in:    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  sale:  'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  prep:  'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  out:   'bg-red-500/10 text-red-600 dark:text-red-400',
  count: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

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

/** The last 30 days by the shop's calendar: before 8 AM in Manila the UTC date is still yesterday. */
function defaultRange() {
  return { from: isoDaysFromToday(-30), to: todayIso() };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function IngredientDrilldownPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useAuthStore((s) => s.user);
  const base = useInventoryBase();   // /pos/inventory or /procure/stock
  const inPos = base === '/pos/inventory';
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

  // The range's figures come from the same rows the timeline shows, so the
  // two always agree. What is on the shelf comes from the stock book, the
  // same number Stock on hand shows: the lots' leftovers added up are not it.
  const summary = useMemo(() => summarize(movResp?.movements ?? []), [movResp]);
  const onHand  = useMemo(() => onHandOf(lotsResp), [lotsResp]);

  const ingredient = movResp?.ingredient ?? lotsResp?.ingredient ?? null;
  const unit = ingredient?.unit ?? '';

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 p-4 sm:px-6 border-b border-border shrink-0 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={base}
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
                <> · WAC {perUnitPeso(ingredient.costPrice as number)} / {unit}</>
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
          primary={qty(onHand.quantity, unit)}
          secondary={peso(onHand.value)}
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
          label="Used (range)"
          primary={qty(summary.usedQty, unit)}
          secondary={summary.writtenOffQty > 0
            ? `${peso(summary.usedValue)} · ${qty(summary.writtenOffQty, unit)} written off`
            : peso(summary.usedValue)}
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
                                {lot.paymentMethod && <> · {lot.paymentMethod.toLowerCase().replace(/_/g, ' ')}</>}
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
                              {perUnitPeso(lot.unitCost)}
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
                    const tone   = rowTone(m);
                    const Icon   = tone === 'in' ? ShoppingBag
                      : tone === 'out' ? AlertTriangle
                      : tone === 'count' ? ClipboardList
                      : tone === 'prep' ? Layers
                      : FlaskConical;
                    const amount = Math.abs(m.quantity);
                    const worth  = Math.abs(m.totalValue);
                    return (
                      <li key={m.id} className="px-3 py-2.5 flex items-start gap-3 hover:bg-muted/40 transition-colors">
                        <div className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${TONE_CLS[tone]}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">{rowTitle(m)}</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {fmtDateTime(m.occurredAt)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {m.kind === 'RECEIPT' ? (
                              <>
                                +{qty(m.quantity, unit)} @ {perUnitPeso(m.unitCost)}/{unit} = {peso(m.totalValue)}
                                {m.reference && <> · ref {m.reference}</>}
                                {m.paymentMethod && <> · {m.paymentMethod.toLowerCase().replace(/_/g, ' ')}</>}
                              </>
                            ) : m.kind === 'CONSUMPTION' ? (
                              <>
                                −{qty(amount, unit)} (cost {peso(worth)})
                                {m.orderNumber && (
                                  /*
                                    The order lives in POS, and this page also
                                    renders inside Procure. MDM and warehouse
                                    staff hold Procure without POS, so for them
                                    this link is not a detour — middleware ejects
                                    them to /select and the Procure session is
                                    gone. They still need to READ which order
                                    consumed the stock, so the number stays;
                                    only the link is withheld where it would
                                    throw them out.
                                  */
                                  <> · order{' '}
                                    {inPos && m.orderId ? (
                                      <Link
                                        href={orderHref(m.orderId)}
                                        className="hover:underline inline-flex items-center gap-0.5"
                                        style={{ color: 'var(--accent)' }}
                                      >
                                        {m.orderNumber}
                                        <ExternalLink className="h-2.5 w-2.5" />
                                      </Link>
                                    ) : (
                                      <span className="font-medium">{m.orderNumber}</span>
                                    )}
                                  </>
                                )}
                                {m.reference && <div className="text-[10px] mt-0.5 italic">{m.reference}</div>}
                              </>
                            ) : (
                              <>
                                {m.quantity >= 0 ? '+' : '−'}{qty(amount, unit)} ({m.kind === 'WRITE_OFF' ? 'worth' : 'cost'} {peso(worth)})
                                {m.kind === 'PREP' && m.reference && <> · for {m.reference}</>}
                                {m.kind !== 'PREP' && m.reference && <> · ref {m.reference}</>}
                                {m.reason && <div className="text-[10px] mt-0.5 italic">{m.reason}</div>}
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
