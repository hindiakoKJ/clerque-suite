'use client';
/**
 * What "Request what's running low" did, on the kitchen or bar screen, and the
 * "+" for anything Clerque cannot see is needed (tissue, dish soap, a new
 * syrup nobody has bought before).
 *
 * Every word and amount comes from the server, which builds them field by
 * field: nothing here carries a cost, because the kitchen does not see what
 * the shop pays. Big touch targets: this runs on a tablet in a kitchen.
 *
 * No polling. The list changes when somebody taps, and the tap answers.
 */
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowUp, Check, ChefHat, Loader2, Minus, PackagePlus, Plus, Search, ShoppingCart, Truck, X,
} from 'lucide-react';
import { api } from '@/lib/api';

// ── what the server sends (station-request.service.ts) ──────────────────────

export type RequestOutcome = 'SENT' | 'UPDATED' | 'NOTHING_NEW' | 'ALREADY_SENT';

interface LineWords { rawMaterialId: string; name: string; amount: string; why: string[] }

export interface RequestView {
  plannedFor: string;
  plannedForLabel: string;
  request: { id: string; requestNumber: string; status: string } | null;
  added: LineWords[];
  raised: Array<LineWords & { was: string }>;
  unchanged: number;
  onTheWay: Array<{ name: string; amount: string }>;
  toMake: Array<{ name: string; batches: number }>;
  check: Array<{ name: string; reason: string }>;
}

export interface RequestResult extends RequestView {
  outcome: RequestOutcome;
  message: string;
  sentTo: string[];
}

interface Pickable { rawMaterialId: string; name: string; unit: string; category: string; packSize: number | null }

interface RequestPreview extends RequestView {
  stationKind: string | null;
  pickable: Pickable[];
}

// The server's limits (station-request.service.ts), so the form cannot build a body it refuses.
const SUPPLY_CATEGORIES = [
  ['KITCHEN_SUPPLY', 'Kitchen supply'],
  ['BAR_SUPPLY', 'Bar supply'],
  ['OFFICE_SUPPLY', 'Office supply'],
] as const;
type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number][0];
const UNITS = ['pc', 'pack', 'box', 'roll', 'g', 'kg', 'ml', 'L'] as const;
type Unit = (typeof UNITS)[number];
const MAX_EXTRAS = 20;
const MAX_QTY = 1_000_000;

/** The request-low endpoint for one station. */
export const requestLowPath = (stationId: string) => `/kds/stations/${stationId}/request-low`;

/**
 * A refusal's own words, or a plain line when the tablet never reached the
 * server. Same reading as the station page's `refusal`.
 */
export function requestErrorMessage(e: unknown, fallback: string): string {
  const r = (e as { response?: { status?: number; data?: { message?: string | string[] } } })?.response;
  if (!r) return 'Could not reach Clerque. Check the connection and try again.';
  const m = r.data?.message;
  return (Array.isArray(m) ? m.join(' ') : m) || fallback;
}

// ── "+" drafts ──────────────────────────────────────────────────────────────

type Draft =
  | { key: string; kind: 'pick'; rawMaterialId: string; name: string; unit: string; packSize: number | null; qty: number }
  | { key: string; kind: 'new'; name: string; category: SupplyCategory; unit: Unit; qty: number };

/**
 * One tap of the stepper: a whole pack when Clerque knows the pack (the server
 * rounds to packs anyway), 100 g or ml, otherwise one of the unit.
 */
function stepOf(unit: string, packSize: number | null): number {
  if (packSize != null && packSize > 0) return packSize;
  const u = unit.trim().toLowerCase();
  return u === 'g' || u === 'ml' ? 100 : 1;
}

function draftAmount(d: Draft): string {
  const qty = `${d.qty.toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${d.unit}`;
  if (d.kind === 'pick' && d.packSize != null && d.packSize > 0) {
    const packs = Math.round((d.qty / d.packSize) * 100) / 100;
    return `${packs} pack${packs === 1 ? '' : 's'} (${qty})`;
  }
  return qty;
}

