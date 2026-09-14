'use client';
/**
 * Where things are bought.
 *
 * The owner's question: where do we usually get this, and is that the cheap
 * place? Per item, the store it is usually bought from and every store it was
 * bought at, with the last price and the cheapest price per unit. Per store,
 * the trips, the items and the spend. Built from the purchase lines themselves,
 * so it fills in as purchases are recorded with where they were bought.
 *
 * Store names are for everyone who can open Procure; prices and spend only for
 * people who may see purchase costs -- the server leaves them out otherwise.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Store, AlertTriangle, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { sourceText, usuallyFromText, SOURCE_KIND_LABEL, type SourceKind, type UsuallyFrom } from '@repo/shared-types';

interface StoreOfItem {
  key: string; kind: SourceKind | null; name: string | null; times: number; lastOn: string | null;
  lastPackSize: number | null; lastPackCost: number | null; bestPerUnit: number | null; spend: number | null;
}
interface ItemRow {
  rawMaterialId: string; name: string; unit: string; buys: number; withoutStore: number; lastOn: string | null;
  spend: number | null; usuallyFrom: UsuallyFrom | null; cheapestKey: string | null; stores: StoreOfItem[];
}
interface StoreRow { key: string; kind: SourceKind | null; name: string | null; trips: number; buys: number; items: number; lastOn: string | null; spend: number | null }
interface Report {
  from: string; to: string; showMoney: boolean; truncated: boolean;
  totals: { buys: number; withStore: number; trips: number; stores: number; spend: number | null };
  items: ItemRow[];
  stores: StoreRow[];
}

const manilaDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const shortDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }) : '—');

/** A price per gram reads as nothing; per kilo (or litre) is how a shopper compares. */
function perUnit(price: number, unit: string): string {
  const u = unit.toLowerCase();
  if (u === 'g') return `${formatPeso(price * 1000)}/kg`;
  if (u === 'ml') return `${formatPeso(price * 1000)}/L`;
  return `${formatPeso(price)}/${unit}`;
}

