'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Package, ShoppingBag, FlaskConical, AlertTriangle, Download, ChevronRight, ChevronLeft, ClipboardList, Printer, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { downloadAuthFile } from '@/lib/utils';
import { useInventoryBase } from '@/lib/inventory-base';
import { reportView, type Tab } from './report-link';
import {
  SheetPrintCopy, SheetTables, sheetErrorMessage, usePrintSheet, type DailySheet,
} from '@/components/pos/StationInventorySheet';

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
  /** Everything that left the shelf: the four below added up. */
  consumptionQty:   number;
  consumptionValue: number;
  soldQty:          number;
  /** Made, then voided or refunded: the ingredients never come back. */
  wastedQty:        number;
  intoPrepsQty:     number;
  writtenOffQty:    number;
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
    /**
     * Sold, wasted and written off, in pesos. Unlike each row's value, it leaves
     * out what went into preps: the prep still holds that value, and it is
     * counted when the prep is used.
     */
    consumptionValue: number;
    closingValue:     number;
  };
  /** Units sold in range still waiting at a kitchen or bar screen: nothing used for them yet. */
  stillBeingMade?:  number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const qty = (n: number, unit: string) =>
  `${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${unit}`;

// The shop's calendar day. toISOString() is the UTC day, which before 8 AM in
// Manila is still yesterday -- and the report reads these dates as Manila days.
const manilaDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: manilaDay(from),
    to:   manilaDay(to),
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

// useSearchParams has to sit inside a Suspense boundary, or Next's build cannot prerender the page.
export default function IngredientReportsPage() {
  return (
    <Suspense>
      <LinkedReports />
    </Suspense>
  );
}

function LinkedReports() {
  const params = useSearchParams();
  // Tapping another bell while this page is open changes only the query string, and Next keeps the
  // page mounted, so the dates and tab would stay on the first link. A new key starts from the new one.
  return <IngredientReports key={params.toString()} params={params} />;
}

function IngredientReports({ params }: { params: { get(name: string): string | null } }) {
  const base = useInventoryBase();   // stays inside POS or Procure, whichever opened it
  const user = useAuthStore((s) => s.user);
  // The end-of-day bell asks for one branch's day on the Consumption tab, so its numbers match the page.
  const linked = reportView(params, user);
  // The daily sheet is its own tab: the kitchen's Beginning-to-Ending sheet, for the people its route lets in.
  const [tab, setTab] = useState<Tab | 'daily-sheet'>(linked.tab);
  const canSeeDailySheet = !!user && (user.isSuperAdmin || DAILY_SHEET_ROLES.includes(user.role));
  const init = linked.dates ?? defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to,   setTo]   = useState(init.to);
  const branchId = linked.branchId;

  const { data, isLoading, error } = useQuery<IngredientReport>({
    queryKey: ['ingredient-report', from, to, branchId],
    queryFn:  () => api
      .get('/reports/ingredients', { params: { from, to, branchId: branchId ?? undefined } })
      .then((r) => r.data),
    enabled:  !!user && tab !== 'daily-sheet',
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
    // Then by quantity, so ingredients with no cost on file still sort sensibly.
    return data.rows
      .filter((r) => r.consumptionQty > 0)
      .sort((a, b) => b.consumptionValue - a.consumptionValue || b.consumptionQty - a.consumptionQty);
  }, [data]);

  function exportCsv() {
    if (!data || tab === 'daily-sheet') return;
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
        ['Ingredient', 'Unit', 'Sold', 'Wasted', 'Into Preps', 'Written Off', 'Total', 'Value'],
        consumptionRows.map((r) => [
          r.name, r.unit, r.soldQty, r.wastedQty, r.intoPrepsQty, r.writtenOffQty, r.consumptionQty, r.consumptionValue,
        ]),
      );
    }
  }

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
            <h1 className="text-base sm:text-lg font-semibold text-foreground">Ingredient Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              On-hand · Purchases · Consumption — reconcile your kitchen with your books
            </p>
          </div>
        </div>

        {/* Date range + export. The daily sheet picks its own day. */}
        {tab !== 'daily-sheet' && (
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
        )}
      </div>

      {/* Tabs */}
      <div className="px-4 sm:px-6 py-2 border-b border-border bg-muted/20 shrink-0">
        {/* Wraps onto a second line on a phone rather than pushing the page sideways. */}
        <div className="flex flex-wrap items-center gap-1">
          <TabButton active={tab === 'on-hand'}     onClick={() => setTab('on-hand')}     icon={Package}      label="Stock on Hand" />
          <TabButton active={tab === 'purchases'}   onClick={() => setTab('purchases')}   icon={ShoppingBag}  label="Purchases" />
          <TabButton active={tab === 'consumption'} onClick={() => setTab('consumption')} icon={FlaskConical} label="Consumption" />
          {canSeeDailySheet && (
            <TabButton active={tab === 'daily-sheet'} onClick={() => setTab('daily-sheet')} icon={ClipboardList} label="Daily sheet" />
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {tab === 'daily-sheet' ? (
          <DailySheetTab initialBranchId={branchId} />
        ) : isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading report…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-40 text-red-500 text-sm">Could not load the report.</div>
        ) : !data ? null : tab === 'on-hand' ? (
          <OnHandTable rows={onHandRows} totalValue={data.totals.closingValue} />
        ) : tab === 'purchases' ? (
          <PurchasesTable rows={purchaseRows} totalValue={data.totals.purchasesValue} days={data.days} />
        ) : (
          <ConsumptionTable
            rows={consumptionRows}
            totalValue={data.totals.consumptionValue}
            days={data.days}
            stillBeingMade={data.stillBeingMade ?? 0}
          />
        )}
      </div>
    </div>
  );
}

