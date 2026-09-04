'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChefHat, AlertTriangle, Settings2, Check, SlidersHorizontal, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatUnitCost } from '@/lib/utils';

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

/** A place in the shop that preps: the kitchen, the bar. */
interface Station { id: string; name: string; kind: string }

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
  /**
   * The level at which the next batch should be started, and whether it is
   * time. Null when nobody has set one — which is worth SAYING, because an
   * unset par level means nothing will ever warn.
   */
  parLevel: number | null;
  belowPar: boolean;
  /**
   * Where this sits in the rotation.
   *
   *   1  ready to use, on the line
   *   2  prepared and parked, waiting to be thawed into Level 1
   *
   * Level 3 — the raw ingredients already at the station — is not a card. It
   * is the component list on each one. Null when a prep is neither, which is a
   * genuine multi-step cook rather than this rotation.
   */
  level: 1 | 2 | null;
  /** Which station preps this, inferred from the dishes it feeds. */
  station: { id: string; name: string; kind: string } | null;
  components: Component[];
}

// Was a hand-rolled formatter with the peso sign and en-PH baked in, which
// ignored the tenant currency setDisplayCurrency exists to honour. The FOUR
// decimals were the legitimate part -- an ingredient costs PHP 0.0549 per ml
// and rounding that to two is a 9% error -- so that moved into the shared
// helper rather than being dropped.
const peso = formatUnitCost;

