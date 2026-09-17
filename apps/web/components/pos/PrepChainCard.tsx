'use client';
/**
 * One sauce on the station screen, read from Level 1 down, with the ONE thing
 * to do about it and a button to say it is done.
 *
 * Level 1 is the tub plates are served from, Level 2 refills it, Level 3 makes
 * Level 2. The server reads the stages together (sub-recipes/prep-chain.ts) and
 * sends the sentence, so this card only draws it: three tiles made the cook
 * work out the order themselves ("the ready tub is low, the frozen one is empty
 * too, so first I cook the base").
 *
 * The button records ONE batch of the stage that needs doing, at the recipe's
 * own yield -- nothing to type on a wall tablet with wet hands. Each tap sends a
 * key, and the server records a key once, so a double-tap or a retry after the
 * signal dropped cannot make the sauce twice. No costs anywhere.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

export type ChainSeverity = 'NOW' | 'NEXT' | 'OK';
export type ChainDot = 'RED' | 'AMBER' | 'GREEN' | 'GREY';

export interface ChainStage {
  level: number;
  id: string;
  name: string;
  unit: string;
  kind: 'MAKE' | 'MOVE';
  onHand: number;
  parLevel: number | null;
  servingsLeft: number | null;
  servesName: string | null;
  perRefill: number | null;
  canMakeNow: boolean;
  dot: ChainDot;
  line: string;
}

export interface PrepChain {
  /** The Level 1 item's id. */
  id: string;
  name: string;
  station: { id: string; name: string; kind: string } | null;
  stages: ChainStage[];
  headline: string | null;
  severity: ChainSeverity;
  action: { rawMaterialId: string; label: string; uses: string; enabled: boolean; disabledReason?: string } | null;
  blockedBy: string | null;
  /** Routed to this station; false for a chain routed to none. */
  assigned: boolean;
}

/** A use-by warning for one stage, already worded by the screen. */
export interface StageNote { text: string; past: boolean }

const EDGE: Record<ChainSeverity, string> = {
  NOW:  'border-red-500',
  NEXT: 'border-amber-400',
  OK:   'border-emerald-600',
};
const HEADLINE: Record<ChainSeverity, string> = {
  NOW:  'text-red-200',
  NEXT: 'text-amber-200',
  OK:   'text-stone-300',
};
const DOT: Record<ChainDot, string> = {
  RED:   'bg-red-500',
  AMBER: 'bg-amber-400',
  GREEN: 'bg-emerald-500',
  GREY:  'bg-stone-600',
};
const DOT_LABEL: Record<ChainDot, string> = {
  RED:   'Needs doing now',
  AMBER: 'Needs doing next',
  GREEN: 'Fine',
  GREY:  'No par set',
};

const amount = (n: number, unit: string) => `${Math.max(0, n).toLocaleString('en-PH', { maximumFractionDigits: 1 })} ${unit}`;

