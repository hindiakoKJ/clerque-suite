'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Plus, Trash2, ArrowLeft, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { INGREDIENT_UNITS } from '@repo/shared-types';

/**
 * Defining a prep — the step that had no screen anywhere.
 *
 * Every other piece of this existed. The API can define what a batch is made
 * from and what it yields; the prep board can show it and record batches
 * against it; the buy list, the ceiling and the nightly alert all read it. But
 * nothing in the web app ever called `PUT /inventory/sub-recipes/:id`, so the
 * only way to set one up was through the API by hand.
 *
 * That makes everything downstream theoretical. A shop cannot use the prep
 * board until something appears on it, and nothing appears on it until someone
 * writes a recipe. So the board sat empty, the cook kept prepping, and the
 * sugar the syrup was made from never moved.
 *
 * Two things are asked for here that are easy to skip and expensive to skip:
 *
 *   - The PAR LEVEL. A shop that rotates a ready tub and a parked tub needs to
 *     be told when the ready one is low enough to promote the parked one — and
 *     the parked one is EMPTY half the time by design, so "zero" cannot be the
 *     trigger. Without a par level nothing ever warns, and the first warning is
 *     a customer being told no.
 *
 *   - The RECIPE UNIT MATCHING. The quantity you enter for each component is in
 *     that component's own unit, which is shown beside the box rather than
 *     assumed, because a gram entered where a kilogram was meant is a
 *     thousandfold error that nothing downstream can detect.
 */

// One list, in @repo/shared-types. Two copies of the units a shop may pick
// from must agree: an ingredient created with a unit the other screen does
// not offer becomes uneditable there, and its recipes mismatch in silence.
const UNITS = INGREDIENT_UNITS;

/*
  Width is deliberately NOT part of this.

  The first version carried `w-full`, and inside the ingredient row that fought
  the row's own layout: the quantity box claimed the full width and refused to
  shrink, squashing the ingredient dropdown down to its chevron. Tailwind
  resolves two width utilities by stylesheet order, not by the order they are
  written, so appending `w-24` did not win. Every use below says how wide it is.
*/
const FIELD_CLS =
  'border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ' +
  'focus:border-transparent transition-shadow';
const INPUT_CLS = 'w-full ' + FIELD_CLS;

interface RawMaterial {
  id:            string;
  name:          string;
  unit:          string;
  costPrice:     number | null;
  lowStockAlert: number | null;
  isActive:      boolean;
}

interface SubRecipe {
  id:         string;
  name:       string;
  unit:       string;
  batchYield: number | null;
  components: Array<{ rawMaterialId: string; name: string; unit: string; quantity: number }>;
}

/** One line of the form. Quantities stay strings until save — a half-typed
 *  "0." is a valid thing to be holding and not a valid number. */
interface Line { rawMaterialId: string; quantity: string }

const NEW = '__new__';

