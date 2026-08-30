'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, ChevronRight, Boxes } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { LoadFailed } from '@/components/shared/LoadFailed';

/**
 * What is capping the menu.
 *
 * The till already says "16 left" on a latte tile, and that number is true —
 * but it is the wrong end of the telescope for anyone who can do something
 * about it. The cashier sees a consequence and has to shout across the room.
 * Whoever buys the stock needs the cause: which ingredient, how much of it is
 * left, and how much of the menu it is holding back.
 *
 * So this inverts the POS view. One row per ingredient that is setting a
 * ceiling, ordered by how soon it bites, with the products it blocks listed
 * underneath and a way to put it on the buy list without leaving the page.
 */

interface Ceiling {
  branchId: string;
  productsChecked: number;
  ingredients: Array<{
    rawMaterialId: string;
    name: string;
    unit: string;
    stock: number;
    servingsLeft: number;
    productCount: number;
    products: Array<{ id: string; name: string; canMake: number }>;
  }>;
}

const num = (v: number) => v.toLocaleString('en-PH', { maximumFractionDigits: 2 });

export default function MenuCeilingPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? undefined;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<Ceiling>({
    queryKey: ['procure-menu-ceiling', branchId],
    queryFn:  () => api.get('/procure/requests/menu-ceiling', { params: { branchId } }).then((r) => r.data),
    enabled:  !!user,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Working out what is short…
      </div>
    );
  }
  if (isError || !data) {
    return <LoadFailed what="the menu ceiling" error={error}
      onRetry={() => void refetch()} retrying={isFetching} />;
  }

  const urgent = data.ingredients.filter((i) => i.servingsLeft <= 20);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-semibold">What is limiting the menu</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The number on a POS tile is how many of that item can still be made. This is the
          ingredient behind it — {data.productsChecked} recipe{data.productsChecked === 1 ? '' : 's'} checked.
        </p>
      </div>

      {data.ingredients.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing is capping the menu right now. Every recipe has enough of everything.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.ingredients.map((i) => {
            const tight = i.servingsLeft <= 20;
            return (
              <li
                key={i.rawMaterialId}
                className={`rounded-xl border p-4 ${
                  tight ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-card'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {tight && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                      <span className="truncate font-medium">{i.name}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <strong className="font-semibold text-foreground">
                        {num(i.stock)} {i.unit}
                      </strong>{' '}
                      in stock — enough for{' '}
                      <strong className="font-semibold text-foreground">
                        {num(i.servingsLeft)}
                      </strong>{' '}
                      more of the tightest item.
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Setting the ceiling on {i.productCount} menu item{i.productCount === 1 ? '' : 's'}.
                    </p>
                  </div>
                  <Link
                    href="/procure/requests"
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    Buy list
                  </Link>
                </div>

                {/* What it is actually holding back, tightest first. */}
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {i.products.slice(0, 12).map((p) => (
                    <li
                      key={p.id}
                      className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {p.name} <span className="tabular-nums">· {num(p.canMake)}</span>
                    </li>
                  ))}
                  {i.products.length > 12 && (
                    <li className="px-1 py-0.5 text-[11px] text-muted-foreground">
                      +{i.products.length - 12} more
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {urgent.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {urgent.length} ingredient{urgent.length === 1 ? '' : 's'} will run out within about
            twenty servings. <Link href="/procure/requests" className="underline">Check stock</Link>{' '}
            on the buy list pulls in anything already below its reorder level — this page also
            catches the ones that have no reorder level set yet.
          </span>
        </p>
      )}
    </div>
  );
}
