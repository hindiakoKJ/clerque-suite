'use client';
/**
 * Prep levels on the station screen: every pre-made item this station looks
 * after, worst first, readable from across the kitchen or the bar.
 *
 * Past its use-by, out, needs moving or cooking now, due soon, low, fine, and
 * no par set -- the same rule the half-hourly alerts use (@repo/shared-types
 * prep-station and prep-rotation). Items routed to no station are shown apart
 * underneath, since they belong to whoever the shop decides.
 *
 * Read-only on purpose: a tablet on the wall is often paired rather than
 * logged in, and recording a batch belongs to the person who made it, on the
 * prep board.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Snowflake, UtensilsCrossed } from 'lucide-react';
import {
  rotationInstruction, useBySentences, PREP_STATUS_LABEL, PREP_STATUS_ORDER,
  type PrepStatus, type RotationRow, type UseBy,
} from '@repo/shared-types';
import { api } from '@/lib/api';

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
}
interface StationPrep {
  station: { id: string; name: string; kind: string };
  branchName: string;
  at: string;
  rows: PrepRow[];
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
const LEVEL: Record<string, string> = { '1': 'Ready to use', '2': 'Parked' };
const RED = new Set<PrepStatus>(['EXPIRED', 'OUT', 'DO_NOW']);

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

export function StationPrepLevels({
  stationId, enabled, onNewRed, visible = true,
}: { stationId: string; enabled: boolean; onNewRed?: () => void; visible?: boolean }) {
  const { data, isPending, isError, error, dataUpdatedAt, isFetching } = useQuery<StationPrep>({
    queryKey: ['kds-prep', stationId],
    queryFn:  () => api.get(`/kds/stations/${stationId}/prep`).then((r) => r.data),
    enabled,
    // The line moves with every sale; a minute is fresh enough to act on.
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  /*
    The bell rings when a tile turns red, or a red tile gets worse (do now, then
    out, then past its use-by). Not when it gets better: throwing out the old
    tub turns "past use-by" into "do now", and ringing for work just finished
    teaches the kitchen to ignore the bell. The first load only seeds.
    This runs whichever view is showing -- the screen stays mounted, hidden,
    behind the orders.
  */
  const seenRed = useRef<Map<string, number> | null>(null);
  const ring = useRef(onNewRed);
  ring.current = onNewRed;
  useEffect(() => {
    if (!data) return;
    const red = new Map(data.rows.filter((r) => RED.has(r.status)).map((r) => [r.id, PREP_STATUS_ORDER[r.status]]));
    const prev = seenRed.current;
    if (prev && [...red].some(([id, rank]) => !prev.has(id) || rank < prev.get(id)!)) ring.current?.();
    seenRed.current = red;
  }, [data]);

  if (!visible) return null;
  if (isPending) {
    return <div className="flex items-center justify-center gap-2 py-32 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /> Loading prep levels…</div>;
  }
  // A failed refresh keeps the last good tiles, and says so; only no data at all is an error screen.
  if (!data) {
    const message = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;
    return (
      <div className="flex flex-col items-center justify-center py-32 text-stone-400">
        <AlertTriangle className="mb-3 h-10 w-10 text-amber-400" />
        <p className="text-lg font-semibold text-white">Could not load prep levels</p>
        <p className="mt-1 text-sm">{message ?? 'Check the connection. It tries again every minute.'}</p>
      </div>
    );
  }

  const now = new Date(data.at);
  const mine = data.rows.filter((r) => r.assigned);
  const loose = data.rows.filter((r) => !r.assigned);
  if (data.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-stone-500">
        <UtensilsCrossed className="mb-4 h-14 w-14 opacity-30" />
        <p className="text-2xl font-semibold">No pre-made items here</p>
        <p className="mt-1 text-sm">Items made in batches show up once their dishes are routed to this station.</p>
      </div>
    );
  }

  const tile = (r: PrepRow) => {
    const what = todo(r);
    const dates = useBySentences(r.useBy, r.unit, now);
    const fill = r.parLevel ? Math.min(1, Math.max(0, r.onHand / (r.parLevel * 2))) : null;
    return (
      <div key={r.id} className={`rounded-2xl border-2 p-4 ${TONE[r.status]}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-stone-400">
              {r.level === 2 && <Snowflake className="h-3 w-3" />}
              {r.level ? LEVEL[String(r.level)] : 'Made in advance'}
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
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-xs uppercase tracking-wider text-stone-500">
        {data.branchName} · {isFetching ? 'Refreshing…' : `${isError ? 'Could not refresh — showing' : 'Updated'} ${new Date(dataUpdatedAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })} · every minute`}
        {' · '}use-by amounts are estimates: the oldest batch is taken to be used first
      </p>
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