// ─── Daily sheet ─────────────────────────────────────────────────────────────

/** Who the daily-sheet route lets in (a manager tied to one branch sees only that branch). */
const DAILY_SHEET_ROLES: string[] = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SUPER_ADMIN'];

type OwnerSheet = DailySheet & {
  choices: { branches: Array<{ id: string; name: string }>; stations: Array<{ id: string; name: string; kind: string }> };
};

/**
 * The owner's copy of the kitchen's daily sheet: the same sheet the station
 * screen shows and prints, for any branch, one station's rows or every item.
 * Quantities only, like the kitchen's copy -- the other tabs carry the costs.
 */
function DailySheetTab({ initialBranchId }: { initialBranchId: string | null }) {
  const [branchId, setBranchId] = useState<string | null>(initialBranchId);
  const [stationId, setStationId] = useState<string | null>(null);
  // Null is the server's default: the sheet running now, or the one just closed for a while after closing.
  const [day, setDay] = useState<string | null>(null);
  const { printedAt, print } = usePrintSheet();

  const { data: sheet, isPending, isError, error, isFetching } = useQuery<OwnerSheet>({
    queryKey: ['daily-sheet', branchId, stationId, day ?? 'default'],
    queryFn:  () => api
      .get('/reports/ingredients/daily-sheet', {
        params: { branchId: branchId ?? undefined, stationId: stationId ?? undefined, day: day ?? undefined },
      })
      .then((r) => r.data),
    // A running sheet keeps up; a closed one never changes.
    refetchInterval: (q) => (q.state.data?.status === 'LIVE' ? 60_000 : false),
    // Keep the sheet on screen while another branch, station or day loads.
    placeholderData: keepPreviousData,
  });

  const field = 'text-xs border border-border bg-background rounded-md px-2 py-1.5 text-foreground';
  const dayButton = 'flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors';
  const message = isError ? sheetErrorMessage(error) : null;

  return (
    <div className="px-4 sm:px-6 py-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Branch"
          value={sheet?.branch.id ?? branchId ?? ''}
          onChange={(e) => { setBranchId(e.target.value); setStationId(null); setDay(null); }}
          className={field}
        >
          {(sheet?.choices.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select aria-label="Station" value={stationId ?? ''} onChange={(e) => setStationId(e.target.value || null)} className={field}>
          <option value="">All items</option>
          {(sheet?.choices.stations ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="button" onClick={() => sheet?.previousDay && setDay(sheet.previousDay)} disabled={!sheet?.previousDay} className={dayButton}>
          <ChevronLeft className="h-3.5 w-3.5" />
          {sheet?.previousDayLabel ?? 'Earlier'}
        </button>
        <input
          type="date"
          aria-label="Day"
          value={day ?? sheet?.day ?? ''}
          max={sheet?.today}
          onChange={(e) => setDay(e.target.value || null)}
          className={field}
        />
        {sheet?.nextDay && (
          <button type="button" onClick={() => setDay(sheet.nextDay)} className={dayButton}>
            {sheet.nextDayLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={print}
          disabled={!sheet}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Printer className="h-3.5 w-3.5" />
          Print
        </button>
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {isPending ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading the sheet…</div>
      ) : !sheet ? (
        <div className="flex flex-col items-center justify-center gap-3 h-40 text-sm text-center">
          <p className="text-red-500">{message ?? 'Could not load the sheet.'}</p>
          {day && <button type="button" onClick={() => setDay(null)} className={dayButton}>Back to the current sheet</button>}
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-base font-semibold text-foreground">{sheet.title}</h2>
            <p className="text-xs text-muted-foreground">
              {sheet.branch.name} · {sheet.dayLabel} · {sheet.status === 'LIVE'
                ? `running totals as of ${sheet.window.toLabel}`
                : `${sheet.window.fromLabel} to ${sheet.window.toLabel}`}
            </p>
          </div>
          {isError && <p className="text-xs text-red-500">{message ?? 'Could not refresh the sheet.'} Showing what was loaded last.</p>}
          {sheet.notes.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
              {sheet.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <SheetTables sheet={sheet} tone="light" />
          <SheetPrintCopy sheet={sheet} printedAt={printedAt} />
        </>
      )}
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
  const base = useInventoryBase();
  return (
    <Link
      href={`${base}/${id}`}
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

// A split cell: blank-ish when nothing left that way, so the column that matters stands out.
function SplitCell({ n }: { n: number }) {
  return (
    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
      {n > 0 ? n.toLocaleString('en-PH', { maximumFractionDigits: 2 }) : '—'}
    </td>
  );
}

function ConsumptionTable({
  rows, totalValue, days, stillBeingMade,
}: { rows: IngredientReportRow[]; totalValue: number; days: number; stillBeingMade: number }) {
  // Waiting tickets have used nothing yet; said, so a count taken while they wait is not a surprise.
  const waitingNote = stillBeingMade > 0 ? (
    <div className="px-4 sm:px-6 py-2 border-b border-border text-xs text-muted-foreground">
      {stillBeingMade.toLocaleString('en-PH', { maximumFractionDigits: 2 })} item{stillBeingMade === 1 ? '' : 's'} still
      being made at the kitchen or bar — not counted until marked ready.
    </div>
  ) : null;
  if (rows.length === 0) {
    return (
      <>
        {waitingNote}
        <div className="text-center text-muted-foreground text-sm py-12 px-4">
          Nothing left the shelf in this date range. Usage comes from sales (through each item&apos;s recipe, sizes and
          add-ons), prep batches and write-offs.
        </div>
      </>
    );
  }
  return (
    <>
      <ReconcileCallout
        label={`Value of ingredients that left the shelf over ${days} day${days === 1 ? '' : 's'}, at today's cost — sold, wasted (made, then voided or refunded), or written off. What went into preps is not in this total: the prep still holds that value, and it counts when the prep is used`}
        value={totalValue}
      />
      {waitingNote}
      <table className="w-full text-sm min-w-[720px]">
        <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border sticky top-0 z-10">
          <tr>
            {/* The name stays put while the numbers scroll sideways on a phone. */}
            <th className="px-4 sm:px-6 py-3 text-left font-semibold sticky left-0 bg-muted">Ingredient</th>
            <th className="px-3 py-3 text-right font-semibold">Sold</th>
            <th className="px-3 py-3 text-right font-semibold">Wasted</th>
            <th className="px-3 py-3 text-right font-semibold">Into preps</th>
            <th className="px-3 py-3 text-right font-semibold">Written off</th>
            <th className="px-4 py-3 text-right font-semibold">Total</th>
            <th className="px-4 py-3 text-right font-semibold">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40 transition-colors">
              <td className="px-4 sm:px-6 py-3 sticky left-0 bg-background">
                <IngredientNameCell id={r.id} name={r.name} isLowStock={r.isLowStock} />
              </td>
              <SplitCell n={r.soldQty} />
              <SplitCell n={r.wastedQty} />
              <SplitCell n={r.intoPrepsQty} />
              <SplitCell n={r.writtenOffQty} />
              <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground whitespace-nowrap">
                {qty(r.consumptionQty, r.unit)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground whitespace-nowrap">
                {r.costPrice > 0 ? peso(r.consumptionValue) : <span className="text-amber-600">— set cost</span>}
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
