'use client';
/**
 * Prep levels on the station screen: every pre-made item this station looks
 * after, worst first, readable from across the kitchen or the bar.
 *
 * Each dish's sauce comes first as a chain card (PrepChainCard): Level 1 the
 * tub plates are served from, Level 2 behind it, Level 3 behind that, with the
 * one thing to do and a button to record it. The server reads the stages and
 * words the instruction (sub-recipes/prep-chain.ts), the same words the bell
 * alerts use. Anything not part of a chain is still a tile: past its use-by,
 * out, needs moving or cooking now, due soon, low, fine, and no par set
 * (@repo/shared-types prep-station and prep-rotation). Items routed to no
 * station are shown apart underneath, since they belong to whoever the shop
 * decides.
 *
 * The chain card's button records one batch from the tablet itself. It used
 * to be read-only, so a cook who had just refilled the line had to find a
 * phone and the prep board to say so -- and mostly did not, so the next alert
 * asked for work already done. The server still checks the station and who
 * paired the tablet.
 *
 * `compact` is the quarter-width column beside the orders: what needs doing
 * as small cards, what is fine as one line each.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Snowflake, UtensilsCrossed } from 'lucide-react';
import {
  rotationInstruction, useBySentences, PREP_STATUS_LABEL, PREP_STATUS_ORDER,
  type PrepStatus, type RotationRow, type UseBy,
} from '@repo/shared-types';
import { api } from '@/lib/api';
import { MadeButton, PrepChainCard, type PrepChain, type StageNote } from './PrepChainCard';
import { tileMadeLabel } from './station-taps';

interface PrepRow {
  id: string;
  name: string;
  unit: string;
  level: 1 | 2 | null;
  kind: 'MAKE' | 'MOVE';
  movesFrom: string | null;
  onHand: number;
  parLevel: number | null;
  status: PrepStatus;
  useBy: UseBy;
  rotation: RotationRow | null;
  batches: number;
  limitedBy: string | null;
  rootLimitedBy: string | null;
  batchesWithPrep?: number;
  serves: { productName: string; servingsLeft: number } | null;
  assigned: boolean;
  /** Steps from a dish: 1 served from, 2 refills it, 3 makes that. Null when no dish reaches it. */
  depth: number | null;
  /** The chain card this item is drawn inside, when it is a stage of one. */
  inChain: string | null;
}
interface StationPrep {
  station: { id: string; name: string; kind: string };
  branchName: string;
  at: string;
  rows: PrepRow[];
  /** Worst first: act now, then next, then fine; unrouted after this station's own. */
  chains: PrepChain[];
}

const TONE: Record<PrepStatus, string> = {
  EXPIRED: 'border-red-500 bg-red-500/15',
  OUT:     'border-red-500 bg-red-500/10',
  DO_NOW:  'border-amber-400 bg-amber-500/10',
  SOON:    'border-orange-400 bg-orange-500/10',
  LOW:     'border-sky-400 bg-sky-500/10',
  OK:      'border-emerald-600/60 bg-emerald-500/5',
  NO_PAR:  'border-stone-700 bg-stone-900',
};
const CHIP: Record<PrepStatus, string> = {
  EXPIRED: 'bg-red-500 text-white',
  OUT:     'bg-red-500 text-white',
  DO_NOW:  'bg-amber-400 text-stone-950',
  SOON:    'bg-orange-400 text-stone-950',
  LOW:     'bg-sky-400 text-stone-950',
  OK:      'bg-emerald-600 text-white',
  NO_PAR:  'bg-stone-700 text-stone-200',
};
/** The coloured edge of a compact card. */
const EDGE: Record<PrepStatus, string> = {
  EXPIRED: 'border-red-500',
  OUT:     'border-red-500',
  DO_NOW:  'border-amber-400',
  SOON:    'border-orange-400',
  LOW:     'border-sky-400',
  OK:      'border-emerald-600',
  NO_PAR:  'border-stone-700',
};
const FINE = new Set<PrepStatus>(['OK', 'NO_PAR']);

const amount = (n: number, unit: string) => `${Math.max(0, n).toLocaleString('en-PH', { maximumFractionDigits: 1 })} ${unit}`;

