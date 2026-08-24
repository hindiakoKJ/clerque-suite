'use client';
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, History, Loader2, PlayCircle, Search } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CatchupLine {
  rawMaterialId: string;
  name:          string;
  unit:          string;
  quantityUsed:  number;
  stockBefore:   number;
  stockAfter:    number;
  shortfall:     boolean;
}

interface CatchupProduct {
  productId: string;
  name:      string;
  unitsSold: number;
  hasRecipe: boolean;
}

interface CatchupPreview {
  from:            string;
  to:              string;
  branchId:        string;
  orderCount:      number;
  products:        CatchupProduct[];
  lines:           CatchupLine[];
  skippedNoRecipe: Array<{ productId: string; name: string; unitsSold: number }>;
  priorRuns:       Array<{ at: string; from: string; to: string; orderCount: number }>;
  warnings:        string[];
  applied?:        boolean;
}

const fmt = (n: number) =>
  n.toLocaleString('en-PH', { maximumFractionDigits: 4, minimumFractionDigits: 0 });

const dateOnly = (iso: string) => iso.slice(0, 10);

// ─── Page ───────────────────────────────────────────────────────────────────

/**
 * Recipe catch-up.
 *
 * The shop sold for weeks before its recipe book was finished. Those sales
 * deducted nothing from ingredient stock, because the products had no recipe
 * at the time. This screen replays them: it applies today's recipes to those
 * historical orders and writes the ingredient usage that was never recorded.
 *
 * The flow is deliberately two-step — preview, review, then apply — because
 * there is no way to undo it, and because including a product whose recipe
 * ALREADY existed at sale time would drain its ingredients a second time.
 */
