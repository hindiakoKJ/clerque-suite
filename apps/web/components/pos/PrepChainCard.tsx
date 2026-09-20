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
 * The big button records ONE batch of the stage that needs doing, at the
 * recipe's own yield -- nothing to type on a wall tablet with wet hands. A
 * stage that CAN be made but is not the thing to do next gets a smaller button
 * of its own, so wings marinated overnight or a sauce cooked before the rush
 * are recorded when they are made: until the tap the raw stock stays too high
 * on the books and the day's sheet is wrong. Each tap sends a key, and the
 * server records a key once, so a double-tap or a retry after the signal
 * dropped cannot make the sauce twice. No costs anywhere.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { keepTapKey, newTapKey, tapFailure, tapFailureText } from './station-taps';

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
  /**
   * A batch of this stage can be recorded from this screen although the big
   * button is not for it -- a batch made ahead. Null when it cannot be made
   * now, another station makes it, or the big button already records it.
   */
  made: StageMade | null;
}

/** A stage's own small button: the words, and the one batch it records. */
export interface StageMade {
  label: string;
  uses: string;
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

/**
 * One batch recorded, from the big button or from a stage's own small one.
 *
 * Its own key, so the big button and a stage button are never the same tap,
 * and its own pending, so only the button that was tapped waits. The prep
 * tiles that are not inside a chain use it too (StationPrepLevels).
 */
export function MadeButton({
  stationId, rawMaterialId, label, uses, tone, enabled = true, disabledLabel, compact = false,
}: {
  stationId: string;
  rawMaterialId: string;
  label: string;
  /** "Uses 2 kg Chicken · 200 g Marinade" -- shown under the button, so nothing is recorded blind. */
  uses: string | null;
  /** The one thing to do now, or a batch made ahead. */
  tone: 'primary' | 'secondary';
  enabled?: boolean;
  /** What the big button says instead when it cannot be tapped ("Buy Tomatoes first"). */
  disabledLabel?: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const key = useRef(newTapKey());
  const [pending, setPending] = useState(false);

  async function record() {
    if (!enabled || pending) return;
    setPending(true);
    try {
      const res = await api.post<{ message: string }>(
        `/kds/stations/${stationId}/prep/${rawMaterialId}/made`,
        { key: key.current },
      );
      // Recorded: the next tap is a new batch.
      key.current = newTapKey();
      toast.success(res.data.message);
      /*
        Stay disabled until the levels have been read again. Otherwise a second
        tap landing just after the answer -- with the new key -- would record a
        second batch while the card still showed the old numbers.
      */
      await qc.invalidateQueries({ queryKey: ['kds-prep', stationId] });
    } catch (e) {
      // A refusal recorded nothing, so the next tap is a new try; anything else keeps the key.
      if (!keepTapKey(tapFailure(e).status)) key.current = newTapKey();
      toast.error(tapFailureText(e));
      qc.invalidateQueries({ queryKey: ['kds-prep', stationId] });
    } finally {
      setPending(false);
    }
  }

  const look = tone === 'primary'
    ? `min-h-14 w-full px-3 text-lg font-bold ${enabled
        ? 'bg-amber-500 text-stone-950 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-70'
        : 'cursor-not-allowed bg-stone-700 text-stone-400'}`
    : 'min-h-11 w-full px-3 text-sm font-semibold border border-amber-500/60 text-amber-200 '
      + 'hover:bg-amber-500/15 active:bg-amber-500/25 disabled:opacity-60';

  return (
    <div>
      <button
        type="button"
        onClick={record}
        disabled={!enabled || pending}
        className={`flex items-center justify-center gap-2 rounded-xl leading-tight transition-colors ${look}`}
      >
        {pending && <Loader2 className={tone === 'primary' ? 'h-5 w-5 animate-spin' : 'h-4 w-4 animate-spin'} />}
        {enabled ? label : (disabledLabel ?? label)}
      </button>
      {enabled && uses && (
        <p className={`mt-1 text-center leading-snug text-stone-400 ${tone === 'primary' ? 'text-xs' : 'text-[11px]'}`}>
          {compact && tone === 'secondary' ? uses.replace(/^Uses /, '') : uses}
        </p>
      )}
    </div>
  );
}

export function PrepChainCard({
  chain, stationId, compact = false, notes,
}: {
  chain: PrepChain;
  stationId: string;
  compact?: boolean;
  /** Use-by warnings per stage id, so a tub past its date still says so inside its chain. */
  notes?: Record<string, StageNote[]>;
}) {
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
            {/* Made ahead of the rush: recorded now, not once the tub runs low. */}
            {s.made && (
              <div className="mt-1.5 pl-[18px]">
                <MadeButton
                  stationId={stationId}
                  rawMaterialId={s.id}
                  label={s.made.label}
                  uses={s.made.uses}
                  tone="secondary"
                  compact={compact}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {action && (
        <div className={compact ? 'mt-2' : 'mt-3'}>
          <MadeButton
            /* A fresh tap key when the thing to do moves to another stage: one key is one batch of one item. */
            key={action.rawMaterialId}
            stationId={stationId}
            rawMaterialId={action.rawMaterialId}
            label={action.label}
            uses={action.uses}
            tone="primary"
            enabled={action.enabled}
            disabledLabel={action.disabledReason}
          />
        </div>
      )}
    </div>
  );
}
