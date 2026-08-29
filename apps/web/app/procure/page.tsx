'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList, Boxes, PackagePlus, ArrowLeftRight, ChevronRight, Loader2, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Procure's home.
 *
 * Everything to do with stock lives here so the POS can stay a POS. The one
 * live number on the page is the shortage count, because that is the only
 * thing that should ever pull someone into this app unprompted.
 */

interface LowRow { name?: string; shortBy?: number | string; rawMaterialId?: string }
interface Request { id: string; requestNumber: string; status: string; lines: unknown[] }

export default function ProcureHome() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? undefined;

  const { data: low = [], isLoading: lowLoading } = useQuery<LowRow[]>({
    queryKey: ['procure-low', branchId],
    queryFn:  () => api.get('/inventory/low-stock', { params: { branchId } }).then((r) => r.data),
    enabled:  !!user,
    staleTime: 30_000,
  });

  const { data: req } = useQuery<Request>({
    queryKey: ['procure-open', branchId],
    queryFn:  () => api.post('/procure/requests/open', { branchId }).then((r) => r.data),
    enabled:  !!user,
  });

  const shortages = low.filter((r) => Number(r.shortBy ?? 0) > 0).length;

  const tiles = [
    {
      href:  '/procure/requests',
      Icon:  ClipboardList,
      title: 'Purchase request',
      desc:  'Build the buy list, send it, record what was bought.',
      note:  req ? `${req.requestNumber} · ${req.lines.length} item${req.lines.length === 1 ? '' : 's'}` : null,
    },
    {
      href:  '/pos/inventory',
      Icon:  Boxes,
      title: 'Stock on hand',
      desc:  'Every ingredient, what it costs, what is left.',
      note:  null,
    },
    {
      href:  '/pos/inventory',
      Icon:  PackagePlus,
      title: 'Receive stock',
      desc:  'Record a delivery that did not come from a request.',
      note:  null,
    },
    {
      href:  '/pos/warehouse/transfers',
      Icon:  ArrowLeftRight,
      title: 'Transfers',
      desc:  'Move stock between locations.',
      note:  'Between branches today — see below',
    },
  ];

  return (
    <div className="space-y-5">
      {/* the only thing that should pull someone in here unprompted */}
      <Link
        href="/procure/requests"
        className={`block rounded-xl border p-4 transition-colors sm:p-5 ${
          shortages > 0
            ? 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
            : 'border-border bg-card hover:bg-muted/40'
        }`}
      >
        <div className="flex items-center gap-3">
          {lowLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : shortages > 0 ? (
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          ) : (
            <Boxes className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {lowLoading
                ? 'Checking stock…'
                : shortages > 0
                  ? `${shortages} item${shortages === 1 ? '' : 's'} below the reorder level`
                  : 'Nothing is below its reorder level'}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {shortages > 0
                ? 'Add them to the request before anyone leaves for the market.'
                : 'Reorder levels are set per ingredient under Stock on hand.'}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </Link>

      <div className="grid gap-2 sm:grid-cols-2">
        {tiles.map(({ href, Icon, title, desc, note }) => (
          <Link
            key={title}
            href={href}
            className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-[var(--accent)]/50 hover:bg-muted/30"
          >
            <Icon className="h-5 w-5 text-[var(--accent)]" />
            <div className="mt-2.5 text-sm font-semibold">{title}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
            {note && (
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{note}</p>
            )}
          </Link>
        ))}
      </div>

      {/*
        Said plainly rather than hidden behind a tile that half-works. Stock
        transfers move between BRANCHES; a stockroom, a bar and a kitchen are
        rooms inside one branch, and RawMaterialInventory is keyed on
        (branch, ingredient) with no room in between. Until that is decided,
        the tile above goes to the branch-to-branch transfer that does exist.
      */}
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <strong className="font-medium text-foreground">Room-to-room transfers are not built yet.</strong>{' '}
          Stock is currently held per branch, so moving from the stockroom to the bar has nowhere to
          go. Either those rooms become branches, or ingredients gain a location — worth deciding
          before it is built, because the second one changes how every stock read works.
        </span>
      </p>
    </div>
  );
}