export default function RecipeCatchupPage() {
  const today = new Date().toISOString().slice(0, 10);

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [preview, setPreview] = useState<CatchupPreview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState('');

  const bounds = () => ({
    from: new Date(`${from}T00:00:00`).toISOString(),
    to:   new Date(`${to}T23:59:59.999`).toISOString(),
  });

  // Step 1 — scan the window with no product filter, so every product that
  // sold in it is listed and the owner can tick the late-recipe ones.
  const scan = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<CatchupPreview>('/inventory/recipe-catchup/preview', bounds());
      return data;
    },
    onSuccess: (data) => {
      setPreview(data);
      setChosen(new Set(data.products.map((p) => p.productId)));
      setConfirmText('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not read that date range.'),
  });

  // Step 2 — recompute against only the ticked products.
  const recompute = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<CatchupPreview>('/inventory/recipe-catchup/preview', {
        ...bounds(),
        productIds: [...chosen],
      });
      return data;
    },
    onSuccess: (data) => setPreview((prev) => ({ ...data, products: prev?.products ?? data.products })),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not recompute.'),
  });

  const apply = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<CatchupPreview>('/inventory/recipe-catchup/apply', {
        ...bounds(),
        productIds: [...chosen],
        expectedOrderCount: preview!.orderCount,
      });
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Ingredient stock updated — ${data.lines.length} ingredient(s) adjusted.`);
      setPreview({ ...data, applied: true });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not apply the catch-up.', { duration: 10_000 }),
  });

  const busy = scan.isPending || recompute.isPending || apply.isPending;
  const applied = preview?.applied === true;

  // Lines shown always reflect the current tick-list, so the owner never
  // applies numbers that differ from what is on screen.
  const linesInScope = useMemo(() => preview?.lines ?? [], [preview]);
  const canApply =
    !!preview && !applied && chosen.size > 0 && linesInScope.length > 0 && confirmText.trim().toUpperCase() === 'CATCH UP';

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <div>
          <Link
            href="/pos/inventory"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
          >
            <ChevronLeft className="h-3 w-3" />
            Back to Ingredients
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Recipe Catch-Up</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sold before the recipe existed? Replay those orders so ingredient stock reflects what was actually used.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">

        {/* ─── Step 1: pick the window ─────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground mb-1">1. Which dates were missed?</h2>
          <p className="text-xs text-muted-foreground mb-3">
            From the day you started selling on Clerque, up to the day the recipes went in.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              <span className="block mb-1">From</span>
              <input
                type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="block mb-1">To</span>
              <input
                type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground"
              />
            </label>
            <button
              onClick={() => scan.mutate()}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {scan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Scan these dates
            </button>
          </div>
        </section>

        {preview && (
          <>
            {/* ─── Prior runs ────────────────────────────────────────── */}
            {preview.priorRuns.length > 0 && (
              <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                <div className="flex items-start gap-2">
                  <History className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-foreground">
                    <p className="font-semibold mb-1">These dates were already caught up.</p>
                    <ul className="space-y-0.5 text-muted-foreground">
                      {preview.priorRuns.map((r, i) => (
                        <li key={i}>
                          {dateOnly(r.from)} → {dateOnly(r.to)} · {r.orderCount} orders · applied {dateOnly(r.at)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5">Applying again over the same days would deduct the same ingredients twice, so it will be refused. Narrow the dates above.</p>
                  </div>
                </div>
              </section>
            )}

            {/* ─── Step 2: choose products ───────────────────────────── */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground mb-1">
                2. Which products had their recipe added late?
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Untick anything whose recipe already existed when it was sold — those already deducted their
                ingredients, and including them here would drain that stock a second time.
              </p>

              {preview.products.length === 0 ? (
                <p className="text-xs text-muted-foreground">No products with recipes sold in this range.</p>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      onClick={() => setChosen(new Set(preview.products.map((p) => p.productId)))}
                      className="text-xs text-primary hover:underline"
                    >
                      Select all
                    </button>
                    <button onClick={() => setChosen(new Set())} className="text-xs text-primary hover:underline">
                      Clear
                    </button>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {chosen.size} of {preview.products.length} selected
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {preview.products.map((p) => (
                      <label
                        key={p.productId}
                        className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-muted/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={chosen.has(p.productId)}
                          onChange={(e) => {
                            const next = new Set(chosen);
                            if (e.target.checked) next.add(p.productId);
                            else next.delete(p.productId);
                            setChosen(next);
                            setConfirmText('');
                          }}
                          className="rounded border-border"
                        />
                        <span className="flex-1 text-foreground">{p.name}</span>
                        <span className="text-muted-foreground">{fmt(p.unitsSold)} sold</span>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() => recompute.mutate()}
                    disabled={busy || chosen.size === 0}
                    className="mt-3 flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-60"
                  >
                    {recompute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    Recalculate for the ticked products
                  </button>
                </>
              )}

              {preview.skippedNoRecipe.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{preview.skippedNoRecipe.length} product(s)</span> sold in
                  this range still have no recipe ({preview.skippedNoRecipe.slice(0, 4).map((s) => s.name).join(', ')}
                  {preview.skippedNoRecipe.length > 4 ? ', …' : ''}). Add their recipes, then run this again for them.
                </p>
              )}
            </section>

            {/* ─── Step 3: review the numbers ────────────────────────── */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground mb-1">
                3. Ingredient usage to be recorded
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                {preview.orderCount} order(s) in range. Nothing is written until you apply below.
              </p>

              {preview.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-foreground">{w}</p>
                </div>
              ))}

              {linesInScope.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing to record for the current selection.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">Ingredient</th>
                        <th className="text-right font-medium px-3 py-2">Used</th>
                        <th className="text-right font-medium px-3 py-2">Stock now</th>
                        <th className="text-right font-medium px-3 py-2">After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {linesInScope.map((l) => (
                        <tr key={l.rawMaterialId} className={l.shortfall ? 'bg-amber-500/5' : undefined}>
                          <td className="px-3 py-2 text-foreground">
                            {l.name}
                            {l.shortfall && (
                              <span className="ml-1.5 text-amber-600" title="More usage than stock on hand — floors at zero">
                                ⚠
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-foreground">{fmt(l.quantityUsed)} {l.unit}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{fmt(l.stockBefore)}</td>
                          <td className="px-3 py-2 text-right font-medium text-foreground">{fmt(l.stockAfter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ─── Step 4: apply ─────────────────────────────────────── */}
            {applied ? (
              <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
                <p className="text-sm font-semibold text-foreground">Catch-up applied.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Ingredient stock now reflects those {preview.orderCount} order(s). From here on, every sale of a
                  product with a recipe deducts its ingredients automatically — this screen is only for the backlog.
                </p>
              </section>
            ) : (
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground mb-1">4. Apply</h2>
                <p className="text-xs text-muted-foreground mb-3">
                  This rewrites ingredient balances and cannot be undone. Type <strong>CATCH UP</strong> to confirm.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="CATCH UP"
                    className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground w-40"
                  />
                  <button
                    onClick={() => apply.mutate()}
                    disabled={!canApply || busy}
                    className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {apply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                    Apply catch-up
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