/** What to do, in one line: the rotation's words for a ready-to-use item, otherwise from its own numbers. */
function todo(r: PrepRow): string | null {
  if (r.rotation) {
    const said = rotationInstruction(r.rotation);
    if (said) return said;
  }
  // From the numbers, not the chip: a backup under par whose tub is also due soon still needs its next batch.
  if (r.onHand <= 0 || (r.parLevel != null && r.onHand <= r.parLevel)) {
    if (r.batches > 0) return r.kind === 'MOVE' && r.movesFrom ? `Move a batch across from ${r.movesFrom}.` : 'Make a batch.';
    if (r.limitedBy) return r.batchesWithPrep && r.batchesWithPrep > 0 ? `Make ${r.limitedBy} first.` : `Out of ${r.rootLimitedBy ?? r.limitedBy}. Buy it first.`;
  }
  return null;
}

/*
  A pre-made item that is not inside a chain card gets its own "Made" button,
  so a batch made ahead -- wings marinated overnight, a sauce cooked before the
  rush -- is recorded when it is made and not once the tub runs low. Until the
  tap the raw stock stays too high on the books and the day's sheet is wrong.
  The button only shows when there is enough on hand for one batch (the server
  would refuse it otherwise), and big only when the item needs doing now.

  Every row here is this station's or routed to none, which is exactly what the
  Made route lets this screen record.
*/
const madeButton = (r: PrepRow, stationId: string, compact = false) => {
  const label = tileMadeLabel(r);
  if (!label) return null;
  return (
    <MadeButton
      stationId={stationId}
      rawMaterialId={r.id}
      label={label}
      uses={null}
      tone={todo(r) != null ? 'primary' : 'secondary'}
      compact={compact}
    />
  );
};

