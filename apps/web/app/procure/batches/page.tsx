'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChefHat, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Recording that a batch of something was made.
 *
 * The API for this has existed all along — define what one batch is made from,
 * see how many more you could make, record that you made some — and there was
 * no screen anywhere. Grepping the whole web app for `sub-recipes`,
 * `batchYield` or `/batches` returned nothing.
 *
 * The consequence is quiet and specific. A shop defines "House Syrup", the
 * cook makes five litres, and the sugar and water it was made from never move.
 * They never fall below their reorder level, never reach a buy list, and run
 * out mid-service while the system insists there are kilos on the shelf. The
 * syrup's own stock never goes up either, so every drink using it deducts from
 * a balance that was never replenished.
 */

interface Component {
  rawMaterialId: string;
  name:     string;
  unit:     string;
  quantity: number;
  onHand:   number;
  /** True when this component is itself something the shop preps. */
  isPrep:   boolean;
}

interface SubRecipe {
  id:         string;
  name:       string;
  unit:       string;
  costPrice:  number | null;
  batchYield: number | null;
  onHand:     number;
  /** Batches the shelf supports right now, with no prep in between. */
  batches:    number;
  /** What stops it right now — often another prep. */
  limitedBy:  string | null;
  /** Batches once the levels underneath are made first. */
  batchesWithPrep: number;
  /** The raw material that finally runs out, however deep it sits. */
  rootLimitedBy:   string | null;
  /** The path from this item down to that raw material. */
  limiterChain:    string[];
  /** Whether something below this has to be made before it can be. */
  needsPrep:       boolean;
  /**
   * 'MOVE' when this is the same thing in another state — a frozen tub thawed
   * onto the line — and 'MAKE' when it is cooked from other ingredients.
   * Inferred from the recipe, not configured: one component, itself a prep,
   * and the yield equals what goes in means nothing was added.
   */
  kind:            'MAKE' | 'MOVE';
  /** For a MOVE, what it comes from. */
  movesFrom:       string | null;
  /**
   * How many of each dish or drink this prep can still serve.
   *
   * The number the floor actually thinks in. Each line is a ceiling on its
   * own — several dishes share one prep and compete for it — so they are not
   * meant to be added up.
   */
  serves: Array<{
    productId:    string;
    productName:  string;
    perServing:   number;
    servingsLeft: number;
  }>;
  /** Which station preps this, inferred from the dishes it feeds. */
  station: { id: string; name: string; kind: string } | null;
  components: Component[];
}

