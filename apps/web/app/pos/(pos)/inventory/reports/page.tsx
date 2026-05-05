'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Package, ShoppingBag, FlaskConical, AlertTriangle, Download, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { downloadAuthFile } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface IngredientReportRow {
  id:               string;
  name:             string;
  unit:             string;
  costPrice:        number;
  lowStockAlert:    number | null;
  openingQty:       number;
  openingValue:     number;
  purchasesQty:     number;
  purchasesValue:   number;
  consumptionQty:   number;
  consumptionValue: number;
  closingQty:       number;
  closingValue:     number;
  daysOfStock:      number | null;
  isLowStock:       boolean;
}

interface IngredientReport {
  from:     string;
  to:       string;
  days:     number;
  branchId: string | null;
  rows:     IngredientReportRow[];
  totals: {
    openingValue:     number;
    purchasesValue:   number;
    consumptionValue: number;
    closingValue:     number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const qty = (n: number, unit: string) =>
  `${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${unit}`;

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

// CSV download — frontend-only; no extra endpoint needed.
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Tab = 'on-hand' | 'purchases' | 'consumption';

export default function IngredientReportsPage() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>('on-hand');
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to,   setTo]   = useState(init.to);

  const { data, isLoading, error } = useQuery<IngredientReport>({
    queryKey: ['ingredient-report', from, to, user?.branchId ?? null],
    queryFn:  () => api
      .get('/reports/ingredients', { params: { from, to, branchId: user?.branchId ?? undefined } })
      .then((r) => r.data),
    enabled:  !!user,
    staleTime: 30_000,
  });

