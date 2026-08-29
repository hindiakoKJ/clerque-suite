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
  const [bought, setBought]     = useState<Record<string, { packs: string; size: string; cost: string; brand: string }>>({});

  const { data: req, isLoading } = useQuery<Request>({
    queryKey: ['procure-open', branchId],
    queryFn:  () => api.post('/procure/requests/open', { branchId }).then((r) => r.data),
    enabled:  !!user,
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
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

  const addLine = useMutation({
    mutationFn: (rawMaterialId: string) =>
      api.post(`/procure/requests/${req!.id}/lines`, { rawMaterialId, qtyRequested: 1 }),
    onSuccess: () => { refresh(); setPicking(false); setSearch(''); },
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

  if (isLoading || !req) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === req.status));
  const alreadyIn = new Set(req.lines.map((l) => l.rawMaterialId));
  const matches = ingredients
    .filter((i) => !alreadyIn.has(i.id) && i.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8);

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
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search an ingredient…"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            {search && (
              <ul className="mt-2 space-y-1">
                {matches.length === 0 && (
                  <li className="px-1 py-2 text-xs text-muted-foreground">No match.</li>
                )}
                {matches.map((i) => (
                  <li key={i.id}>
                    <button
                      onClick={() => addLine.mutate(i.id)}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span>{i.name}</span>
                      <span className="text-xs text-muted-foreground">{i.unit}</span>
                    </button>
                  </li>
                ))}
              </ul>
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
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{l.rawMaterial.name}</div>
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
