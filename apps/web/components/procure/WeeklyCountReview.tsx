'use client';
/**
 * The owner's review of a weekly count sent from a kitchen or bar screen: the
 * reconciliation. Each line says, in one sentence, what was counted, what the
 * books said at that moment, and the difference ("Milk: counted 2.1 L, book
 * 3.4 L, short 1.3 L").
 *
 * The count is a RECORD (status RECORDED): sending it moved nothing. From
 * here the owner can
 *   - Adjust the books to match: the existing Post dialog, through the weekly
 *     route. Stock moves by the recorded difference on top of today's stock,
 *     and a line counted again later is left alone.
 *   - Ask for a recount of chosen lines: the station is shown them again and
 *     its next Send is a new record. This record keeps every line.
 * The numbers cannot be changed here: a record is not edited, it is counted again.
 *
 * Quantities only -- the other reports carry the costs. Cards, so it reads on
 * a phone without sideways scrolling.
 */
import { useEffect, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, RotateCcw, Scale, X } from 'lucide-react';
import {
  adjustWeeklyCount, askWeeklyRecount, countErrorText, getWeeklyReview, weeklyReviewKey, type WeeklyReview,
} from '@/lib/weekly-count-api';
import { PostCountModal } from './PostCountModal';
import {
  adjustPlan, adjustedMessage, countedLine, lineTone, linesFor, reviewStatusLine, stationStrip, type LineTone, type ReviewFilter,
} from './weekly-review';

/** The server takes at most this many items per recount. */
const MAX_RECOUNT = 40;

const STRIP: Record<string, string> = {
  RECORDED: 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100',
  POSTED:   'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
  OPEN:     'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100',
};
const SENTENCE: Record<LineTone, string> = {
  short: 'text-red-600 dark:text-red-400',
  over:  'text-emerald-700 dark:text-emerald-400',
  match: 'text-muted-foreground',
};