export function StationPrepLevels({
  stationId, enabled, onNewRed, visible = true, compact = false,
}: { stationId: string; enabled: boolean; onNewRed?: () => void; visible?: boolean; compact?: boolean }) {
  const { data, isPending, isError, error, dataUpdatedAt, isFetching } = useQuery<StationPrep>({
    queryKey: ['kds-prep', stationId],
    queryFn:  () => api.get(`/kds/stations/${stationId}/prep`).then((r) => r.data),
    enabled,
    // The line moves with every sale; a minute is fresh enough to act on.
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  /*
    The bell rings when a sauce turns to "do it now" (its Level 1 needs action),
    or when a batch passes its use-by. Not when things get better, and not when
    the same instruction just gets more urgent: a chain already at "now" stays
    one key however low it goes, so a busy lunch does not ring every minute and
    teach the kitchen to ignore the bell. The first load only seeds. This runs
    whichever view is showing -- the screen stays mounted, hidden, behind the
    orders.
  */
  const seenKeys = useRef<Set<string> | null>(null);
  const ring = useRef(onNewRed);
  ring.current = onNewRed;
  useEffect(() => {
    if (!data) return;
    const keys = new Set([
      ...(data.chains ?? []).filter((c) => c.severity === 'NOW').map((c) => `chain:${c.id}`),
      ...data.rows.filter((r) => r.status === 'EXPIRED').map((r) => `row:${r.id}`),
    ]);
    const prev = seenKeys.current;
    if (prev && [...keys].some((k) => !prev.has(k))) ring.current?.();
    seenKeys.current = keys;
  }, [data]);

  if (!visible) return null;
  if (isPending) {
    return (
      <div className={`flex items-center justify-center gap-2 text-stone-400 ${compact ? 'py-8 text-sm' : 'py-32'}`}>
        <Loader2 className={compact ? 'h-4 w-4 animate-spin' : 'h-5 w-5 animate-spin'} /> Loading prep levels…
      </div>
    );
  }
  // A failed refresh keeps the last good tiles, and says so; only no data at all is an error screen.
  if (!data) {
    const message = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;
    return (
      <div className={`flex flex-col items-center justify-center text-center text-stone-400 ${compact ? 'py-8' : 'py-32'}`}>
        <AlertTriangle className={`text-amber-400 ${compact ? 'mb-2 h-6 w-6' : 'mb-3 h-10 w-10'}`} />
        <p className={`font-semibold text-white ${compact ? 'text-sm' : 'text-lg'}`}>Could not load prep levels</p>
        <p className={`mt-1 ${compact ? 'text-xs' : 'text-sm'}`}>{message ?? 'Check the connection. It tries again every minute.'}</p>
      </div>
    );
  }

  const now = new Date(data.at);
  // Older API answers carry no chains; every item is then a tile, as before.
  const chains = data.chains ?? [];
  // An item drawn inside a chain card is not drawn again as its own tile.
  const free = data.rows.filter((r) => r.inChain == null);
  const mine = free.filter((r) => r.assigned);
  const loose = free.filter((r) => !r.assigned);
  // A stage's use-by warnings go inside its chain card, so a tub past its date still says so there.
  const notes: Record<string, StageNote[]> = {};
  for (const r of data.rows) {
    if (r.inChain == null) continue;
    const lines = useBySentences(r.useBy, r.unit, now);
    if (lines.length) notes[r.id] = lines.map((text) => ({ text, past: !!r.useBy.expired && text.includes('past') }));
  }
  const acting = chains.filter((c) => c.severity !== 'OK');
  const settled = chains.filter((c) => c.severity === 'OK');
  const updated = isFetching
    ? 'Refreshing…'
    : `${isError ? 'Could not refresh — showing' : 'Updated'} ${new Date(dataUpdatedAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })}`;
  if (data.rows.length === 0) {
    // Beside the orders, one quiet line: a bar with nothing made in batches should not lose a quarter of its screen to a notice.
    if (compact) return <p className="text-sm text-stone-500">No pre-made items at this station.</p>;
    return (
      <div className={`flex flex-col items-center justify-center text-center text-stone-500 ${compact ? 'py-8' : 'py-32'}`}>
        <UtensilsCrossed className={`opacity-30 ${compact ? 'mb-2 h-8 w-8' : 'mb-4 h-14 w-14'}`} />
        <p className={`font-semibold ${compact ? 'text-base' : 'text-2xl'}`}>No pre-made items here</p>
        <p className={`mt-1 ${compact ? 'text-xs' : 'text-sm'}`}>Items made in batches show up once their dishes are routed to this station.</p>
      </div>
    );
  }

  if (compact) {
    /*
      Chains with something to do first, as cards with their button. Then a
      card for any other item with something to do -- by its status, or because
      it still has an instruction (an empty item with no par still says "make a
      batch"). Then the chains that are fine, and one line each for the rest.
      The fine chains wait below the other items' warnings so a tub past its
      use-by is not pushed out of a narrow column by sauces that need nothing.
      Unrouted items join the lists, marked.
    */
    const needs = (r: PrepRow) => !FINE.has(r.status) || todo(r) != null;
    const attention = free.filter(needs)
      .sort((a, b) => PREP_STATUS_ORDER[a.status] - PREP_STATUS_ORDER[b.status] || Number(!a.assigned) - Number(!b.assigned));
    const fine = free.filter((r) => !needs(r));
    const fineChecked = fine.every((r) => r.status === 'OK');
    // A chain is checked when its Level 1 has a par or a servings count to judge by.
    const allChecked = fineChecked && settled.every((c) => c.stages[0]?.dot !== 'GREY');
    return (
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">Prep levels</h2>
          {/* Its own line, one height whatever it says, so a refresh never moves the list; stale data in amber. */}
          <p className={`h-4 truncate text-[11px] leading-4 ${isError && !isFetching ? 'text-amber-300' : 'text-stone-500'}`}>
            {data.branchName} · {updated}
          </p>
        </div>
        {acting.length === 0 && attention.length === 0 && (
          allChecked ? (
            <p className="rounded-xl border border-emerald-700/50 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300">
              Every prep level is fine.
            </p>
          ) : (
            <p className="rounded-xl border border-stone-700 px-3 py-2 text-sm text-stone-400">
              Nothing needs doing. Items with no par set are not checked.
            </p>
          )
        )}
        {acting.map((c) => <PrepChainCard key={c.id} chain={c} stationId={stationId} compact notes={notes} />)}
        {attention.map((r) => {
          const what = todo(r);
          const made = madeButton(r, stationId, true);
          const dates = useBySentences(r.useBy, r.unit, now);
          return (
            <div key={r.id} className={`rounded-xl border-l-4 bg-stone-900 px-3 py-2 ${EDGE[r.status]}`}>
              {/* The name gets the whole width of a narrow column; the chip sits with the amount. */}
              <p className="text-base font-semibold leading-tight">
                {r.level === 2 && <Snowflake className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-sky-300" aria-label="Parked" />}
                {r.name}
              </p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p className="text-sm tabular-nums text-stone-300">
                  {amount(r.onHand, r.unit)}
                  {r.parLevel != null && <span className="text-stone-500"> / par {amount(r.parLevel, r.unit)}</span>}
                </p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${CHIP[r.status]}`}>
                  {PREP_STATUS_LABEL[r.status]}
                </span>
              </div>
              {what && <p className="mt-1 text-sm font-medium leading-snug text-amber-200">{what}</p>}
              {dates.map((d) => (
                <p key={d} className={`mt-0.5 text-xs leading-snug ${r.useBy.expired && d.includes('past') ? 'text-red-300' : 'text-orange-200'}`}>{d}</p>
              ))}
              {!r.assigned && <p className="mt-0.5 text-[10px] uppercase tracking-wider text-stone-500">Not routed to a station</p>}
              {made && <div className="mt-2">{made}</div>}
            </div>
          );
        })}
        {settled.map((c) => <PrepChainCard key={c.id} chain={c} stationId={stationId} compact notes={notes} />)}
        {fine.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wider text-stone-500">{fineChecked ? 'Fine' : 'Fine, or no par set'}</p>
            <ul className="divide-y divide-stone-800">
              {fine.map((r) => {
                // Nothing needs doing, but a batch made early still has to be recorded.
                const made = madeButton(r, stationId, true);
                return (
                  <li key={r.id} className={`py-1.5 text-sm ${r.assigned ? '' : 'opacity-70'}`}>
                    <div className="flex items-start justify-between gap-2">
                      {/* Wrapped, not cut: "Tomato Sauce (ready)" and "(frozen)" must stay tellable apart on a touch screen. */}
                      <span className="min-w-0 leading-snug text-stone-300">
                        {r.level === 2 && <Snowflake className="mr-1 inline h-3 w-3 align-[-1px] text-sky-300" aria-label="Parked" />}
                        {r.name}
                        {!r.assigned && <span className="ml-1 text-[10px] uppercase text-stone-500">not routed</span>}
                      </span>
                      <span className="shrink-0 text-right tabular-nums leading-snug text-stone-400">
                        {amount(r.onHand, r.unit)}
                        {r.status === 'NO_PAR' && <span className="block text-[10px] text-stone-600">no par</span>}
                      </span>
                    </div>
                    {made && <div className="ml-auto mt-1.5 w-40">{made}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="text-[10px] leading-snug text-stone-600">Use-by amounts are estimates: the oldest batch is taken to be used first.</p>
      </div>
    );
  }

  const tile = (r: PrepRow) => {
    const what = todo(r);
    const made = madeButton(r, stationId);
    const dates = useBySentences(r.useBy, r.unit, now);
    const fill = r.parLevel ? Math.min(1, Math.max(0, r.onHand / (r.parLevel * 2))) : null;
    return (
      <div key={r.id} className={`rounded-2xl border-2 p-4 ${TONE[r.status]}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-stone-400">
              {r.level === 2 && <Snowflake className="h-3 w-3" />}
              {/* Steps from a dish, the same numbering the chain cards use. */}
              {r.depth != null ? `Level ${r.depth}` : 'Made in advance'}
            </p>
            <p className="mt-0.5 text-xl font-bold leading-tight">{r.name}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${CHIP[r.status]}`}>
            {PREP_STATUS_LABEL[r.status]}
          </span>
        </div>
        <p className="mt-2 text-3xl font-bold tabular-nums">
          {amount(r.onHand, r.unit)}
          {r.parLevel != null && <span className="ml-2 text-sm font-medium text-stone-400">par {amount(r.parLevel, r.unit)}</span>}
        </p>
        {fill != null && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-800" aria-hidden>
            {/* Half the bar is the par: below the mark is at or under it. */}
            <div className={`h-full ${r.onHand <= (r.parLevel ?? 0) ? 'bg-red-400' : 'bg-emerald-500'}`} style={{ width: `${fill * 100}%` }} />
          </div>
        )}
        {what && <p className="mt-2 text-base font-semibold text-amber-200">{what}</p>}
        {dates.map((d) => <p key={d} className={`mt-1 text-sm font-medium ${r.useBy.expired && d.includes('past') ? 'text-red-300' : 'text-orange-200'}`}>{d}</p>)}
        {r.serves && r.level === 1 && (
          <p className="mt-1 text-sm text-stone-400">
            About {r.serves.servingsLeft.toLocaleString('en-PH')} {r.serves.productName} left on this
          </p>
        )}
        {made && <div className="mt-3">{made}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-xs uppercase tracking-wider text-stone-500">
        {data.branchName} · {isFetching ? updated : `${updated} · every minute`}
        {' · '}use-by amounts are estimates: the oldest batch is taken to be used first
      </p>
      {chains.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {chains.map((c) => <PrepChainCard key={c.id} chain={c} stationId={stationId} notes={notes} />)}
        </div>
      )}
      {mine.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{mine.map(tile)}</div>
      )}
      {loose.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-stone-400">Not routed to a station</p>
          <div className="grid grid-cols-1 gap-4 opacity-80 md:grid-cols-2 xl:grid-cols-3">{loose.map(tile)}</div>
        </div>
      )}
    </div>
  );
}