/*
  A fresh tap key. crypto.randomUUID only exists on HTTPS or localhost, and a
  kitchen tablet on the shop's own network may be neither, so the fallback is
  time plus randomness -- unique enough for one screen's taps.
*/
const newKey = (): string =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function PrepChainCard({
  chain, stationId, compact = false, notes,
}: {
  chain: PrepChain;
  stationId: string;
  compact?: boolean;
  /** Use-by warnings per stage id, so a tub past its date still says so inside its chain. */
  notes?: Record<string, StageNote[]>;
}) {
  const qc = useQueryClient();
  const key = useRef(newKey());
  const [pending, setPending] = useState(false);

  async function record() {
    const action = chain.action;
    if (!action || !action.enabled || pending) return;
    setPending(true);
    try {
      const res = await api.post<{ message: string }>(
        `/kds/stations/${stationId}/prep/${action.rawMaterialId}/made`,
        { key: key.current },
      );
      // Recorded: the next tap is a new batch.
      key.current = newKey();
      toast.success(res.data.message);
      /*
        Stay disabled until the levels have been read again. Otherwise a second
        tap landing just after the answer -- with the new key -- would record a
        second batch while the card still showed the old numbers.
      */
      await qc.invalidateQueries({ queryKey: ['kds-prep', stationId] });
    } catch (e) {
      const r = (e as { response?: { status?: number; data?: { message?: string | string[] } } })?.response;
      const m = r?.data?.message;
      const said = Array.isArray(m) ? m.join(' ') : m;
      /*
        No answer at all (the signal dropped) or a server error: the batch may
        or may not have been recorded, so the key is KEPT -- tapping again then
        either records it or is told it already was. A refusal (4xx) recorded
        nothing, so the next tap is a new try.
      */
      if (r?.status && r.status >= 400 && r.status < 500) key.current = newKey();
      toast.error(said ?? (r
        ? 'Could not record it. Tap again: it will not be counted twice.'
        : 'No connection. Tap again when it is back: it will not be counted twice.'));
      qc.invalidateQueries({ queryKey: ['kds-prep', stationId] });
    } finally {
      setPending(false);
    }
  }

  const action = chain.action;
  return (
    <div className={`rounded-2xl border-l-4 bg-stone-900 ${EDGE[chain.severity]} ${compact ? 'px-3 py-2.5' : 'p-4'}`}>
      {!chain.assigned && (
        <p className="mb-1 text-[10px] uppercase tracking-wider text-stone-500">Not routed to a station</p>
      )}
      {chain.headline ? (
        <p className={`font-semibold leading-snug ${compact ? 'text-base' : 'text-lg'} ${HEADLINE[chain.severity]}`}>
          {chain.headline}
        </p>
      ) : (
        <p className={`font-semibold leading-snug text-stone-200 ${compact ? 'text-base' : 'text-lg'}`}>{chain.name}</p>
      )}

      <ul className={`${compact ? 'mt-1.5 space-y-1' : 'mt-3 space-y-1.5'}`}>
        {chain.stages.map((s) => (
          <li key={s.id}>
            <div className="flex items-start justify-between gap-2">
              {/* Wrapped, not cut: "(ready)" and "(frozen)" must stay tellable apart. */}
              <span className={`flex min-w-0 items-start gap-2 leading-snug text-stone-200 ${compact ? 'text-sm' : 'text-base'}`}>
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[s.dot]}`} role="img" aria-label={DOT_LABEL[s.dot]} />
                <span className="min-w-0">
                  <span className="text-stone-400">Level {s.level} · </span>{s.name}
                </span>
              </span>
              <span className={`shrink-0 text-right tabular-nums leading-snug text-stone-300 ${compact ? 'text-sm' : 'text-base'}`}>
                {amount(s.onHand, s.unit)}
              </span>
            </div>
            {s.level === 1 && s.servingsLeft != null && s.servesName && (
              <p className="pl-[18px] text-xs leading-snug text-stone-400">
                about {s.servingsLeft.toLocaleString('en-PH')} {s.servesName}
              </p>
            )}
            {(notes?.[s.id] ?? []).map((n) => (
              <p key={n.text} className={`pl-[18px] text-xs leading-snug ${n.past ? 'text-red-300' : 'text-orange-200'}`}>{n.text}</p>
            ))}
          </li>
        ))}
      </ul>

      {action && (
        <div className={compact ? 'mt-2' : 'mt-3'}>
          <button
            type="button"
            onClick={record}
            disabled={!action.enabled || pending}
            className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-3 text-lg font-bold leading-tight transition-colors ${
              action.enabled
                ? 'bg-amber-500 text-stone-950 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-70'
                : 'cursor-not-allowed bg-stone-700 text-stone-400'
            }`}
          >
            {pending && <Loader2 className="h-5 w-5 animate-spin" />}
            {action.enabled ? action.label : (action.disabledReason ?? action.label)}
          </button>
          {action.enabled && <p className="mt-1 text-center text-xs leading-snug text-stone-400">{action.uses}</p>}
        </div>
      )}
    </div>
  );
}