export default function WhereBoughtPage() {
  const user = useAuthStore((s) => s.user);
  const [to, setTo] = useState(() => manilaDay(new Date()));
  const [from, setFrom] = useState(() => manilaDay(new Date(Date.now() - 89 * 86_400_000)));
  const [view, setView] = useState<'items' | 'stores'>('items');
  const [q, setQ] = useState('');

  // A cleared or backwards date asks for nothing, and says why, instead of an error.
  const datesOk = !!from && !!to && from <= to;
  // The server keeps a branch's staff to their own branch; an owner sees the whole shop.
  const { data, isPending, isError, error, refetch, isFetching } = useQuery<Report>({
    queryKey: ['procure-where-bought', from, to, user?.sub],
    queryFn:  () => api.get('/procure/requests/where-bought', { params: { from, to } }).then((r) => r.data),
    enabled:  !!user && datesOk,
    staleTime: 60_000,
  });

  const needle = q.trim().toLowerCase();
  const items = useMemo(() => (data?.items ?? []).filter((i) => !needle
    || i.name.toLowerCase().includes(needle)
    || i.stores.some((s) => (sourceText(s.kind, s.name) ?? '').toLowerCase().includes(needle))), [data, needle]);
  const stores = useMemo(() => (data?.stores ?? []).filter((s) => !needle
    || (sourceText(s.kind, s.name) ?? '').toLowerCase().includes(needle)), [data, needle]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Store className="h-5 w-5 text-[var(--accent)]" /> Where things are bought</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Where each item is usually bought, and what it cost there. It fills in as purchases are recorded with
          {' '}<strong>Where was it bought?</strong> on the <Link href="/procure/requests" className="font-medium text-[var(--accent)] hover:underline">buy list</Link>.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-muted-foreground">To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-0.5 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
        </label>
        <label className="relative min-w-[12rem] flex-1 text-xs text-muted-foreground">Find
          <Search className="pointer-events-none absolute bottom-2 left-2 h-4 w-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Milk, Puregold…"
            className="mt-0.5 block w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm" />
        </label>
        <div className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
          {(['items', 'stores'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`px-3 py-1.5 ${view === v ? 'bg-[var(--accent)] text-white' : 'bg-background hover:bg-muted'}`}>
              {v === 'items' ? 'By item' : 'By store'}
            </button>
          ))}
        </div>
      </div>

      {!datesOk ? (
        <p className="text-sm text-muted-foreground">Pick a From date on or before the To date.</p>
      ) : isPending && isFetching ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-amber-500" /> Could not load where things are bought</p>
          <p className="mt-1 text-muted-foreground">
            {(error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message ?? 'Check the connection and try again.'}
          </p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">Try again</button>
        </div>
      ) : !data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <>
          <p className="text-sm">
            <strong>{data.totals.buys.toLocaleString('en-PH')}</strong> purchase{data.totals.buys === 1 ? '' : 's'} on{' '}
            <strong>{data.totals.trips.toLocaleString('en-PH')}</strong> buy list{data.totals.trips === 1 ? '' : 's'}
            {data.totals.spend != null && <> · {formatPeso(data.totals.spend)} spent</>}
            {' · '}{data.totals.withStore.toLocaleString('en-PH')} say where they were bought
          </p>
          {data.totals.buys > data.totals.withStore && (
            <p className="text-xs text-muted-foreground">
              Purchases recorded before today, or without a store, count toward the totals but not toward a store.
            </p>
          )}
          {data.truncated && (
            <p className="text-xs text-amber-700 dark:text-amber-400">Only the newest 20,000 purchase lines are counted. Narrow the dates for the full picture.</p>
          )}

          {view === 'items' ? (
            items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing bought in these dates{needle ? ' matches' : ''}.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {items.map((it) => (
                  <li key={it.rawMaterialId} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{it.name}</span>
                      <span className="text-xs text-muted-foreground">
                        bought {it.buys} time{it.buys === 1 ? '' : 's'} · last {shortDay(it.lastOn)}
                        {it.spend != null && <> · {formatPeso(it.spend)}</>}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {usuallyFromText(it.usuallyFrom) ?? 'No store recorded yet.'}
                      {it.withoutStore > 0 && it.usuallyFrom && ` (${it.withoutStore} with no store)`}
                    </p>
                    {it.stores.length > 0 && (
                      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {it.stores.map((st) => (
                          <li key={st.key} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{sourceText(st.kind, st.name)}</span>
                              {it.cheapestKey === st.key && (
                                <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">cheapest</span>
                              )}
                            </div>
                            <div className="mt-0.5 text-muted-foreground">
                              {st.times} time{st.times === 1 ? '' : 's'} · last {shortDay(st.lastOn)}
                              {st.lastPackCost != null && st.lastPackSize != null && (
                                <> · {formatPeso(st.lastPackCost)} for {st.lastPackSize.toLocaleString('en-PH')} {it.unit}</>
                              )}
                              {st.bestPerUnit != null && <> · best {perUnit(st.bestPerUnit, it.unit)}</>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : stores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchase in these dates says where it was bought{needle ? ' and matches' : ''}.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Store</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2 text-right">Buy lists</th>
                    <th className="px-3 py-2 text-right">Items</th>
                    {data.showMoney && <th className="px-3 py-2 text-right">Spent</th>}
                    <th className="px-3 py-2">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stores.map((st) => (
                    <tr key={st.key}>
                      <td className="px-3 py-2 font-medium">{st.name ?? (st.kind ? SOURCE_KIND_LABEL[st.kind] : '—')}</td>
                      <td className="px-3 py-2 text-muted-foreground">{st.kind ? SOURCE_KIND_LABEL[st.kind] : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{st.trips}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{st.items}</td>
                      {data.showMoney && <td className="px-3 py-2 text-right tabular-nums">{st.spend != null ? formatPeso(st.spend) : '—'}</td>}
                      <td className="px-3 py-2 text-muted-foreground">{shortDay(st.lastOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