const peso = (n: number | null | undefined) =>
  n == null ? '—' : '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function BatchesPage() {
  const qc = useQueryClient();
  const branchId = useAuthStore((s) => s.user?.branchId ?? '');
  const [target, setTarget] = useState<SubRecipe | null>(null);

  const { data: recipes = [], isLoading, isError, refetch } = useQuery<SubRecipe[]>({
    queryKey: ['sub-recipes', branchId],
    queryFn:  () => api.get('/inventory/sub-recipes', { params: { branchId } }).then((r) => r.data),
    enabled:  !!branchId,
  });

  /*
    Kitchen preps with kitchen preps, bar preps with the bar. Anything the
    routing cannot place goes last under its own heading rather than being
    silently dropped or guessed at.
  */
  const groups = (() => {
    const byStation = new Map<string, { label: string; items: SubRecipe[] }>();
    for (const r of recipes) {
      const key = r.station?.id ?? '~none';
      const label = r.station?.name ?? 'Not assigned to a station';
      const g = byStation.get(key) ?? { label, items: [] };
      g.items.push(r);
      byStation.set(key, g);
    }
    return [...byStation.values()].sort((a, b) =>
      a.label === 'Not assigned to a station' ? 1
      : b.label === 'Not assigned to a station' ? -1
      : a.label.localeCompare(b.label));
  })();

  const make = useMutation({
    /*
      Every submission carries its own key.

      Recording a batch is not something a person can SEE happening, and this
      screen is used on a phone in a kitchen: a double-tap, or a retry after
      the signal dropped, would consume the sugar twice and invent syrup nobody
      made. The server makes the same key only once and returns what the first
      attempt produced.
    */
    mutationFn: (v: { id: string; batches: number }) =>
      api.post(`/inventory/sub-recipes/${v.id}/batches`, {
        branchId,
        batches: v.batches,
        referenceNumber: (globalThis.crypto?.randomUUID?.() ?? `b-${v.id}-${Date.now()}`),
      }).then((r) => r.data),
    onSuccess: (d: { duplicate?: boolean }) => {
      qc.invalidateQueries({ queryKey: ['sub-recipes', branchId] });
      qc.invalidateQueries({ queryKey: ['raw-materials', branchId] });
      setTarget(null);
      toast.success(d?.duplicate
        ? 'Already recorded — nothing was made twice.'
        : 'Recorded — the ingredients it used have come off the shelf.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not record the batch.'),
  });

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-[var(--accent)]" />
          Prep &amp; Batches
        </h1>
        <p className="text-sm text-muted-foreground">
          Things you make in advance — syrups, sauces, stocks. Record a batch and
          the ingredients it used come off the shelf.
        </p>
      </header>

      {isError && (
        <div className="rounded-xl border border-border bg-card p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">Could not load prepared ingredients.</p>
          <button onClick={() => refetch()} className="text-sm font-medium text-[var(--accent)] hover:underline">
            Try again
          </button>
        </div>
      )}

      {!isError && isLoading && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {/*
        The empty state explains what this screen is FOR. A cook who has never
        seen a sub-recipe has no idea what "no prepared ingredients" means, and
        the recipe has to be defined elsewhere before anything can appear here.
      */}
      {!isError && !isLoading && recipes.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2">
          <p className="text-sm font-medium">Nothing is made in advance yet.</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            If you make something in bulk and portion it out later — a syrup, a
            sauce, a marinade — set it up as an ingredient and give it a recipe.
            It will show up here so the cook can record each batch, and the
            things it is made from will come off the shelf when they do.
          </p>
        </div>
      )}

      {/*
        Grouped by station, because the cook and the barista are different
        people looking for different things. The routing is inferred from the
        dishes each prep feeds — Category already points at a Station for
        kitchen and bar tickets — so nobody has to tag anything.
      */}
      {groups.map(({ label, items }) => (
        <section key={label} className="space-y-3">
          {groups.length > 1 && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </h2>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
        {items.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold truncate">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.onHand.toLocaleString('en-PH')} {r.unit} on hand
                  {r.costPrice != null && <> · {peso(r.costPrice)}/{r.unit}</>}
                </p>
              </div>
              {/*
                Two numbers, because they answer two different questions.

                "Ready now" is what the cook can start this minute. "After prep"
                is what the chain could yield once the levels underneath are
                made — which is the whole reason the shop preps ahead. Showing
                only the first tells someone they cannot make the finishing
                sauce while a full tub of base sits behind them.

                The second is only shown when it differs, so an ordinary
                one-level prep stays a single clean number.
              */}
              <div className="text-right shrink-0">
                <p className="font-display text-lg font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                  {r.batches}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {r.kind === 'MOVE' ? 'can thaw' : 'ready now'}
                </p>
                {r.needsPrep && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    <span className="font-semibold text-foreground tabular-nums">{r.batchesWithPrep}</span> after prep
                  </p>
                )}
              </div>
            </div>

            {/*
              Servings first, because that is the question being asked.
              "Enough for 10 plates" is what decides whether to prep now or
              after the rush; "15 batches" is a fact about the recipe.

              Each line is its own ceiling — two dishes sharing this prep are
              each told what they could serve if they had it all — so they are
              listed rather than totalled.
            */}
            {r.serves.length > 0 && (
              <div className="rounded-lg border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-2.5 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Enough on hand for
                </p>
                {r.serves.map((sv) => (
                  <div key={sv.productId} className="flex justify-between text-xs">
                    <span className="truncate pr-2">{sv.productName}</span>
                    <span className="tabular-nums shrink-0 font-semibold">
                      {sv.servingsLeft.toLocaleString('en-PH')}
                      <span className="font-normal text-muted-foreground">
                        {' '}{sv.servingsLeft === 1 ? 'serving' : 'servings'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg bg-muted/40 p-2.5 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {r.kind === 'MOVE'
                  ? `${r.batchYield ?? '—'} ${r.unit} from the ${r.movesFrom ?? 'backup'} — nothing added`
                  : `One batch makes ${r.batchYield ?? '—'} ${r.unit}, from`}
              </p>
              {r.components.map((c) => (
                <div key={c.rawMaterialId} className="flex justify-between text-xs">
                  <span className="text-muted-foreground truncate pr-2">
                    {c.name}
                    {/* A component you also MAKE is a level of the chain, not a
                        thing you buy. Saying so is what turns a flat list into
                        something a cook can reason about. */}
                    {c.isPrep && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-[var(--accent)]">
                        prep
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums shrink-0">
                    {c.quantity} {c.unit}
                    <span className="text-muted-foreground"> · {c.onHand.toLocaleString('en-PH')} left</span>
                  </span>
                </div>
              ))}
            </div>

            {/*
              Naming the limiter is the whole point of showing a count: "0
              batches" tells the cook to stop, "0 batches, short on brown
              sugar" tells them what to buy.
            */}
            {/*
              What to actually DO about it.

              "Short on mother sauce" is a puzzle; "make the base first" or
              "buy sugar" is an instruction. The chain is followed down to the
              raw material that genuinely runs out, so the message names
              something that can be bought rather than something that has to be
              made from something else that also has to be made.
            */}
            {r.batches === 0 && r.needsPrep && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Make {r.limitedBy} first — then you can do {r.batchesWithPrep}.
                  {r.limiterChain.length > 1 && (
                    <span className="block text-muted-foreground mt-0.5">
                      {r.limiterChain.join(' → ')}
                    </span>
                  )}
                </span>
              </p>
            )}
            {r.batches === 0 && !r.needsPrep && r.rootLimitedBy && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Out of {r.rootLimitedBy}. Nothing more can be made until it is
                  bought.
                  {r.limiterChain.length > 1 && (
                    <span className="block text-muted-foreground mt-0.5">
                      {r.limiterChain.join(' → ')}
                    </span>
                  )}
                </span>
              </p>
            )}

            <button
              onClick={() => setTarget(r)}
              disabled={r.batches === 0 || make.isPending}
              className="w-full rounded-lg bg-[var(--accent)] text-white text-sm font-semibold py-2 disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {r.kind === 'MOVE' ? 'Move it to the line' : 'I made some'}
            </button>
          </div>
        ))}
          </div>
        </section>
      ))}

      {target && (
        <MakeBatchModal
          recipe={target}
          pending={make.isPending}
          onCancel={() => setTarget(null)}
          onConfirm={(batches) => make.mutate({ id: target.id, batches })}
        />
      )}
    </div>
  );
}

function MakeBatchModal({
  recipe, pending, onCancel, onConfirm,
}: {
  recipe: SubRecipe;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (batches: number) => void;
}) {
  const [batches, setBatches] = useState('1');
  const n = parseInt(batches, 10) || 0;
  const tooMany = n > recipe.batches;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-lg">{recipe.name}</h2>
          <p className="text-sm text-muted-foreground">
            {recipe.kind === 'MOVE'
              ? 'How many did you move across?'
              : 'How many batches did you make?'}
          </p>
        </div>

        <input
          type="number" min={1} max={recipe.batches} step={1} autoFocus
          value={batches}
          onChange={(e) => setBatches(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-2xl font-bold text-center tabular-nums"
        />

        {/* What it will actually do, in the units the cook is holding. */}
        {n > 0 && !tooMany && (
          <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-xs">
            <p className="font-semibold">
              Adds {(n * (recipe.batchYield ?? 0)).toLocaleString('en-PH')} {recipe.unit} of {recipe.name}
            </p>
            <p className="text-muted-foreground">
              {recipe.kind === 'MOVE' ? 'and takes the same amount from:' : 'and takes off the shelf:'}
            </p>
            {recipe.components.map((c) => (
              <div key={c.rawMaterialId} className="flex justify-between">
                <span className="text-muted-foreground truncate pr-2">{c.name}</span>
                <span className="tabular-nums shrink-0">
                  {(c.quantity * n).toLocaleString('en-PH')} {c.unit}
                </span>
              </div>
            ))}
          </div>
        )}

        {tooMany && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            There are only enough ingredients for {recipe.batches}
            {recipe.limitedBy ? ` — ${recipe.limitedBy} runs out first.` : '.'}
          </p>
        )}

        <div className="flex gap-2">
          <button onClick={onCancel} disabled={pending} className="flex-1 rounded-lg border border-border py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(n)}
            disabled={pending || n < 1 || tooMany}
            className="flex-1 rounded-lg bg-[var(--accent)] text-white py-2 text-sm font-semibold disabled:opacity-40"
          >
            {pending ? 'Recording…' : 'Record it'}
          </button>
        </div>
      </div>
    </div>
  );
}
