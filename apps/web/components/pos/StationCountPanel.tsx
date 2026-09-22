'use client';

/**
 * The weekly count on a kitchen or bar screen: go down the station's items,
 * type what is on the shelf (full packs plus what is opened or loose), and send
 * it to the owner.
 *
 * The count is a RECORD. Save and Send never move the stock or the books:
 * Send freezes this station's count so the owner can compare it with the
 * books and decide whether to adjust them. Counting again after Send starts a
 * new count; the sent one is never edited.
 *
 * Blind: the server never sends what the books say, so the cook counts what
 * is there instead of confirming a number. No costs either.
 *
 *   1024x600 tablet  two panes: the list on the left (55%), the entry on the
 *                    right (45%) with its fields and Save at the top. From
 *                    1024 wide the two fields sit side by side, so Save and
 *                    next stays in the top 300 px or so -- above the Android
 *                    keyboard, which takes the bottom 240-280 px.
 *   375 phone        one column; tapping an item opens the entry as a bottom
 *                    sheet (the "Thrown out" shell).
 *
 * A paired tablet has no person signed in, so it asks "Who is counting?" once
 * and remembers the name on this tablet. A signed-in person is named by the
 * server.
 */
import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, ClipboardCheck, Clock, Loader2, Minus, Plus, RotateCcw, Send, UserRound, X } from 'lucide-react';
import {
  countErrorText, getStationCount, saveStationCount, sendStationCount, stationCountKey,
  type SentCount, type StationCountRow, type StationCountView,
} from '@/lib/weekly-count-api';
import {
  amountLabel, cleanName, countWords, firstToCount, liveLine, looseLabel, manilaStamp, nextUncounted, opensSent,
  packsLabel, progressOf, recountState, replaceNote, rowChip, saveBody, sendQuestion, sentHeadline, splitPacks, stepPacks,
  totalOf, waitingText, withSavedRow, type ChipTone, type CountEntry,
} from './station-count';

/** The name typed on this tablet, remembered per station. */
const nameKey = (stationId: string) => `clerque.station.countBy.${stationId}`;

const CHIP: Record<ChipTone, string> = {
  todo:  'bg-stone-800 text-stone-400',
  done:  'bg-emerald-500/15 text-emerald-300',
  again: 'bg-amber-500 text-stone-950',
  other: 'bg-sky-500/15 text-sky-200',
};

const EMPTY: CountEntry = { packs: '', loose: '' };