export default function BatchesPage() {
  const qc = useQueryClient();
  const branchId = useAuthStore((s) => s.user?.branchId ?? '');
  const role     = useAuthStore((s) => s.user?.role ?? '');
  // Matches the API: defining a recipe is BUSINESS_OWNER / MDM only. Showing
  // the link to anyone else would offer a screen whose every Save is a 403.
  const canSetUp = role === 'BUSINESS_OWNER' || role === 'MDM';
  const [target, setTarget] = useState<SubRecipe | null>(null);
  /*
    Which card is mid-flight, and which has just finished.

    The modal used to be the throttle: a cook could not double-record because
    the second tap landed on a dialog. Taking it away for the one-tap case
    takes that protection with it, and this screen is used on a phone with wet
    hands next to a hob. So the card locks itself while the request is in
    flight and stays locked, showing what happened, for a couple of seconds
    after -- long enough that a fumbled double-tap cannot make two batches, and
    short enough that a cook who genuinely made a second one is not waiting.

    Per card rather than global: the barista starting a syrup should not freeze
    the button the cook is reaching for.
  */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current); }, []);

  /*
    The guard that actually holds, in a ref rather than in state.

    Disabling the button on `busyId` looked sufficient and is not: setting
    state does not re-render within the same tick, so three taps landing
    inside one frame all read the old value, all pass the check, and all three
    fire. Three batches, three lots, three times the sugar off the shelf --
    from one fumbled tap on a phone with wet hands. The modal used to absorb
    this by being in the way; taking it away for the one-tap case took the
    protection with it.

    A ref is written and read synchronously, so the second tap in the same
    frame sees the first. Keyed per prep and stamped with a time, so the
    barista's syrup does not lock the cook's sauce and a genuine second batch
    a minute later still goes through.
  */
  const lockRef = useRef<Record<string, number>>({});
  const TAP_LOCK_MS = 2500;

  /*
    The stations this shop actually has.

    Read from the floor layout, which every role can already see -- the cook's
    account included -- so asking "kitchen or bar?" needs no new endpoint and
    no new permission. A shop with one station is never asked.
  */
  const { data: layout } = useQuery<{ stations?: Station[] }>({
    queryKey: ['layout'],
    queryFn:  () => api.get('/layouts').then((r) => r.data),
    staleTime: 600_000,
  });
  /*
    Every station the shop has, not a list of the ones we expected it to have.

    This used to whitelist KITCHEN / BAR / HOT_BAR / COLD_BAR, which quietly
    dropped the two kinds the layouts actually create at the ends of the range:
    COUNTER (the only station at a CS-1 or CS-2 shop) and PASTRY_PASS (created
    by CS-5). Filtering a station out here does not just hide it -- it makes
    `stations.length` read 1, so the "Who made it?" question stops being asked
    and every batch is silently booked to whichever station survived the
    filter. A wrong attribution that nobody was asked about is the worst of
    the three possible outcomes.

    The shop's own setup is the list. Nothing to keep in step.
  */
  const stations = layout?.stations ?? [];

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
    mutationFn: (v: { id: string; batches: number; shelfLifeDays?: number; stationId?: string; actualYield?: number }) =>
      api.post(`/inventory/sub-recipes/${v.id}/batches`, {
        branchId,
        batches: v.batches,
        // Omitted rather than sent as null when the shop does not track it, so
        // an untracked prep behaves exactly as it did before this existed.
        ...(v.shelfLifeDays ? { shelfLifeDays: v.shelfLifeDays } : {}),
        /*
          Which side of the shop used the ingredients.

          Sugar goes into the bar's syrup and the kitchen's glaze off the same
          shelf, and once it is gone the two cannot be told apart. Sent when
          the prep belongs to one station, or when the cook picked one for a
          prep that serves both.
        */
        ...(v.stationId ? { stationId: v.stationId } : {}),
        /*
          What actually came out, when the cook weighed it.

          The recipe's yield is a figure somebody estimated at setup, often
          before the sauce had ever been made. A measurement replaces it for
          this batch and makes the cost per unit true in the same stroke --
          cost is inputs divided by output, so a pot that reduced further is
          genuinely more concentrated and genuinely costs more per ml.
        */
        ...(v.actualYield ? { actualYield: v.actualYield } : {}),
        referenceNumber: (globalThis.crypto?.randomUUID?.() ?? `b-${v.id}-${Date.now()}`),
      }).then((r) => r.data),
    onMutate: (v) => { setBusyId(v.id); },
    onSuccess: (d: { duplicate?: boolean; produced?: number; unit?: string; name?: string;
                     yieldVariance?: number | null }, v) => {
      qc.invalidateQueries({ queryKey: ['sub-recipes', branchId] });
      qc.invalidateQueries({ queryKey: ['raw-materials', branchId] });
      setTarget(null);
      // Held for a moment so a fumbled second tap lands on a locked card.
      setDoneId(v.id);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setDoneId(null), 2500);
      /*
        Say when the pot did not match the recipe.

        A drift is the shop learning something -- the yield on file is wrong, or
        this batch reduced further than usual -- and it is only visible in the
        moment somebody measured. Silence here would let the setup figure stay
        wrong forever while the cook stands there holding the evidence.
      */
      const drift = d?.yieldVariance;
      const driftNote = drift != null && Math.abs(drift) >= 0.05
        ? ` That is ${Math.abs(Math.round(drift * 100))}% ${drift > 0 ? 'more' : 'less'} than the recipe says — worth updating if it keeps happening.`
        : '';
      toast.success(d?.duplicate
        ? 'Already recorded — nothing was made twice.'
        : d?.produced != null
          ? `Added ${d.produced.toLocaleString('en-PH')} ${d.unit ?? ''} — the ingredients came off the shelf.${driftNote}`
          : 'Recorded — the ingredients it used have come off the shelf.',
        driftNote ? { duration: 9000 } : undefined);
    },
    onError: (e: any, v) => {
      // A batch that did not happen must be re-tappable at once. Holding the
      // lock after a failure would make the cook wait to retry something that
      // never took.
      delete lockRef.current[v.id];
      toast.error(e?.response?.data?.message ?? 'Could not record the batch.');
    },
    onSettled: () => setBusyId(null),
  });

  /*
    A prep that feeds both sides of the shop has to ASK.

    Most do not: the station is inferred from the dishes a prep feeds, so a
    spaghetti sauce is the kitchen's and a syrup is the bar's and neither is
    ever asked about. But some ingredients genuinely serve both, and guessing
    would file the kitchen's sugar under the bar. Only then, and only when the
    shop has more than one station, is one tap worth two.
  */
  const [asking, setAsking] = useState<SubRecipe | null>(null);

  /** Claims the lock, or returns false when this prep was just tapped. */
  const claim = (id: string) => {
    const now = Date.now();
    const last = lockRef.current[id] ?? 0;
    if (now - last < TAP_LOCK_MS) return false;
    lockRef.current[id] = now;
    return true;
  };

  const oneTap = (r: SubRecipe) => {
    if (!claim(r.id)) return;
    if (r.station) return make.mutate({ id: r.id, batches: 1, stationId: r.station.id });
    if (stations.length > 1) {
      // The sheet is its own throttle, and the cook has not committed to
      // anything yet -- so release the lock rather than making them wait.
      delete lockRef.current[r.id];
      return setAsking(r);
    }
    // One station, or none set up: nothing to ask and nothing to guess wrong.
    make.mutate({ id: r.id, batches: 1, stationId: stations[0]?.id });
  };

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
        {canSetUp && (
          <Link
            href="/procure/batches/setup"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
          >
            <Settings2 className="h-3.5 w-3.5" /> Set up what you prep
          </Link>
        )}
      </header>

      {isError && (
        <div className="rounded-xl border border-border bg-card p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">Could not load prepared ingredients.</p>
          <button onClick={() => refetch()} className="text-sm font-medium text-[var(--accent)] hover:underline">
            Try again
          </button>
        </div>
      )}

      {/*
        A screen that has not LOOKED must not report that there is nothing.

        Both queries are gated on `enabled: !!branchId`, so an account with no
        branch -- a super admin, or anyone never assigned to one -- never fired
        them at all. React Query then reports an empty list that is not loading,
        and the empty state below said "Nothing is made in advance yet" with
        total confidence about a question it had never asked. The shop reads
        that as "the feature is broken" or, worse, as "our preps are gone".

        Said plainly instead, with the fix, because the person seeing this
        cannot act on it themselves.
      */}
      {!branchId && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center space-y-2">
          <p className="text-sm font-medium">This account is not assigned to a branch.</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            Prep is counted per branch, so there is nothing to show until your
            account belongs to one. An owner can set that on the Staff screen —
            this is not a problem with your preps.
          </p>
        </div>
      )}

      {branchId && !isError && isLoading && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {/*
        The empty state explains what this screen is FOR. A cook who has never
        seen a sub-recipe has no idea what "no prepared ingredients" means, and
        the recipe has to be defined elsewhere before anything can appear here.
      */}
      {branchId && !isError && !isLoading && recipes.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2">
          <p className="text-sm font-medium">Nothing is made in advance yet.</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            If you make something in bulk and portion it out later — a syrup, a
            sauce, a marinade — set it up as an ingredient and give it a recipe.
            It will show up here so the cook can record each batch, and the
            things it is made from will come off the shelf when they do.
          </p>
          {/* The empty state used to describe a screen that did not exist.
              Whoever can act on it now gets taken there. */}
          {canSetUp ? (
            <Link
              href="/procure/batches/setup"
              className="inline-block rounded-lg bg-[var(--accent)] text-white text-sm font-semibold px-4 py-2 hover:opacity-90 transition-opacity"
            >
              Set one up
            </Link>
          ) : (
            /*
              Naming who can do it is the whole point of an empty state the
              reader cannot act on. A cook staring at "nothing here" with no
              button has no way to tell whether the shop has not set this up
              yet, or whether they are simply not allowed to -- and the two call
              for completely different next moves.
            */
            <p className="text-xs text-muted-foreground">
              Setting up a prep is the owner&rsquo;s job. Once they have, each batch
              you make gets recorded here.
            </p>
          )}
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
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold truncate">{r.name}</p>
                  {/*
                    The level, said out loud on the card.

                    The shop already thinks in these three and says them to each
                    other; the screen not saying them was the gap. Derived from
                    the recipes rather than typed in, so it cannot drift out of
                    step with what is actually made from what.
                  */}
                  {r.level != null && (
                    <span
                      title={r.level === 1
                        ? 'Level 1 — ready to use, on the line'
                        : 'Level 2 — prepared and parked, waiting to be thawed'}
                      className={'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide '
                        + (r.level === 1
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'bg-muted text-muted-foreground')}
                    >
                      L{r.level}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.level === 1 ? 'Ready to use · ' : r.level === 2 ? 'Parked · ' : ''}
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
            {/*
              Time to start the next one.

              Deliberately louder than "0 batches left", because it fires while
              there is still something on the line — which is the only moment
              when starting a batch actually prevents the shortage. By the time
              the count is zero the decision has already been made for you.
            */}
            {r.belowPar && r.onHand > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Down to {r.onHand.toLocaleString('en-PH')} {r.unit} — time to
                  {r.kind === 'MOVE' ? ' move the next one across' : ' make the next batch'}.
                </span>
              </p>
            )}
            {/*
              An unset par level is not a quiet default, it is a silent one:
              nothing on this screen and nothing in the nightly alert will ever
              mention this prep until it hits zero mid-service. Only shown to
              whoever can fix it.
            */}
            {r.parLevel == null && canSetUp && (
              <p className="text-[11px] text-muted-foreground">
                No level set — nothing will tell you when this is running low.{' '}
                <Link href="/procure/batches/setup" className="text-[var(--accent)] hover:underline">
                  Set one
                </Link>
              </p>
            )}

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

            {/*
              ONE TAP.

              This used to open a dialog asking how many batches, with the
              answer already filled in as 1 -- so the overwhelmingly common
              case cost two taps and a read, on a phone, mid-service, to say
              something the screen already knew. A batch has a fixed size that
              was decided at setup; the cook is reporting that they made one,
              not configuring anything.

              The dialog is still there behind the second button, for the
              cook who made three at once or wants to say how long it keeps.
              Nothing was removed, it stopped being compulsory.
            */}
            <div className="flex gap-2">
              <button
                onClick={() => oneTap(r)}
                disabled={r.batches === 0 || busyId === r.id || doneId === r.id}
                className="flex-1 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold py-2.5 disabled:opacity-40 hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-1.5"
              >
                {busyId === r.id ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Recording…</>
                ) : doneId === r.id ? (
                  <><Check className="h-4 w-4" /> Done</>
                ) : (
                  r.kind === 'MOVE'
                    ? `Move ${r.batchYield ?? ''} ${r.unit} to the line`
                    : `Made ${r.batchYield ?? ''} ${r.unit}`
                )}
              </button>
              {/* The way out for anything that is not the usual one batch. */}
              <button
                onClick={() => setTarget(r)}
                disabled={r.batches === 0 || busyId === r.id}
                aria-label="Record a different amount, or say how long it keeps"
                title="A different amount, or how long it keeps"
                className="shrink-0 rounded-lg border border-border px-3 text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
          </div>
        </section>
      ))}

      {asking && (
        <WhoMadeIt
          recipe={asking}
          stations={stations}
          onPick={(stationId) => {
            make.mutate({ id: asking.id, batches: 1, stationId });
            setAsking(null);
          }}
          onCancel={() => setAsking(null)}
        />
      )}

      {target && (
        <MakeBatchModal
          recipe={target}
          pending={make.isPending}
          onCancel={() => setTarget(null)}
          stations={stations}
          defaultStationId={target.station?.id ?? (stations.length === 1 ? stations[0].id : undefined)}
          onConfirm={(batches, shelfLifeDays, stationId, actualYield) =>
            make.mutate({ id: target.id, batches, shelfLifeDays, stationId, actualYield })}
        />
      )}
    </div>
  );
}

