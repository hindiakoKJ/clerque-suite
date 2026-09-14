'use client';
/**
 * Sauce levels: each ready-to-use prep, the parked batch behind it, and what
 * to do now.
 *
 * The owner's view of the rotation the kitchen runs -- ready to use on the
 * line (level 1), a parked batch behind it (level 2) -- without opening the
 * prep board. The decision of what to do comes from the shared rule
 * (@repo/shared-types prep-rotation), the same one the bell alerts and the
 * cook's board read.
 *
 * "Share to GC" writes the levels as a message for the owners' Viber or
 * Messenger group. Nothing is posted anywhere on its own.
 */
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { Share2, ChefHat } from 'lucide-react';
import { rotationAction, rotationChip, rotationShareText, type RotationRow, type RotationState } from '@repo/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface Rotation { branchId: string; branchName: string; rows: RotationRow[] }

const CHIP: Record<RotationState, string> = {
  COOK_NOW:      'bg-red-500/15 text-red-700 dark:text-red-400',
  TOP_UP:        'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  REFILL_BACKUP: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  OK:            'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  NO_PAR:        'bg-muted text-muted-foreground',
};

const amount = (n: number, unit: string) => `${Math.max(0, n).toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${unit}`;

export function SauceLevelsCard({ branchId, className = '' }: { branchId?: string | null; className?: string }) {
  const role = useAuthStore((s) => s.user?.role ?? '');
  // Setting a par is the setup screen's, which only the owner and MDM can open.
  const canSetPar = role === 'BUSINESS_OWNER' || role === 'MDM';
  const { data } = useQuery<Rotation>({
    queryKey: ['prep-rotation', branchId ?? ''],
    queryFn:  () => api.get('/inventory/sub-recipes/rotation', { params: branchId ? { branchId } : {} }).then((r) => r.data),
    // The line moves every sale; a minute is fresh enough to act on.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  /*
    A shop that runs no rotation has no card. Every prep a dish uses counts as
    ready to use, so a cafe with ten house syrups and no par levels would
    otherwise get ten grey "no par" rows above its sales.
  */
  if (!data) return null;
  const watched = data.rows.filter((r) => r.state !== 'NO_PAR');
  const unwatched = data.rows.length - watched.length;
  if (watched.length === 0) return null;

  const share = async () => {
    const stamp = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
    const text = rotationShareText(data.rows, `Sauce levels — ${data.branchName} · ${stamp}`);
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try { await navigator.share({ title: 'Sauce levels', text }); return; }
      catch (err) { if ((err as { name?: string })?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast.success('Copied. Paste it into Viber or Messenger.'); }
    catch { toast.error('Could not copy the levels.'); }
  };

  return (
    <section className={`rounded-xl border border-border bg-card p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ChefHat className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <h2 className="truncate text-sm font-semibold">Sauce levels{data.branchName ? ` — ${data.branchName}` : ''}</h2>
        </div>
        <button
          type="button"
          onClick={() => void share()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          title="Write the levels as a message for the owners' group chat"
        >
          <Share2 className="h-3.5 w-3.5" /> Share to GC
        </button>
      </div>

      <ul className="mt-3 divide-y divide-border">
        {watched.map((r) => {
          const action = rotationAction(r);
          return (
            <li key={r.prepId} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-medium">{r.name}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP[r.state]}`}>
                  {rotationChip(r)}
                </span>
              </div>
              <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                <span>
                  <span className="mr-1 rounded bg-[var(--accent-soft)] px-1 text-[10px] font-semibold text-[var(--accent)]">L1</span>
                  Ready to use: <strong className="text-foreground">{amount(r.ready.onHand, r.unit)}</strong>
                  {r.ready.par != null && <> · par {amount(r.ready.par, r.unit)}</>}
                </span>
                {r.backup && (
                  <span>
                    {r.backup.level === 2 && <span className="mr-1 rounded bg-muted px-1 text-[10px] font-semibold">L2</span>}
                    {r.backup.level === 2 ? 'Parked' : 'Made from'} ({r.backup.name}): <strong className="text-foreground">{amount(r.backup.onHand, r.backup.unit)}</strong>
                  </span>
                )}
                {r.serves[0] && (
                  <span className="sm:col-span-2">
                    Enough for {r.serves[0].servingsLeft.toLocaleString('en-PH')} {r.serves[0].productName}
                    {r.serves.length > 1 && <> (and {r.serves.length - 1} other dish{r.serves.length === 2 ? '' : 'es'})</>}
                  </span>
                )}
              </div>
              {action && <p className="mt-1 text-xs font-medium text-foreground">{action}</p>}
            </li>
          );
        })}
      </ul>
      {unwatched > 0 && (
        <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          {unwatched} more ready-to-use prep{unwatched === 1 ? ' has' : 's have'} no par level, so nothing warns about {unwatched === 1 ? 'it' : 'them'}.
          {canSetPar
            ? <>{' '}<Link href="/procure/batches/setup" className="text-[var(--accent)] hover:underline">Set par levels</Link></>
            : ' The owner can set them.'}
        </p>
      )}
    </section>
  );
}