/** Two panes from a portrait tablet up; one column and a bottom sheet on a phone. */
function useWide(): boolean {
  const query = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export function StationCountPanel({ stationId, askName, onClose }: {
  stationId: string;
  /** A paired tablet: nobody is signed in, so the counter types a name. */
  askName: boolean;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const wide = useWide();
  const key = stationCountKey(stationId);

  const { data: view, isPending, isError, error, isFetching } = useQuery<StationCountView>({
    queryKey: key,
    queryFn:  () => getStationCount(stationId),
    // While open it keeps up with the other station and with a recount the owner asks for.
    refetchInterval: 60_000,
  });

  // ── Who is counting (paired tablet only) ──────────────────────────────────
  const [name, setName] = useState('');
  const [askingName, setAskingName] = useState(false);
  useEffect(() => {
    if (!askName) return;
    let saved = '';
    try { saved = localStorage.getItem(nameKey(stationId)) ?? ''; } catch { /* storage blocked: asked each time */ }
    setName(saved);
    if (!saved) setAskingName(true);
  }, [askName, stationId]);
  const keepName = (n: string) => {
    setName(n);
    setAskingName(false);
    try { localStorage.setItem(nameKey(stationId), n); } catch { /* not remembered, still used */ }
  };

  // ── Sent, and counting again ──────────────────────────────────────────────
  // Null until the first answer: then it opens on what was sent, or ready to count.
  const [sent, setSent] = useState<boolean | null>(null);
  const [sendResult, setSendResult] = useState<SentCount | null>(null);
  // The list as it was sent, shown read-only until "Count again", whatever the next refetch holds.
  const [sentSections, setSentSections] = useState<StationCountView['sections'] | null>(null);
  useEffect(() => { if (view && sent === null) setSent(opensSent(view)); }, [view, sent]);
  const isSent = sent ?? (!!view && opensSent(view));
  /*
    No count running and not showing what was sent -- after "Count again", or
    a recount asked after today's Send: the rows' own figures belong to the
    record already sent, not to the new count.
  */
  const hideOwn = !isSent && !!view && !view.count;

  const sections = useMemo(() => (isSent && sentSections) || view?.sections || [], [isSent, sentSections, view]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const progress = progressOf(rows, hideOwn);
  const allDone = progress.total > 0 && progress.counted === progress.total;
  const progressText = view ? `${progress.counted} of ${progress.total} counted` : '';

  // ── The item being counted ────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [entry, setEntry] = useState<CountEntry>(EMPTY);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  useEffect(() => {
    if (view && selectedId === null) setSelectedId(firstToCount(rows, hideOwn));
  }, [view, rows, selectedId, hideOwn]);
  // A saved count opens ready to correct. Only when another item is picked: a refetch never wipes what is typed.
  useEffect(() => {
    const r = rows.find((x) => x.rawMaterialId === selectedId);
    setEntry(r && !hideOwn && r.counted != null ? splitPacks(r.counted, r.packSize) : EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  const selected = rows.find((r) => r.rawMaterialId === selectedId) ?? null;

  function pick(id: string) {
    setSelectedId(id);
    setLastSaved(null);
    if (!wide) setSheetOpen(true);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  async function save(qty: number) {
    if (!selected || saving) return;
    if (askName && !name) { setAskingName(true); return; }
    setSaving(true);
    try {
      const res = await saveStationCount(stationId, saveBody({ rawMaterialId: selected.rawMaterialId, qty, by: askName ? name : null }));
      setLastSaved(res.message || `Saved: ${selected.name} ${countWords(qty, selected.unit, selected.packSize)}.`);
      const next = nextUncounted(rows, selected.rawMaterialId, hideOwn);
      // On screen at once; the refetch brings the count it went into.
      qc.setQueryData<StationCountView>(key, (old) => (old ? withSavedRow(old, { ...res, rawMaterialId: selected.rawMaterialId }) : old));
      void qc.invalidateQueries({ queryKey: key });
      if (next) setSelectedId(next);
      else setSheetOpen(false);
    } catch (e) {
      // An upsert: tapping again saves the same figure, never a second one.
      toast.error(countErrorText(e, 'Could not save it. Tap Save again.'));
    } finally {
      setSaving(false);
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const ownCounted = hideOwn ? 0 : rows.filter((r) => r.counted != null).length;
  // Counting only what the owner asked for again: Send asks about those, not the whole sheet.
  const recount = recountState(rows, view?.recounted ?? [], hideOwn);
  const question = sendQuestion(progress, recount);
  async function send(confirmed: boolean) {
    if (sending) return;
    if (ownCounted === 0) { toast.error('Count at least one item first.'); return; }
    if (!confirmed && question) { setConfirming(true); return; }
    if (askName && !name) { setAskingName(true); return; }
    setConfirming(false);
    setSending(true);
    try {
      const by = askName ? cleanName(name) : '';
      const res = await sendStationCount(stationId, by ? { by } : {});
      setSendResult(res);
      setSentSections(view?.sections ?? null);
      setSent(true);
      setSheetOpen(false);
      setLastSaved(null);
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(countErrorText(e, 'Could not send it. Try again.'));
    } finally {
      setSending(false);
    }
  }

  function countAgain() {
    setSent(false);
    setSendResult(null);
    setSentSections(null);
    setLastSaved(null);
    setSelectedId(firstToCount(rows, true));
    setEntry(EMPTY);
  }

  // Escape closes the top-most thing: the question, the name, the phone's sheet, then the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirming) setConfirming(false);
      else if (askingName) setAskingName(false);
      else if (sheetOpen) setSheetOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, askingName, sheetOpen, onClose]);

  const sendButton = (cls: string) => !isSent && (
    <button
      type="button"
      onClick={() => void send(false)}
      disabled={!view || sending}
      className={`${cls} min-h-12 shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-base font-bold text-stone-950 transition-colors hover:bg-amber-400 disabled:opacity-50`}
    >
      {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
      <span>Send to the owner</span>
    </button>
  );

  const message = isError ? countErrorText(error, 'Could not load the count.') : null;
  const form = selected && (
    <EntryForm
      row={selected}
      entry={entry}
      onEntry={setEntry}
      hideOwn={hideOwn}
      saving={saving}
      lastSaved={lastSaved}
      allDone={allDone}
      onSave={(qty) => void save(qty)}
    />
  );
  const sentCard = <SentCard result={sendResult} sentAt={view?.sentAt ?? null} onCountAgain={countAgain} />;

  return (
    <div role="dialog" aria-modal="true" aria-label="Weekly count" className="fixed inset-0 z-50 flex flex-col bg-stone-950 text-white print:hidden">
      {/* Top bar: one row on a tablet, two on a phone (title and close; progress and Send). */}
      <div className="shrink-0 border-b border-stone-800 bg-stone-900 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="hidden h-6 w-6 shrink-0 text-amber-400 sm:block" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold leading-tight">Weekly count{view?.station.name ? ` · ${view.station.name}` : ''}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-stone-400">
              {isFetching && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              <span className="truncate">
                {view ? [view.branch.name, view.count?.countNumber].filter(Boolean).join(' · ') : 'Loading…'}
              </span>
            </p>
          </div>
          <p className="hidden shrink-0 text-base font-semibold tabular-nums text-stone-200 md:block">{progressText}</p>
          {sendButton('hidden md:flex')}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl bg-stone-800 px-3 text-sm font-semibold text-stone-100 hover:bg-stone-700"
          >
            <X className="h-5 w-5" />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 md:hidden">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold tabular-nums text-stone-200">{progressText}</p>
          {sendButton('flex')}
        </div>
      </div>

      {isPending ? (
        <p className="flex flex-1 items-center justify-center gap-2 text-stone-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading the count…
        </p>
      ) : !view ? (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <p className="text-lg font-semibold">Could not load the count.</p>
          <p className="mt-1 text-sm text-stone-400">{message ?? 'Check the connection and try again.'}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* The list: scrolls on its own. */}
          <div className="min-h-0 w-full overflow-y-auto overscroll-contain md:w-[55%] md:border-r md:border-stone-800">
            <div className="space-y-3 p-3 sm:p-4">
              {isError && (
                <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200">{message} Showing what was loaded last.</p>
              )}
              {!wide && isSent && sentCard}
              {view.recount && <Banner icon={<RotateCcw className="h-5 w-5 text-amber-400" />}>{view.recount.message}</Banner>}
              {view.due.isDue && !isSent && (
                <Banner icon={<Clock className="h-5 w-5 text-amber-400" />}>{view.due.message ?? 'Weekly count is due.'}</Banner>
              )}
              {waitingText(view.stillWaiting) && !isSent && (
                <Banner icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}>{waitingText(view.stillWaiting)}</Banner>
              )}
              {askName && name && !isSent && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-stone-900 px-3 text-sm text-stone-300">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <UserRound className="h-4 w-4 shrink-0" />
                    <span className="truncate">Counting: {name}</span>
                  </span>
                  <button type="button" onClick={() => setAskingName(true)}
                    className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-amber-300 hover:bg-stone-800">
                    Change
                  </button>
                </div>
              )}
              {!wide && lastSaved && !isSent && (
                <p className="flex items-start gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">
                  <Check className="mt-0.5 h-4 w-4 shrink-0" /> <span>{lastSaved}</span>
                </p>
              )}

              {sections.length === 0 ? (
                <p className="rounded-xl border border-dashed border-stone-800 px-4 py-10 text-center text-sm text-stone-400">
                  No items on this station&apos;s sheet yet. An item shows here once a product sent to this station uses it in a recipe, a size or an add-on.
                </p>
              ) : sections.map((section) => (
                <section key={section.key}>
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-amber-300">{section.title}</h3>
                  <ul className="space-y-2">
                    {section.rows.map((r) => {
                      const chip = rowChip(r, hideOwn);
                      const active = wide && !isSent && r.rawMaterialId === selectedId;
                      return (
                        <li key={r.rawMaterialId}>
                          {/* Read-only once sent, until "Count again". */}
                          <button
                            type="button"
                            onClick={() => pick(r.rawMaterialId)}
                            disabled={isSent}
                            aria-current={active || undefined}
                            className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default ${
                              active ? 'border-amber-500 bg-stone-800' : 'border-stone-800 bg-stone-900 enabled:hover:bg-stone-800'
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block break-words text-base font-semibold leading-tight">{r.name}</span>
                              {r.alsoOn.length > 0 && <span className="mt-0.5 block text-xs text-stone-400">Also on {r.alsoOn.join(', ')}</span>}
                            </span>
                            <span className={`max-w-[50%] shrink-0 break-words rounded-lg px-2.5 py-1 text-right text-xs font-semibold leading-snug ${CHIP[chip.tone]}`}>
                              {chip.text}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>

          {/* The entry, on a tablet: fields and Save at the top. */}
          {wide && (
            <div className="min-h-0 w-full overflow-y-auto overscroll-contain p-4 md:w-[45%]">
              {isSent ? sentCard : form ?? (
                <p className="py-10 text-center text-sm text-stone-400">Nothing to count on this station yet.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* The entry, on a phone: a bottom sheet over the list. */}
      {!wide && sheetOpen && selected && !isSent && (
        <div role="dialog" aria-modal="true" aria-label={`Count ${selected.name}`}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4 print:hidden">
          <div className="max-h-full w-full max-w-md overflow-y-auto rounded-t-2xl bg-stone-900 p-4 text-white sm:rounded-2xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold tabular-nums text-stone-400">{progressText}</p>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close"
                className="flex min-h-11 shrink-0 items-center rounded-xl bg-stone-800 px-3 text-sm font-semibold hover:bg-stone-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            {form}
          </div>
        </div>
      )}

      {/* A partial count asks before it goes. */}
      {confirming && (
        <div role="alertdialog" aria-modal="true" aria-label="Send anyway?"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 print:hidden">
          <div className="w-full max-w-sm rounded-2xl bg-stone-900 p-5 text-white">
            <p className="text-lg font-bold">{question ?? 'Send it now?'}</p>
            <p className="mt-1 text-sm text-stone-400">What is not counted is left out of this count.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirming(false)}
                className="min-h-12 flex-1 rounded-xl bg-stone-800 px-3 text-base font-semibold hover:bg-stone-700">
                Keep counting
              </button>
              <button type="button" onClick={() => void send(true)} disabled={sending}
                className="min-h-12 flex-1 rounded-xl bg-amber-500 px-3 text-base font-bold text-stone-950 hover:bg-amber-400 disabled:opacity-50">
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {askingName && <NameDialog initial={name} onDone={keepName} onClose={() => setAskingName(false)} />}
    </div>
  );
}

function Banner({ icon, children }: { icon: JSX.Element; children: ReactNode }): JSX.Element {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-base text-amber-100">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * One item: full packs with - and +, what is opened or loose, the live line,
 * then Save and next beside None left. On a tablet it sits in the right pane,
 * on a phone in the bottom sheet.
 */
function EntryForm({ row, entry, onEntry, hideOwn, saving, lastSaved, allDone, onSave }: {
  row: StationCountRow;
  entry: CountEntry;
  onEntry: (next: CountEntry) => void;
  hideOwn: boolean;
  saving: boolean;
  lastSaved: string | null;
  allDone: boolean;
  onSave: (qty: number) => void;
}): JSX.Element {
  const qty = totalOf(entry, row.packSize);
  const note = replaceNote(row, hideOwn);
  const live = liveLine(qty, row.unit, row.packSize);
  const packSize = row.packSize != null && row.packSize > 0 ? row.packSize : null;
  const field = 'min-h-14 w-full min-w-0 rounded-xl border border-stone-700 bg-stone-950 px-3 text-2xl font-bold tabular-nums text-white outline-none focus:border-amber-500';
  const step = 'flex min-h-14 min-w-14 shrink-0 items-center justify-center rounded-xl bg-stone-800 text-white hover:bg-stone-700 active:bg-stone-600';

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (qty != null) onSave(qty); }} className="space-y-3">
      <div>
        <p className="break-words text-xl font-bold leading-tight">{row.name}</p>
        {row.alsoOn.length > 0 && <p className="text-sm text-stone-400">Also on {row.alsoOn.join(', ')}</p>}
        {note && <p className="mt-1 text-sm text-amber-200">{note}</p>}
      </div>

      {packSize != null ? (
        // Side by side from 1024 wide: one field row fewer keeps Save and next above the keyboard.
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-end lg:gap-3 lg:space-y-0">
          <div>
            <label htmlFor="count-packs" className="block text-sm font-semibold text-stone-300">{packsLabel(packSize, row.unit)}</label>
            <div className="mt-1.5 flex items-center gap-2">
              <button type="button" aria-label="One pack less" onClick={() => onEntry({ ...entry, packs: stepPacks(entry.packs, -1) })} className={step}>
                <Minus className="h-6 w-6" />
              </button>
              <input
                id="count-packs"
                value={entry.packs}
                onChange={(e) => onEntry({ ...entry, packs: e.target.value })}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                className={`${field} text-center`}
              />
              <button type="button" aria-label="One pack more" onClick={() => onEntry({ ...entry, packs: stepPacks(entry.packs, 1) })} className={step}>
                <Plus className="h-6 w-6" />
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="count-loose" className="block text-sm font-semibold text-stone-300">{looseLabel(row.unit)}</label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="count-loose"
                value={entry.loose}
                onChange={(e) => onEntry({ ...entry, loose: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                className={field}
              />
              <span className="shrink-0 text-lg font-semibold text-stone-400">{row.unit}</span>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="count-loose" className="block text-sm font-semibold text-stone-300">{amountLabel(row.unit)}</label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="count-loose"
              value={entry.loose}
              onChange={(e) => onEntry({ ...entry, loose: e.target.value })}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              className={field}
            />
            <span className="shrink-0 text-lg font-semibold text-stone-400">{row.unit}</span>
          </div>
        </div>
      )}

      <p className="min-h-5 text-sm text-stone-300" aria-live="polite">{live}</p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave(0)}
          disabled={saving}
          className="min-h-14 shrink-0 rounded-xl border border-stone-700 px-4 text-base font-semibold text-stone-100 hover:bg-stone-800 disabled:opacity-50"
        >
          None left
        </button>
        <button
          type="submit"
          disabled={qty == null || saving}
          className="flex min-h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 text-lg font-bold text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          <span>Save and next</span>
        </button>
      </div>

      {/* Under the buttons, so what was just saved never pushes the fields down under the keyboard. */}
      {lastSaved && (
        <p className="flex items-start gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">
          <Check className="mt-0.5 h-4 w-4 shrink-0" /> <span>{lastSaved}</span>
        </p>
      )}
      <p className="text-xs leading-snug text-stone-500">
        Count all of it in the shop, fridge and shelf. Saving does not change the stock.
      </p>
      {allDone && <p className="text-sm font-semibold text-emerald-300">Everything is counted. Tap Send to the owner.</p>}
    </form>
  );
}

/** After Send: the count is kept as it was sent. "Count again" starts a new one. */
function SentCard({ result, sentAt, onCountAgain }: { result: SentCount | null; sentAt: string | null; onCountAgain: () => void }): JSX.Element {
  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
      <p className="flex items-start gap-2 text-lg font-bold leading-snug text-emerald-100">
        <Check className="mt-1 h-5 w-5 shrink-0 text-emerald-400" />
        <span>{sentHeadline(result?.outcome)}</span>
      </p>
      {result?.message && <p className="text-sm text-emerald-100/90">{result.message}</p>}
      {!result && sentAt && <p className="text-sm text-stone-300">Last sent {manilaStamp(sentAt)}.</p>}
      {result && result.notCounted.length > 0 && <p className="text-sm text-stone-300">Not counted: {result.notCounted.join(', ')}</p>}
      <p className="text-sm text-stone-400">The list shows what was sent.</p>
      <button
        type="button"
        onClick={onCountAgain}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-stone-800 px-4 text-lg font-bold text-white hover:bg-stone-700"
      >
        <RotateCcw className="h-5 w-5" />
        <span>Count again</span>
      </button>
    </div>
  );
}

/** "Who is counting?" -- asked once on a paired tablet; the owner sees the name on the count. */
function NameDialog({ initial, onDone, onClose }: { initial: string; onDone: (name: string) => void; onClose: () => void }): JSX.Element {
  const [text, setText] = useState(initial);
  const clean = cleanName(text);
  return (
    <div role="dialog" aria-modal="true" aria-label="Who is counting?"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4 print:hidden">
      <form
        onSubmit={(e) => { e.preventDefault(); if (clean) onDone(clean); }}
        className="w-full max-w-md rounded-t-2xl bg-stone-900 p-4 text-white sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <label htmlFor="count-by" className="pt-2 text-lg font-bold">Who is counting?</label>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex min-h-11 shrink-0 items-center rounded-xl bg-stone-800 px-3 text-sm font-semibold hover:bg-stone-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <input
          id="count-by"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={40}
          autoComplete="off"
          autoFocus
          placeholder="Your name"
          className="mt-3 min-h-14 w-full rounded-xl border border-stone-700 bg-stone-950 px-3 text-xl font-semibold text-white outline-none focus:border-amber-500"
        />
        <button
          type="submit"
          disabled={!clean}
          className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl bg-amber-500 px-3 text-lg font-bold text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
        >
          Start counting
        </button>
        <p className="mt-2 text-center text-xs text-stone-500">Typed once on this screen. The owner sees who counted.</p>
      </form>
    </div>
  );
}