export default function PrepSetupPage() {
  const qc = useQueryClient();
  const branchId = useAuthStore((s) => s.user?.branchId ?? '');
  const [editing, setEditing] = useState<SubRecipe | 'new' | null>(null);

  const { data: recipes = [], isLoading: loadingRecipes } = useQuery<SubRecipe[]>({
    queryKey: ['sub-recipes', branchId],
    queryFn:  () => api.get('/inventory/sub-recipes', { params: { branchId } }).then((r) => r.data),
    enabled:  !!branchId,
  });

  const { data: materials = [], isLoading: loadingMats } = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials', branchId],
    queryFn:  () => api.get('/inventory/raw-materials', { params: { branchId } }).then((r) => r.data),
    enabled:  !!branchId,
  });

  const byId = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="space-y-2">
        <Link
          href="/procure/batches"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to prep &amp; batches
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-[var(--accent)]" />
          Set up a prep
        </h1>
        <p className="text-sm text-muted-foreground">
          Anything you make in advance and then use like an ingredient — a syrup,
          a sauce, a stock. Once it is set up here, the cook or barista can record
          each batch and what it was made from comes off the shelf.
        </p>
      </header>

      {/* Same lie, same fix: the two queries here are branch-gated too, so a
          branchless account would have been told the shop preps nothing. */}
      {!branchId && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center space-y-2">
          <p className="text-sm font-medium">This account is not assigned to a branch.</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            Preps are set up against a branch, so this screen cannot load or save
            until your account belongs to one.
          </p>
        </div>
      )}

      {branchId && !editing && (
        <>
          <button
            onClick={() => setEditing('new')}
            className="w-full rounded-xl border border-dashed border-[var(--accent)]/50 bg-[var(--accent-soft)] p-4 text-sm font-semibold text-[var(--accent)] hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" /> Set up something you make
          </button>

          {(loadingRecipes || loadingMats) && (
            <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          )}

          {!loadingRecipes && !loadingMats && recipes.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2">
              <p className="text-sm font-medium">Nothing is set up yet.</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                Start with the one thing you prep most often. You will need to know
                what goes into one batch and roughly how much it makes.
              </p>
            </div>
          )}

          {recipes.map((r) => {
            const par = byId.get(r.id)?.lowStockAlert ?? null;
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      One batch makes {r.batchYield ?? '—'} {r.unit} · {r.components.length}{' '}
                      {r.components.length === 1 ? 'ingredient' : 'ingredients'}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditing(r)}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                </div>
                {/*
                  Said out loud on every card, because a prep with no par level
                  is the one that fails silently. Nothing warns, and the first
                  sign of trouble is an order that cannot be made.
                */}
                <p className="text-xs">
                  {par != null
                    ? <span className="text-muted-foreground">Warns below {par} {r.unit}</span>
                    : <span className="text-amber-700 dark:text-amber-400">
                        No warning level set — nothing will tell you when this runs low.
                      </span>}
                </p>
              </div>
            );
          })}
        </>
      )}

      {branchId && editing && (
        <PrepForm
          key={editing === 'new' ? 'new' : editing.id}
          existing={editing === 'new' ? null : editing}
          materials={materials}
          recipes={recipes}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['sub-recipes', branchId] });
            qc.invalidateQueries({ queryKey: ['raw-materials', branchId] });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PrepForm({
  existing, materials, recipes, onDone, onCancel,
}: {
  existing: SubRecipe | null;
  materials: RawMaterial[];
  recipes: SubRecipe[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const branchId = useAuthStore((s) => s.user?.branchId ?? '');
  const current = existing ? materials.find((m) => m.id === existing.id) ?? null : null;

  /*
    Which ingredient this prep IS.

    Two ways in, because both happen. "Spaghetti Sauce" may already be on the
    ingredient list from before anyone thought of it as a prep — turning that
    row into a prep keeps its stock, its cost and its history. Anything genuinely
    new gets created here.
  */
  const [targetId, setTargetId] = useState<string>(existing?.id ?? NEW);
  const [name, setName]         = useState(existing?.name ?? '');
  const [unit, setUnit]         = useState(existing?.unit ?? 'g');
  const [batchYield, setYield]  = useState(existing?.batchYield != null ? String(existing.batchYield) : '');
  const [par, setPar]           = useState(current?.lowStockAlert != null ? String(current.lowStockAlert) : '');
  const [lines, setLines]       = useState<Line[]>(
    existing && existing.components.length
      ? existing.components.map((c) => ({ rawMaterialId: c.rawMaterialId, quantity: String(c.quantity) }))
      : [{ rawMaterialId: '', quantity: '' }],
  );

  // Ids that already have a recipe: offering them as "turn this into a prep"
  // would silently overwrite the recipe they already have.
  const hasRecipe = useMemo(() => new Set(recipes.map((r) => r.id)), [recipes]);
  const convertible = useMemo(
    () => materials.filter((m) => m.isActive && !hasRecipe.has(m.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [materials, hasRecipe],
  );

  // The prep cannot be an ingredient of itself. The server refuses deeper loops
  // too — this only keeps the obvious one out of the dropdown.
  const selfId = existing?.id ?? (targetId === NEW ? null : targetId);
  const pickable = useMemo(
    () => materials.filter((m) => m.isActive && m.id !== selfId).sort((a, b) => a.name.localeCompare(b.name)),
    [materials, selfId],
  );
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);


  // Resolved once a name and unit are known, whichever way they were supplied.
  const chosen = targetId !== NEW ? byId.get(targetId) : undefined;
  const effName = chosen?.name ?? name.trim();
  const effUnit = chosen?.unit ?? unit;

  /*
    What goes in, added up — a starting point for the yield.

    Only meaningful where the components share the prep's own unit, which is
    the ordinary case for a sauce or a syrup (grams into grams, ml into ml).
    A recipe mixing units has no honest total, so nothing is offered rather
    than a number that silently adds millilitres to pieces.
  */
  const inputTotal = useMemo(() => {
    let total = 0;
    for (const l of lines) {
      const m = byId.get(l.rawMaterialId);
      const q = parseFloat(l.quantity);
      if (!m || !Number.isFinite(q)) return 0;
      if (m.unit !== effUnit) return 0;
      total += q;
    }
    return +total.toFixed(4);
  }, [lines, byId, effUnit]);

  /*
    Created-but-not-yet-defined.

    Setting up a NEW prep is two writes: create the ingredient, then give it a
    recipe. If the second fails, the first has already happened — and retrying
    from a blank form would create a SECOND ingredient with the same name,
    which is the one failure mode that quietly splits a shop's stock in two.
    Remembering the id means the retry updates instead.
  */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const yieldNum = parseFloat(batchYield);
      const parsed = lines
        .filter((l) => l.rawMaterialId)
        .map((l) => ({ rawMaterialId: l.rawMaterialId, quantity: parseFloat(l.quantity) }));

      // Checked here as well as on the server so the message arrives before
      // an ingredient has been created for a recipe that will be rejected.
      if (!effName) throw new Error('Give it a name — what do you call it in the kitchen?');
      if (!(yieldNum > 0)) throw new Error('Enter how much one batch makes.');
      if (parsed.length === 0) throw new Error('Add at least one ingredient that goes into it.');
      if (parsed.some((l) => !(l.quantity > 0))) throw new Error('Every ingredient needs a quantity.');
      const ids = parsed.map((l) => l.rawMaterialId);
      if (new Set(ids).size !== ids.length) {
        throw new Error('The same ingredient is listed twice — combine them into one line.');
      }

      const parNum = par.trim() === '' ? null : parseFloat(par);
      if (parNum != null && !(parNum >= 0)) throw new Error('The warning level cannot be negative.');

      let id = existing?.id ?? createdId ?? (targetId !== NEW ? targetId : null);
      if (!id) {
        const created = await api.post('/inventory/raw-materials', {
          name: effName,
          unit: effUnit,
          category: 'INGREDIENT',
          lowStockAlert: parNum,
        }).then((r) => r.data);
        id = created.id as string;
        setCreatedId(id);
      } else {
        // Name and unit are only editable for something created here; an
        // existing ingredient keeps its own, because changing a unit under a
        // recipe that was written in the old one is a silent mis-scaling.
        await api.patch(`/inventory/raw-materials/${id}`, {
          ...(existing || chosen ? {} : { name: effName, unit: effUnit }),
          lowStockAlert: parNum,
        });
      }

      await api.put(`/inventory/sub-recipes/${id}`, { batchYield: yieldNum, lines: parsed });
      return id;
    },
    onSuccess: () => {
      toast.success(existing
        ? 'Saved. Batches from now on will use the new recipe.'
        : 'Set up. It will show on the prep board for the cook to record batches against.');
      onDone();
    },
    onError: (e: any) => toast.error(
      e?.response?.data?.message ?? e?.message ?? 'Could not save it.',
    ),
  });

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, ix) => (ix === i ? { ...l, ...patch } : l)));

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-5">
      <h2 className="font-semibold">
        {existing ? `Edit ${existing.name}` : 'Set up a prep'}
      </h2>

      {/* ── What it is ─────────────────────────────────────────────────────── */}
      {!existing && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What is it?
          </label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className={INPUT_CLS}
          >
            <option value={NEW}>Something new</option>
            {convertible.map((m) => (
              <option key={m.id} value={m.id}>
                Already on my list — {m.name} ({m.unit})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            If it is already an ingredient you buy or count, pick it here — it keeps
            its stock and its cost history.
          </p>
        </div>
      )}

      {targetId === NEW && !existing && (
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Called
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="White Sugar Syrup"
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Measured in
            </label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT_CLS}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ── Yield ──────────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          One batch makes
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number" min={0} step="any" inputMode="decimal"
            value={batchYield}
            onChange={(e) => setYield(e.target.value)}
            placeholder="2000"
            className={INPUT_CLS}
          />
          <span className="text-sm text-muted-foreground w-16 shrink-0">{effUnit}</span>
        </div>
        {/*
          Nobody knows this before the first batch.

          The field is required, so a shop that has never weighed the pot cannot
          set the prep up at all -- and the natural response is to invent a
          round number, which then costs every future batch. What goes IN is a
          real starting point the shop already knows, and the cook corrects it
          the first time they measure what comes out.
        */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Do not know yet? Start from what goes in — the cook can measure the pot
            on the first batch and the number corrects itself.
          </p>
          {inputTotal > 0 && (
            <button
              type="button"
              onClick={() => setYield(String(inputTotal))}
              className="shrink-0 text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              Use {inputTotal.toLocaleString('en-PH')} {effUnit}
            </button>
          )}
        </div>
      </div>

      {/* ── Components ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What goes into one batch
        </label>
        {lines.map((l, i) => {
          const m = byId.get(l.rawMaterialId);
          return (
            <div key={i} className="flex items-center gap-2">
              <select
                value={l.rawMaterialId}
                onChange={(e) => setLine(i, { rawMaterialId: e.target.value })}
                className={FIELD_CLS + ' flex-1 min-w-0'}
              >
                <option value="">Pick an ingredient…</option>
                {pickable.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="number" min={0} step="any" inputMode="decimal"
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
                placeholder="0"
                className={FIELD_CLS + ' w-24 shrink-0 text-right tabular-nums'}
              />
              {/* The unit is SHOWN, never assumed. A gram typed where a kilo was
                  meant is a thousandfold error nothing downstream can catch. */}
              <span className="text-xs text-muted-foreground w-10 shrink-0">{m?.unit ?? ''}</span>
              <button
                onClick={() => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, ix) => ix !== i)))}
                disabled={lines.length === 1}
                aria-label="Remove this ingredient"
                className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => setLines((ls) => [...ls, { rawMaterialId: '', quantity: '' }])}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add another ingredient
        </button>
      </div>

      {/* ── Par level ──────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tell me when it drops below
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number" min={0} step="any" inputMode="decimal"
            value={par}
            onChange={(e) => setPar(e.target.value)}
            placeholder="500"
            className={INPUT_CLS}
          />
          <span className="text-sm text-muted-foreground w-16 shrink-0">{effUnit}</span>
        </div>
        {/*
          The single most skippable field here, and the one whose absence costs
          the most. Zero cannot be the trigger for a shop that keeps a backup
          batch: the backup is empty by design for half its life, so waiting for
          zero means waiting for the shortage itself.
        */}
        <p className="text-[11px] text-muted-foreground">
          The point where someone should start the next batch — while there is
          still enough on the line to serve from. Leave it blank and nothing will
          warn you.
        </p>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={save.isPending}
          className="flex-1 rounded-lg border border-border py-2.5 text-sm hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="flex-1 rounded-lg bg-[var(--accent)] text-white py-2.5 text-sm font-semibold disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Set it up'}
        </button>
      </div>
    </div>
  );
}