export function WeeklyCountReview({ countId, onClose }: { countId: string; onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const key = weeklyReviewKey(countId);
  const { data: view, isPending, isError, error } = useQuery<WeeklyReview>({
    queryKey: key,
    queryFn:  () => getWeeklyReview(countId),
  });

  const [filter, setFilter] = useState<ReviewFilter>('differ');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [adjusting, setAdjusting] = useState(false);

  const recount = useMutation({
    mutationFn: (ids: string[]) => askWeeklyRecount(countId, { rawMaterialIds: ids }),
    onSuccess: (next, ids) => {
      qc.setQueryData(key, next);
      qc.invalidateQueries({ queryKey: ['cycle-counts'] });
      setPicked(new Set());
      const where = next.stations.map((s) => s.name).filter(Boolean).join(' and ') || 'the station';
      toast.success(`Recount asked for ${ids.length} item${ids.length === 1 ? '' : 's'}. The ${where} screen shows ${ids.length === 1 ? 'it' : 'them'} next time it opens the count.`);
    },
    onError: (e) => toast.error(countErrorText(e, 'Could not ask for a recount.')),
  });

  const adjust = useMutation({
    mutationFn: (isOpeningBalance: boolean) => adjustWeeklyCount(countId, { isOpeningBalance }),
    onSuccess: (res) => {
      qc.setQueryData(key, res);
      qc.invalidateQueries({ queryKey: ['cycle-counts'] });
      setAdjusting(false);
      toast.success(adjustedMessage(res.adjusted, res.skipped));
      // Same words as Cycle Counts' Post: an item with no cost moved the shelf, not the books.
      const n = res.warnings.length;
      if (n > 0) {
        toast.warning(
          `${n} ingredient${n === 1 ? '' : 's'} had no cost on file, so ${n === 1 ? 'that count' : 'those counts'} `
          + 'changed the shelf but not the books. Set their cost under Stock on hand.',
          { duration: 12000 },
        );
      }
    },
    onError: (e) => toast.error(countErrorText(e, 'Could not adjust the books.')),
  });

  // Escape closes, unless the Post dialog is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !adjusting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adjusting, onClose]);

  const recorded = view?.status === 'RECORDED';
  const lines = view?.lines ?? [];
  const missing = view?.stations.flatMap((s) => s.notCounted) ?? [];
  // Lines counted again later still show (muted) but are not counted, so the chip agrees with the bell and summary.differ.
  const differ = linesFor(lines, 'differ').filter((l) => !l.superseded).length;
  const shown = linesFor(lines, filter);
  const plan = adjustPlan(lines, view?.recountAsked ?? []);
  const asked = new Set(view?.recountAsked ?? []);
  const stationNames = view?.stations.map((s) => s.name).filter(Boolean).join(', ') ?? '';

  const toggle = (id: string) => setPicked((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_RECOUNT) next.add(id);
    return next;
  });

  const chips: Array<[ReviewFilter, string]> = [
    ['differ', `Differences (${differ})`],
    ['all', `All counted (${lines.length})`],
    ['missing', `Not counted (${missing.length})`],
  ];

  return (
    <>
      <div role="dialog" aria-modal="true" aria-labelledby="weekly-review-title"
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4">
        <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-2xl">
          <header className="flex items-start gap-3 border-b border-border px-4 sm:px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2 id="weekly-review-title" className="text-lg font-semibold leading-tight break-words">
                Weekly count{stationNames ? ` · ${stationNames}` : ''}
              </h2>
              {view && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{view.countNumber}</span> · {view.branch.name}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 py-3 space-y-3">
            {isPending ? (
              <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the count…
              </p>
            ) : !view ? (
              <p className="py-16 text-center text-sm text-red-600">{countErrorText(error, 'Could not load this count.')}</p>
            ) : (
              <>
                {isError && <p className="text-xs text-red-600">{countErrorText(error, 'Could not refresh.')} Showing what was loaded last.</p>}
                <p className={`rounded-xl border px-3 py-2 text-sm font-medium ${STRIP[view.status] ?? 'border-border bg-muted text-foreground'}`}>
                  {view.statusLine ?? reviewStatusLine(view)}
                </p>
                {view.stations.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {view.stations.map((s) => <li key={s.id || s.name}>{stationStrip(s, view.status)}</li>)}
                  </ul>
                )}

                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Show">
                  {chips.map(([f, label]) => (
                    <button
                      key={f}
                      type="button"
                      role="tab"
                      aria-selected={filter === f}
                      onClick={() => setFilter(f)}
                      className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${
                        filter === f ? 'bg-foreground text-background' : 'border border-border text-foreground hover:bg-muted'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {recorded && filter !== 'missing' && shown.length > 0 && (
                  <p className="text-xs text-muted-foreground">Tick an item to ask the station to count it again.</p>
                )}

                {filter === 'missing' ? (
                  missing.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Every item on the station&apos;s sheet was counted.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {missing.map((n) => <li key={n} className="px-3 py-2 text-sm text-muted-foreground">{n}</li>)}
                    </ul>
                  )
                ) : shown.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {filter === 'differ' ? 'Every counted item matches the book.' : 'Nothing was counted.'}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {shown.map((l) => {
                      const tone = lineTone(l.difference);
                      // The server's words when it sends them: "2 pk + 100 ml · Kitchen screen (Joy) · Sep 21 9:05 PM".
                      const second = l.detail ?? countedLine(l);
                      const canPick = recorded && !l.superseded;
                      const muted = !!l.superseded;
                      return (
                        <li key={l.lineId || l.rawMaterialId} className={`rounded-xl border border-border p-3 ${muted ? 'bg-muted/40' : ''}`}>
                          <div className="flex items-start gap-2">
                            {canPick && (
                              <label className="-m-1.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                                <input
                                  type="checkbox"
                                  checked={picked.has(l.rawMaterialId)}
                                  onChange={() => toggle(l.rawMaterialId)}
                                  aria-label={`Ask for a recount of ${l.name}`}
                                  className="h-5 w-5 accent-[var(--accent)]"
                                />
                              </label>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-medium break-words ${muted ? 'text-muted-foreground' : SENTENCE[tone]}`}>
                                {l.words}
                              </p>
                              {second && <p className="mt-0.5 text-xs text-muted-foreground break-words">{second}</p>}
                              {l.superseded && <p className="mt-1 text-xs font-medium text-muted-foreground">{l.superseded}</p>}
                              {!l.superseded && asked.has(l.rawMaterialId) && (
                                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                                  <RotateCcw className="h-3 w-3" /> Recount asked
                                </p>
                              )}
                              {l.alsoOpenIn.length > 0 && (
                                <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                  <span>Also on open count {l.alsoOpenIn.join(', ')}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Only a recorded count is acted on. Adjusted, still counting, or cancelled: read only. */}
          {view && recorded && (
            <footer className="space-y-2 border-t border-border px-4 sm:px-5 py-3">
              {plan.nothing && (
                <p className="text-xs text-muted-foreground">Nothing to adjust: every item matches or was counted again later.</p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => recount.mutate([...picked])}
                  disabled={picked.size === 0 || recount.isPending}
                  className="inline-flex min-h-11 flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {recount.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  Ask for a recount ({picked.size})
                </button>
                <button
                  type="button"
                  onClick={() => setAdjusting(true)}
                  disabled={plan.nothing || adjust.isPending}
                  className="inline-flex min-h-11 flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Scale className="h-4 w-4" />
                  Adjust the books to match
                </button>
              </div>
            </footer>
          )}
        </div>
      </div>

      {adjusting && view && (
        <PostCountModal
          title="Adjust the books to match"
          notes={plan.notes}
          count={{ countNumber: view.countNumber, branch: view.branch, _count: { lines: plan.move } }}
          pending={adjust.isPending}
          onCancel={() => setAdjusting(false)}
          onPost={(isOpeningBalance) => adjust.mutate(isOpeningBalance)}
        />
      )}
    </>
  );
}