function MakeBatchModal({
  recipe, pending, stations, defaultStationId, onCancel, onConfirm,
}: {
  recipe: SubRecipe;
  pending: boolean;
  stations: Station[];
  defaultStationId?: string;
  onCancel: () => void;
  onConfirm: (batches: number, shelfLifeDays?: number, stationId?: string, actualYield?: number) => void;
}) {
  const [batches, setBatches] = useState('1');
  const [stationId, setStationId] = useState(defaultStationId ?? '');
  const [measured, setMeasured] = useState('');
  const [days, setDays] = useState('');
  const n = parseInt(batches, 10) || 0;
  const d = parseInt(days, 10) || 0;
  const tooMany = n > recipe.batches;

  /*
    Counted forward from now, and shown, because "5 days" and "good until
    Saturday" are not the same thought — the cook is deciding whether that is
    before or after the weekend rush.
  */
  const goodUntil = d > 0
    ? new Date(Date.now() + d * 86400000).toLocaleDateString('en-PH',
        { weekday: 'short', month: 'short', day: 'numeric' })
    : null;

  /** What the recipe expects for this many batches, and what the cook read. */
  const expectedTotal = (recipe.batchYield ?? 0) * (n || 1);
  const measuredNum   = parseFloat(measured) || 0;

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

        {/*
          What actually came out.

          The yield on file was estimated at setup -- often before the sauce had
          ever been made -- and nothing ever corrected it. Measuring the pot once
          fixes both the stock figure and the cost per unit, because cost is
          simply what went in divided by what came out.

          Optional and blank by default: a cook who did not weigh it leaves it
          alone and gets exactly the old behaviour.
        */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Measured what came out? <span className="font-normal normal-case">(optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number" min={0} step="any" inputMode="decimal"
              value={measured}
              onChange={(e) => setMeasured(e.target.value)}
              placeholder={String(expectedTotal || '')}
              className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-right tabular-nums"
            />
            <span className="text-xs text-muted-foreground">
              {recipe.unit}
              {measuredNum > 0 && expectedTotal > 0 && Math.abs(measuredNum - expectedTotal) / expectedTotal >= 0.05
                ? ` · ${Math.abs(Math.round(((measuredNum - expectedTotal) / expectedTotal) * 100))}% ${measuredNum > expectedTotal ? 'more' : 'less'} than the recipe says`
                : ` · recipe says ${expectedTotal.toLocaleString('en-PH')}`}
            </span>
          </div>
        </div>

        {/* Who used the ingredients, when the shop has more than one station. */}
        {stations.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Made in
            </label>
            <select
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Not saying</option>
              {stations.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </div>
        )}

        {/*
          How long it keeps.

          A prepared batch had no expiry at all: a tub thawed today and one
          thawed three weeks ago were the same row, so nothing could warn and
          the oldest-first rule had nothing to sort by. It bites hardest on the
          batch that is only PARTLY used, which is the one most likely to spoil
          precisely because it is not finished in a day.

          Optional. A shop that does not track this leaves it blank and nothing
          changes.
        */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Good for how many days? <span className="font-normal normal-case">(optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} step={1} inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="—"
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-center tabular-nums"
            />
            <span className="text-xs text-muted-foreground">
              {goodUntil ? `Good until ${goodUntil}` : 'Leave blank if you do not track it'}
            </span>
          </div>
        </div>

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
            onClick={() => onConfirm(n, d > 0 ? d : undefined, stationId || undefined,
              measuredNum > 0 ? measuredNum : undefined)}
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

/**
 * "Kitchen or bar?" — asked only when it genuinely cannot be known.
 *
 * A prep's station is inferred from the dishes it feeds, so almost nothing
 * reaches this. What does are the ingredients both halves of the shop share,
 * and those are exactly the ones where guessing would be wrong: the sugar in
 * the bar's syrup and the sugar in the kitchen's glaze come off the same
 * shelf, and once it is gone the two cannot be told apart afterwards.
 *
 * Deliberately big targets and no typing. This is a phone, held next to a hob,
 * by someone with one free hand.
 */
function WhoMadeIt({
  recipe, stations, onPick, onCancel,
}: {
  recipe: SubRecipe;
  stations: Station[];
  onPick: (stationId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-lg">{recipe.name}</h2>
          <p className="text-sm text-muted-foreground">Who made it?</p>
        </div>
        <div className="grid gap-2">
          {stations.map((st) => (
            <button
              key={st.id}
              onClick={() => onPick(st.id)}
              className="w-full rounded-xl border border-border bg-card py-4 text-base font-semibold hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors"
            >
              {st.name}
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="w-full rounded-lg border border-border py-2 text-sm hover:bg-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}