  // Derived: sorted views per tab.
  const onHandRows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => b.closingValue - a.closingValue);
  }, [data]);

  const purchaseRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => r.purchasesQty > 0).sort((a, b) => b.purchasesValue - a.purchasesValue);
  }, [data]);

  const consumptionRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => r.consumptionQty > 0).sort((a, b) => b.consumptionValue - a.consumptionValue);
  }, [data]);

  function exportCsv() {
    if (!data) return;
    const dateStr = `${from}_to_${to}`;
    if (tab === 'on-hand') {
      downloadCsv(
        `ingredients-on-hand-${dateStr}.csv`,
        ['Ingredient', 'Unit', 'On Hand', 'Cost/Unit', 'Total Value', 'Days of Stock', 'Low Stock?'],
        onHandRows.map((r) => [r.name, r.unit, r.closingQty, r.costPrice, r.closingValue, r.daysOfStock ?? '', r.isLowStock ? 'YES' : '']),
      );
    } else if (tab === 'purchases') {
      downloadCsv(
        `ingredient-purchases-${dateStr}.csv`,
        ['Ingredient', 'Unit', 'Qty Purchased', 'Total Cost'],
        purchaseRows.map((r) => [r.name, r.unit, r.purchasesQty, r.purchasesValue]),
      );
    } else {
      downloadCsv(
        `ingredient-consumption-${dateStr}.csv`,
        ['Ingredient', 'Unit', 'Qty Consumed', 'Total Cost', 'Days in Range', 'Avg Daily'],
        consumptionRows.map((r) => [r.name, r.unit, r.consumptionQty, r.consumptionValue, data.days, r.consumptionQty / data.days]),
      );
    }
  }

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
            <h1 className="text-base sm:text-lg font-semibold text-foreground">Ingredient Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              On-hand · Purchases · Consumption — reconcile your kitchen with your books
            </p>
          </div>
        </div>

        {/* Date range + export */}
        <div className="flex items-center gap-2 flex-wrap">
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
          <button
            onClick={exportCsv}
            disabled={!data}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            title="Export current tab to CSV"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 sm:px-6 py-2 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-center gap-1">
          <TabButton active={tab === 'on-hand'}     onClick={() => setTab('on-hand')}     icon={Package}      label="Stock on Hand" />
          <TabButton active={tab === 'purchases'}   onClick={() => setTab('purchases')}   icon={ShoppingBag}  label="Purchases" />
          <TabButton active={tab === 'consumption'} onClick={() => setTab('consumption')} icon={FlaskConical} label="Consumption" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading report…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-40 text-red-500 text-sm">Could not load the report.</div>
        ) : !data ? null : tab === 'on-hand' ? (
          <OnHandTable rows={onHandRows} totalValue={data.totals.closingValue} />
        ) : tab === 'purchases' ? (
          <PurchasesTable rows={purchaseRows} totalValue={data.totals.purchasesValue} days={data.days} />
        ) : (
          <ConsumptionTable rows={consumptionRows} totalValue={data.totals.consumptionValue} days={data.days} />
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TabButton({
  active, onClick, icon: Icon, label,
}: { active: boolean; onClick: () => void; icon: React.ElementType; label: string; }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
        active
          ? 'bg-background text-foreground shadow-sm border border-border'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ReconcileCallout({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 sm:px-6 py-3 bg-muted/30 border-b border-border text-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground tabular-nums">{peso(value)}</span>
    </div>
  );
}

function IngredientNameCell({ id, name, isLowStock }: { id: string; name: string; isLowStock: boolean }) {
  return (
    <Link
      href={`/pos/inventory/${id}`}
      className="group flex items-center gap-2 hover:underline"
      style={{ color: 'var(--accent)' }}
    >
      <span className="font-medium">{name}</span>
      {isLowStock && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-2.5 w-2.5" />
          Low
        </span>
      )}
      <ChevronRight className="h-3 w-3 opacity-40 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

function OnHandTable({ rows, totalValue }: { rows: IngredientReportRow[]; totalValue: number }) {
  if (rows.length === 0) {
    return <div className="text-center text-muted-foreground text-sm py-12">No ingredients yet.</div>;
  }
  return (
    <>
      <ReconcileCallout
        label="Total inventory value (sum of all ingredients × cost price) — should match Ledger account 1050 ‑ Merchandise Inventory"
        value={totalValue}
      />
      <table className="w-full text-sm min-w-[720px]">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border sticky top-0">
          <tr>
            <th className="px-6 py-3 text-left font-semibold">Ingredient</th>
            <th className="px-4 py-3 text-right font-semibold">On Hand</th>
            <th className="px-4 py-3 text-right font-semibold">Cost / Unit</th>
            <th className="px-4 py-3 text-right font-semibold">Total Value</th>
            <th className="px-4 py-3 text-right font-semibold">Days of Stock</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40 transition-colors">
              <td className="px-6 py-3">
                <IngredientNameCell id={r.id} name={r.name} isLowStock={r.isLowStock} />
              </td>
              <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                r.isLowStock ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
              }`}>
                {qty(r.closingQty, r.unit)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {r.costPrice > 0 ? peso(r.costPrice) : <span className="text-amber-600">— set cost</span>}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">
                {peso(r.closingValue)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.daysOfStock != null ? (
                  <span className={r.daysOfStock < 7 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}>
                    {r.daysOfStock}d
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function PurchasesTable({ rows, totalValue, days }: { rows: IngredientReportRow[]; totalValue: number; days: number }) {
  if (rows.length === 0) {
    return <div className="text-center text-muted-foreground text-sm py-12">No purchases recorded in this date range.</div>;
  }
  return (
    <>
      <ReconcileCallout
        label={`Total purchases over ${days} day${days === 1 ? '' : 's'} — reconciles to Dr 1050 Inventory entries in the Ledger`}
        value={totalValue}
      />
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border sticky top-0">
          <tr>
            <th className="px-6 py-3 text-left font-semibold">Ingredient</th>
            <th className="px-4 py-3 text-right font-semibold">Qty Purchased</th>
            <th className="px-4 py-3 text-right font-semibold">Total Cost</th>
            <th className="px-4 py-3 text-right font-semibold">Avg Daily</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40 transition-colors">
              <td className="px-6 py-3">
                <IngredientNameCell id={r.id} name={r.name} isLowStock={r.isLowStock} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
                {qty(r.purchasesQty, r.unit)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">
                {peso(r.purchasesValue)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {qty(r.purchasesQty / days, r.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ConsumptionTable({ rows, totalValue, days }: { rows: IngredientReportRow[]; totalValue: number; days: number }) {
  if (rows.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm py-12">
        No consumption recorded in this date range. Consumption is derived from completed orders that include recipe-based products.
      </div>
    );
  }
  return (
    <>
      <ReconcileCallout
        label={`Total ingredient cost consumed over ${days} day${days === 1 ? '' : 's'} — included in your COGS (account 5010) for the period`}
        value={totalValue}
      />
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border sticky top-0">
          <tr>
            <th className="px-6 py-3 text-left font-semibold">Ingredient</th>
            <th className="px-4 py-3 text-right font-semibold">Qty Consumed</th>
            <th className="px-4 py-3 text-right font-semibold">Cost Consumed</th>
            <th className="px-4 py-3 text-right font-semibold">Avg Daily</th>
            <th className="px-4 py-3 text-right font-semibold">% of Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40 transition-colors">
              <td className="px-6 py-3">
                <IngredientNameCell id={r.id} name={r.name} isLowStock={r.isLowStock} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
                {qty(r.consumptionQty, r.unit)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">
                {peso(r.consumptionValue)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {qty(r.consumptionQty / days, r.unit)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {totalValue > 0 ? `${((r.consumptionValue / totalValue) * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// Suppress unused warning — downloadAuthFile is not used here but leaves the
// door open for a future Excel export endpoint without re-importing.
void downloadAuthFile;
