'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Send, ShoppingCart, PackageCheck, Loader2, Trash2, Sparkles, Check, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * The whole of Procure on one screen.
 *
 * A request moves OPEN -> SENT -> BOUGHT -> RECEIVED, and each state needs a
 * different thing from a different person, so the screen shows only that.
 * Nobody navigates; the request tells you what it wants next.
 */

type Status = 'OPEN' | 'SENT' | 'BOUGHT' | 'RECEIVED' | 'CANCELLED';

interface Line {
  id: string;
  lineNumber: string;
  rawMaterialId: string;
  qtyRequested: string | number;
  shortBy: string | number | null;
  packsBought: string | number | null;
  packSize: string | number | null;
  packCost: string | number | null;
  brandNote: string | null;
  receivedAt: string | null;
  rawMaterial: { id: string; name: string; unit: string; costPrice: string | number | null };
}
interface Request {
  id: string;
  requestNumber: string;
  status: Status;
  lines: Line[];
  branch?: { id: string; name: string } | null;
  sentAt?: string | null;
}
interface Ingredient { id: string; name: string; unit: string }

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const peso = (v: number) =>
  `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STEPS: Array<{ key: Status; label: string }> = [
  { key: 'OPEN',     label: 'Building' },
  { key: 'SENT',     label: 'Sent' },
  { key: 'BOUGHT',   label: 'Bought' },
  { key: 'RECEIVED', label: 'In stock' },
];

export default function ProcurePage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? undefined;

  const [picking, setPicking]   = useState(false);
  const [search, setSearch]     = useState('');
  /*
    Picking an ingredient and saying how much are two different questions, and
    the second one used to be answered by the code: every tap posted
    qtyRequested: 1, which nothing on screen showed. The owner got a buy list
    reading "Biscoff Topping" with no amount, and the database read one GRAM.
    So the tap now selects, and the amount is asked for -- once, in the
    ingredient's own unit, with the field already focused.
  */
  const [pending, setPending]   = useState<Ingredient | null>(null);
  const [qty, setQty]           = useState('');
  const [editing, setEditing]   = useState<string | null>(null);
  const [editQty, setEditQty]   = useState('');
  const [bought, setBought]     = useState<Record<string, { packs: string; size: string; cost: string; brand: string }>>({});

  const { data: req, isLoading, isError, error, refetch, isFetching } = useQuery<Request>({
    queryKey: ['procure-open', branchId],
    queryFn:  () => api.post('/procure/requests/open', { branchId }).then((r) => r.data),
    enabled:  !!user,
  });

  const { data: ingredients = [], isLoading: ingLoading } = useQuery<Ingredient[]>({
    queryKey: ['raw-materials-procure'],
    queryFn:  () => api.get('/inventory/raw-materials').then((r) => r.data),
    enabled:  picking,
    staleTime: 300_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['procure-open'] });
  const fail = (e: unknown, fallback: string) =>
    toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback);

  const pull = useMutation({
    mutationFn: () => api.post('/procure/requests/pull-low-stock', { branchId }).then((r) => r.data),
    onSuccess: (d: { added: number }) => {
      refresh();
      toast.success(d.added
        ? `Added ${d.added} item${d.added === 1 ? '' : 's'} that are below their reorder level.`
        : 'Nothing is below its reorder level right now.');
    },
    onError: (e) => fail(e, 'Could not check stock levels.'),
  });

  // Posting an ingredient that is already on the list SETS its quantity rather
  // than adding a second line, so this one mutation serves both "add" and
  // "change how much".
  const addLine = useMutation({
    mutationFn: (v: { rawMaterialId: string; qtyRequested: number }) =>
      api.post(`/procure/requests/${req!.id}/lines`, v),
    onSuccess: (_d, v) => {
      refresh();
      // The picker stays open on purpose: a stock check finds several things
      // at once, and reopening it between each one is the difference between
      // a shortage round taking four taps and taking twelve. The item drops
      // out of the grid as soon as it lands, so the list is its own receipt.
      const name = ingredients.find((i) => i.id === v.rawMaterialId)?.name;
      if (name) toast.success(`${name} added.`);
      setSearch(''); setPending(null); setQty('');
      setEditing(null); setEditQty('');
    },
    onError: (e) => fail(e, 'Could not add that item.'),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => api.delete(`/procure/requests/${req!.id}/lines/${lineId}`),
    onSuccess: refresh,
    onError: (e) => fail(e, 'Could not remove that line.'),
  });

  const send = useMutation({
    mutationFn: () => api.post(`/procure/requests/${req!.id}/send`).then((r) => r.data),
    onSuccess: (d: { empty: boolean }) => {
      refresh();
      toast.success(d.empty
        ? 'Sent — nothing hit the warning level today.'
        : 'Sent to the owners.');
    },
    onError: (e) => fail(e, 'Could not send the request.'),
  });

  const saveBought = useMutation({
    mutationFn: () => api.post(`/procure/requests/${req!.id}/bought`, {
      lines: Object.entries(bought)
        .filter(([, v]) => v.packs && v.size && v.cost)
        .map(([lineId, v]) => ({
          lineId,
          packsBought: parseFloat(v.packs),
          packSize:    parseFloat(v.size),
          packCost:    parseFloat(v.cost),
          brandNote:   v.brand || undefined,
        })),
    }),
    onSuccess: () => { refresh(); toast.success('Shopping recorded.'); },
    onError: (e) => fail(e, 'Could not save what was bought.'),
  });

  const receive = useMutation({
    mutationFn: () => api.post(`/procure/requests/${req!.id}/receive`, { paymentMethod: 'CASH' }).then((r) => r.data),
    onSuccess: (d: { posted: unknown[]; skipped: unknown[]; failed: { name: string; reason: string }[] }) => {
      refresh();
      if (d.failed.length) {
        toast.warning(`${d.posted.length} posted, ${d.failed.length} could not: ${d.failed[0].reason}`);
      } else {
        toast.success(`${d.posted.length} item${d.posted.length === 1 ? '' : 's'} added to stock.`);
      }
    },
    onError: (e) => fail(e, 'Could not post to stock.'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  /*
    A failed load used to fall through the same `isLoading || !req` branch as a
    pending one, so a dead API, a closed period or a 403 all rendered a spinner
    that never stopped. Someone standing at the bar has no way to tell "still
    loading" from "this is never going to work", and no way to try again short
    of reloading the tab.
  */
  if (isError || !req) {
    const message =
      (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message ??
      'Could not load the request. Check the connection and try again.';
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" />
        <h2 className="mt-2 text-sm font-semibold">Could not open the buy list</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-4 inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50"
        >
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Try again
        </button>
      </div>
    );
  }

  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === req.status));
  const alreadyIn = new Set(req.lines.map((l) => l.rawMaterialId));
  // Everything not already on the request, alphabetical, filtered only if the
  // person chose to narrow it. No arbitrary cap -- a hidden ingredient is one
  // somebody has to hunt for.
  const matches = ingredients
    .filter((i) => !alreadyIn.has(i.id) && i.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const estimate = req.lines.reduce(
    (s, l) => s + num(l.packsBought) * num(l.packCost), 0);

  return (
    <div className="space-y-5">
      {/* where this request is up to */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="font-mono text-sm font-semibold">{req.requestNumber}</div>
            <div className="text-xs text-muted-foreground">
              {req.branch?.name ?? 'This branch'} · {req.lines.length} item{req.lines.length === 1 ? '' : 's'}
            </div>
          </div>
          {estimate > 0 && (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Spent</div>
              <div className="font-mono text-lg font-semibold">{peso(estimate)}</div>
            </div>
          )}
        </div>

        <ol className="mt-4 flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex flex-1 items-center gap-1.5">
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= stepIndex ? 'bg-[var(--accent)]' : 'bg-muted'}`} />
              <span className={`hidden text-[11px] sm:inline ${
                i === stepIndex ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* the list */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">What to buy</h2>
          {req.status === 'OPEN' && (
            <div className="flex gap-2">
              <button
                onClick={() => pull.mutate()}
                disabled={pull.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                {pull.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Check stock
              </button>
              <button
                onClick={() => setPicking((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          )}
        </div>

        {picking && req.status === 'OPEN' && (
          <div className="border-b border-border bg-muted/30 p-3">
            {pending ? (
              /*
                Step two. Asked here rather than left to a default, because a
                buy list without amounts sends someone to the market to guess,
                and a default nobody sees is worse than no default at all.
              */
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = parseFloat(qty);
                  if (!(n > 0)) { toast.error('Enter how much is needed.'); return; }
                  addLine.mutate({ rawMaterialId: pending.id, qtyRequested: n });
                }}
              >
                <div className="text-sm font-medium">{pending.name}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">How much do you need?</p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-lg border border-border py-2.5 pl-3 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      {pending.unit}
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={addLine.isPending}
                    className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  >
                    {addLine.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPending(null); setQty(''); }}
                    className="min-h-[2.75rem] rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Back
                  </button>
                </div>
              </form>
            ) : (
              <>
                {/*
                  Tap, do not type. A barista adding sugar to the list is
                  standing at the bar with one hand free; making them spell an
                  ingredient they can see on the shelf is the kind of friction
                  that sends people back to messaging the owner. Search stays,
                  but only as a way to shorten a long list -- never as the way in.
                */}
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter…"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                {ingLoading ? (
                  <div className="flex items-center gap-2 px-1 py-6 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading ingredients…
                  </div>
                ) : matches.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                    {search ? 'Nothing matches that.' : 'Everything is already on the list.'}
                  </p>
                ) : (
                  <div className="mt-2 max-h-72 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {matches.map((i) => (
                        <button
                          key={i.id}
                          onClick={() => { setPending(i); setQty(''); }}
                          className="flex min-h-[3.25rem] flex-col justify-center rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:border-[var(--accent)]/60 hover:bg-muted active:scale-[0.98]"
                        >
                          <span className="line-clamp-2 text-xs font-medium leading-tight">{i.name}</span>
                          <span className="mt-0.5 text-[10px] text-muted-foreground">{i.unit}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {req.lines.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing on the list yet. <strong className="font-medium text-foreground">Check stock</strong> pulls
            in anything below its reorder level.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {req.lines.map((l) => {
              const b = bought[l.id] ?? {
                packs: l.packsBought != null ? String(num(l.packsBought)) : '',
                size:  l.packSize    != null ? String(num(l.packSize))    : '',
                cost:  l.packCost    != null ? String(num(l.packCost))    : '',
                brand: l.brandNote ?? '',
              };
              const set = (k: keyof typeof b, v: string) =>
                setBought((prev) => ({ ...prev, [l.id]: { ...b, [k]: v } }));
              const lineTotal = (parseFloat(b.packs) || 0) * (parseFloat(b.cost) || 0);

              return (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{l.rawMaterial.name}</div>
                      {/*
                        The amount, in the ingredient's own unit, on the line
                        itself. This is the whole content of the request -- an
                        owner reading it in the grocery needs the number more
                        than the control number, so it leads.
                      */}
                      {editing === l.id ? (
                        <form
                          className="mt-1 flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const n = parseFloat(editQty);
                            if (!(n > 0)) { toast.error('Enter how much is needed.'); return; }
                            addLine.mutate({ rawMaterialId: l.rawMaterialId, qtyRequested: n });
                          }}
                        >
                          <div className="relative w-32">
                            <input
                              autoFocus
                              inputMode="decimal"
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              className="w-full rounded-lg border border-border py-1.5 pl-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                              {l.rawMaterial.unit}
                            </span>
                          </div>
                          <button type="submit" disabled={addLine.isPending}
                            className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                            {addLine.isPending ? '…' : 'Save'}
                          </button>
                          <button type="button" onClick={() => { setEditing(null); setEditQty(''); }}
                            className="px-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                            Cancel
                          </button>
                        </form>
                      ) : req.status === 'OPEN' ? (
                        <button
                          onClick={() => { setEditing(l.id); setEditQty(String(num(l.qtyRequested))); }}
                          className="mt-0.5 rounded text-sm font-semibold tabular-nums text-[var(--accent)] hover:underline"
                          aria-label={`Change how much ${l.rawMaterial.name} to buy`}
                        >
                          {num(l.qtyRequested).toLocaleString()} {l.rawMaterial.unit}
                        </button>
                      ) : (
                        <div className="mt-0.5 text-sm font-semibold tabular-nums">
                          {num(l.qtyRequested).toLocaleString()} {l.rawMaterial.unit}
                        </div>
                      )}
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {l.lineNumber}
                        {num(l.shortBy) > 0 && (
                          <span className="ml-2 font-sans">
                            short by {num(l.shortBy).toLocaleString()} {l.rawMaterial.unit}
                          </span>
                        )}
                      </div>
                    </div>
                    {req.status === 'OPEN' ? (
                      <button
                        onClick={() => removeLine.mutate(l.id)}
                        className="rounded p-1 text-red-600 transition-colors hover:bg-red-500/10"
                        aria-label={`Remove ${l.rawMaterial.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : l.receivedAt ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3 w-3" /> In stock
                      </span>
                    ) : null}
                  </div>

                  {/* what was actually bought — only once the request is out */}
                  {(req.status === 'SENT' || req.status === 'BOUGHT') && !l.receivedAt && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="text-[11px] text-muted-foreground">
                        Packs
                        <input inputMode="decimal" value={b.packs} onChange={(e) => set('packs', e.target.value)}
                          className="mt-0.5 w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        One pack holds ({l.rawMaterial.unit})
                        <input inputMode="decimal" value={b.size} onChange={(e) => set('size', e.target.value)}
                          className="mt-0.5 w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        Price per pack
                        <input inputMode="decimal" value={b.cost} onChange={(e) => set('cost', e.target.value)}
                          className="mt-0.5 w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        Brand (optional)
                        <input value={b.brand} onChange={(e) => set('brand', e.target.value)}
                          placeholder="Monin"
                          className="mt-0.5 w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                      </label>
                      {lineTotal > 0 && (
                        <div className="col-span-2 text-[11px] text-muted-foreground sm:col-span-4">
                          {b.packs} × {peso(parseFloat(b.cost) || 0)} = <strong className="font-mono text-foreground">{peso(lineTotal)}</strong>
                          {b.size && <> · {(parseFloat(b.packs) || 0) * (parseFloat(b.size) || 0)} {l.rawMaterial.unit} into stock</>}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* whatever this request wants next */}
      <div className="sticky bottom-4">
        {req.status === 'OPEN' && (
          <button
            onClick={() => send.mutate()}
            disabled={send.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send to the owners
          </button>
        )}
        {req.status === 'SENT' && (
          <button
            onClick={() => saveBought.mutate()}
            disabled={saveBought.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saveBought.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            Save what was bought
          </button>
        )}
        {req.status === 'BOUGHT' && (
          <button
            onClick={() => receive.mutate()}
            disabled={receive.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {receive.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            Add it all to stock
          </button>
        )}
        {req.status === 'RECEIVED' && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            All in stock. The next shortage starts a new request.
          </div>
        )}
      </div>

      {req.status === 'SENT' && (
        <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Fill in only what was actually bought. Anything left blank is simply skipped —
          it stays on the list for next time.
        </p>
      )}
    </div>
  );
}