/** Where a new supply most likely belongs: the kitchen side or the bar side of the shop. */
function defaultCategory(stationKind: string | null | undefined): SupplyCategory {
  return stationKind === 'KITCHEN' || stationKind === 'PASTRY_PASS' ? 'KITCHEN_SUPPLY' : 'BAR_SUPPLY';
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
/** Four decimals, as the server accepts: a 750.5 ml pack stepped three times must not send 2251.4999999. */
const qty4 = (n: number) => Math.round(n * 10_000) / 10_000;

// ── the panel ───────────────────────────────────────────────────────────────

const TITLE: Record<RequestOutcome, string> = {
  SENT:         'Sent to the owner',
  UPDATED:      'Added to the list',
  NOTHING_NEW:  'Nothing new to send',
  ALREADY_SENT: 'Already sent today',
};

export function StationRequestPanel({
  stationId, result, onResult, onClose,
}: {
  stationId: string;
  result: RequestResult;
  onResult: (next: RequestResult) => void;
  onClose: () => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);

  const tone = result.outcome === 'SENT'
    ? 'bg-emerald-500 text-stone-950'
    : result.outcome === 'UPDATED' ? 'bg-amber-500 text-stone-950' : 'bg-stone-700 text-stone-200';
  const HeadIcon = result.outcome === 'SENT' || result.outcome === 'UPDATED' ? Check : ShoppingCart;
  const nothingToShow = result.added.length + result.raised.length + result.onTheWay.length
    + result.toMake.length + result.check.length === 0 && result.unchanged === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="station-request-title"
    >
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-stone-700 bg-stone-900 text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3 px-4 sm:px-6 py-4 border-b border-stone-700">
          <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}>
            <HeadIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="station-request-title" className="text-xl font-bold leading-tight">
              {adding ? 'Add something' : TITLE[result.outcome]}
            </h2>
            <p className="mt-1 text-sm text-stone-300 break-words">{adding ? 'It goes on the same list and is sent.' : result.message}</p>
            <p className="mt-1 text-xs text-stone-500">
              For {result.plannedForLabel}
              {result.request ? <> · {result.request.requestNumber}</> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-stone-400 hover:bg-stone-800 hover:text-white"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {adding ? (
          <AddSomething
            stationId={stationId}
            onBack={() => setAdding(false)}
            onSent={(next) => { onResult(next); setAdding(false); }}
          />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
              {result.added.length > 0 && (
                <Section title="New on the list" icon={<Plus className="h-4 w-4 text-emerald-400" />}>
                  {result.added.map((l) => (
                    <Row key={l.rawMaterialId} name={l.name} amount={l.amount} why={l.why} />
                  ))}
                </Section>
              )}
              {result.raised.length > 0 && (
                <Section title="Raised" icon={<ArrowUp className="h-4 w-4 text-amber-400" />}>
                  {result.raised.map((l) => (
                    <Row key={l.rawMaterialId} name={l.name} amount={l.amount} was={l.was} why={l.why} />
                  ))}
                </Section>
              )}
              {result.onTheWay.length > 0 && (
                <Section title="Already on the way" icon={<Truck className="h-4 w-4 text-sky-400" />}>
                  {result.onTheWay.map((l) => <Row key={l.name} name={l.name} amount={l.amount} />)}
                </Section>
              )}
              {result.toMake.length > 0 && (
                <Section title="Make first" icon={<ChefHat className="h-4 w-4 text-orange-400" />}>
                  {result.toMake.map((m) => (
                    <Row key={m.name} name={m.name} amount={`${m.batches} batch${m.batches === 1 ? '' : 'es'}`} />
                  ))}
                </Section>
              )}
              {result.check.length > 0 && (
                <Section title="Check these" icon={<AlertTriangle className="h-4 w-4 text-red-400" />}>
                  {result.check.map((c) => <Row key={c.name} name={c.name} why={[c.reason]} />)}
                </Section>
              )}
              {result.unchanged > 0 && (
                <p className="text-sm text-stone-400">
                  {result.unchanged} {result.unchanged === 1 ? 'item is' : 'items are'} already on the list.
                </p>
              )}
              {nothingToShow && (
                <p className="text-sm text-stone-400">
                  If something is running low that Clerque cannot see, add it with the button below.
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 px-4 sm:px-6 py-4 border-t border-stone-700">
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 flex-1 rounded-xl bg-stone-800 px-4 text-base font-semibold text-stone-200 hover:bg-stone-700"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="min-h-12 flex-1 flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-base font-semibold text-stone-950 hover:bg-amber-400"
              >
                <Plus className="h-5 w-5" /> Add something
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: JSX.Element; children: React.ReactNode }): JSX.Element {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
        {icon} {title}
      </h3>
      <ul className="divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-950/40">{children}</ul>
    </section>
  );
}

function Row({ name, amount, was, why }: { name: string; amount?: string; was?: string; why?: string[] }): JSX.Element {
  return (
    <li className="px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 break-words text-base font-medium">{name}</span>
        {amount && <span className="text-base font-semibold tabular-nums text-amber-300">{amount}</span>}
      </div>
      {was && <p className="mt-0.5 text-xs text-stone-400">was {was}</p>}
      {why && why.length > 0 && (
        <p className="mt-0.5 text-xs text-stone-500 break-words">{why.join(' · ')}</p>
      )}
    </li>
  );
}

// ── "+ Add something" ───────────────────────────────────────────────────────

function AddSomething({
  stationId, onBack, onSent,
}: { stationId: string; onBack: () => void; onSent: (next: RequestResult) => void }): JSX.Element {
  const qc = useQueryClient();
  const { data, isPending, isError, error, refetch } = useQuery<RequestPreview>({
    queryKey: ['kds-request-low', stationId],
    queryFn:  () => api.get(requestLowPath(stationId)).then((r) => r.data),
    // The item list barely moves in a shift; the tap itself reads stock fresh.
    staleTime: 5 * 60_000,
  });
  const [typed, setTyped] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sending, setSending] = useState(false);

  const query = norm(typed);
  const picked = new Set(drafts.flatMap((d) => (d.kind === 'pick' ? [d.rawMaterialId] : [])));
  const matches = useMemo(() => {
    const all = data?.pickable ?? [];
    return (query ? all.filter((p) => norm(p.name).includes(query)) : all).slice(0, 40);
  }, [data, query]);
  // A name the shop already has (in any case) is that item, never a second one: the server agrees.
  const exact = !!query && (data?.pickable ?? []).some((p) => norm(p.name) === query);
  const draftedNew = drafts.some((d) => d.kind === 'new' && norm(d.name) === query);
  const full = drafts.length >= MAX_EXTRAS;

  function pick(p: Pickable) {
    if (full || picked.has(p.rawMaterialId)) return;
    const step = stepOf(p.unit, p.packSize);
    setDrafts((ds) => [...ds, { key: `pick-${p.rawMaterialId}`, kind: 'pick', rawMaterialId: p.rawMaterialId, name: p.name, unit: p.unit, packSize: p.packSize, qty: step }]);
    setTyped('');
  }

  function addNew() {
    const name = typed.trim().replace(/\s+/g, ' ');
    if (full || name.length < 2 || exact || draftedNew) return;
    setDrafts((ds) => [...ds, { key: `new-${Date.now()}`, kind: 'new', name, category: defaultCategory(data?.stationKind), unit: 'pc', qty: 1 }]);
    setTyped('');
  }

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? ({ ...d, ...patch } as Draft) : d)));

  async function send() {
    if (drafts.length === 0 || sending) return;
    setSending(true);
    try {
      const extras = drafts.map((d) => (d.kind === 'pick'
        ? { rawMaterialId: d.rawMaterialId, qty: d.qty }
        : { newItem: { name: d.name, category: d.category, unit: d.unit }, qty: d.qty }));
      const res = await api.post<RequestResult>(requestLowPath(stationId), { extras });
      // A new item is pickable from now on.
      void qc.invalidateQueries({ queryKey: ['kds-request-low', stationId] });
      onSent(res.data);
    } catch (e) {
      toast.error(requestErrorMessage(e, 'Could not add it to the list.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
        {drafts.length > 0 && (
          <ul className="space-y-2">
            {drafts.map((d) => {
              const step = d.kind === 'pick' ? stepOf(d.unit, d.packSize) : stepOf(d.unit, null);
              return (
                <li key={d.key} className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-base font-semibold">{d.name}</p>
                      {d.kind === 'new' && <p className="text-xs text-amber-300">New item — the owner sets its details</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                      aria-label={`Remove ${d.name}`}
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-stone-400 hover:bg-stone-800 hover:text-white"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {d.kind === 'new' && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {SUPPLY_CATEGORIES.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => update(d.key, { category: value })}
                          className={`min-h-12 rounded-xl px-3 text-sm font-semibold transition-colors ${
                            d.category === value ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      <label className="flex items-center gap-2 text-sm text-stone-400">
                        Unit
                        <select
                          value={d.unit}
                          onChange={(e) => {
                            const unit = e.target.value as Unit;
                            // A new unit starts again from one step of it: 1 pc is not 1 g.
                            update(d.key, { unit, qty: stepOf(unit, null) });
                          }}
                          className="min-h-12 rounded-xl border border-stone-700 bg-stone-800 px-3 text-base text-white"
                        >
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </label>
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => update(d.key, { qty: qty4(Math.max(step, d.qty - step)) })}
                      disabled={d.qty <= step}
                      aria-label="Less"
                      className="flex h-12 w-12 items-center justify-center rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-40"
                    >
                      <Minus className="h-5 w-5" />
                    </button>
                    <span className="min-w-0 flex-1 text-center text-base font-semibold tabular-nums">{draftAmount(d)}</span>
                    <button
                      type="button"
                      onClick={() => update(d.key, { qty: qty4(Math.min(MAX_QTY, d.qty + step)) })}
                      disabled={d.qty + step > MAX_QTY}
                      aria-label="More"
                      className="flex h-12 w-12 items-center justify-center rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-40"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <label className="relative block">
          <span className="sr-only">Find an item or type a new one</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-500" />
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              // Enter takes the item of that exact name or the only match, or makes the typed name a new item.
              const same = (data?.pickable ?? []).find((p) => norm(p.name) === query);
              if (same) pick(same);
              else if (matches.length === 1 && query) pick(matches[0]);
              else addNew();
            }}
            placeholder="Find an item or type a new one"
            maxLength={80}
            disabled={full}
            className="min-h-12 w-full rounded-xl border border-stone-700 bg-stone-800 pl-11 pr-3 text-base text-white placeholder:text-stone-500 focus:border-amber-500 focus:outline-none disabled:opacity-50"
          />
        </label>
        {full && <p className="text-sm text-amber-300">That is {MAX_EXTRAS} items. Send these first, then add more.</p>}

        {isPending ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-stone-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your items…
          </div>
        ) : isError ? (
          <div className="py-6 text-center text-sm text-stone-400">
            <p>{requestErrorMessage(error, 'Could not load your items.')}</p>
            <button type="button" onClick={() => void refetch()} className="mt-3 min-h-12 rounded-xl bg-stone-800 px-4 font-semibold text-stone-200 hover:bg-stone-700">
              Try again
            </button>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {!exact && !draftedNew && typed.trim().length >= 2 && (
              <li>
                <button
                  type="button"
                  onClick={addNew}
                  disabled={full}
                  className="flex min-h-12 w-full items-center gap-2 rounded-xl border border-dashed border-amber-500/60 px-3 text-left text-base text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                >
                  <PackagePlus className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 break-words">New item: <b>{typed.trim().replace(/\s+/g, ' ')}</b></span>
                </button>
              </li>
            )}
            {matches.map((p) => {
              const already = picked.has(p.rawMaterialId);
              return (
                <li key={p.rawMaterialId}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    disabled={already || full}
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-stone-800 px-3 text-left hover:bg-stone-700 disabled:opacity-50"
                  >
                    <span className="min-w-0 break-words text-base">{p.name}</span>
                    <span className="shrink-0 text-xs text-stone-400">{already ? 'Added' : p.unit}</span>
                  </button>
                </li>
              );
            })}
            {(data?.pickable.length ?? 0) === 0 && !typed.trim() && (
              <li className="py-4 text-center text-sm text-stone-500">No items yet. Type a name to add a new one.</li>
            )}
          </ul>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row gap-2 px-4 sm:px-6 py-4 border-t border-stone-700">
        <button
          type="button"
          onClick={onBack}
          disabled={sending}
          className="min-h-12 flex-1 rounded-xl bg-stone-800 px-4 text-base font-semibold text-stone-200 hover:bg-stone-700 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={drafts.length === 0 || sending}
          className="min-h-12 flex-1 flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-base font-semibold text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShoppingCart className="h-5 w-5" />}
          {sending ? 'Sending…' : drafts.length > 1 ? `Add ${drafts.length} and send` : 'Add and send'}
        </button>
      </div>
    </>
  );
}
