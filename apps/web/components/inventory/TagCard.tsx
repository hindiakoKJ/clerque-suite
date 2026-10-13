'use client';
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn, formatPeso } from '@/lib/utils';
import { TagPhoto } from './TagPhoto';
import { statusWords, type Tag } from '@/lib/inventory/tags';

const STATUS_TONE: Record<string, string> = {
  WAITING_FOR_COST: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  IN_STOCK:         'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  SOLD:             'bg-blue-500/15 text-blue-800 dark:text-blue-300',
  RETIRED:          'bg-red-500/15 text-red-800 dark:text-red-300',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-block rounded-md px-2 py-0.5 text-xs font-semibold', STATUS_TONE[status] ?? 'bg-muted text-muted-foreground')}>
      {statusWords(status)}
    </span>
  );
}

/**
 * One tag, the way the shop floor reads it: the photos first and large (they
 * are how a person checks the part in hand is this part), then the number,
 * what it is, the price, and whether it can be sold.
 */
export function TagCard({ tag, large = false, footer }: { tag: Tag; large?: boolean; footer?: React.ReactNode }) {
  const [shown, setShown] = useState(0);
  const photo = tag.photos[shown] ?? tag.photos[0];
  const hasCost = tag.cost !== undefined && tag.cost !== null;

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      {photo ? (
        <TagPhoto
          url={photo.url}
          alt={`Tag ${tag.number}`}
          fit="contain"
          className={cn('w-full bg-black/5', large ? 'h-80 sm:h-96' : 'h-56')}
        />
      ) : (
        <div className={cn('flex w-full flex-col items-center justify-center gap-1 bg-muted text-sm text-muted-foreground', large ? 'h-40' : 'h-32')}>
          <ImageOff className="h-6 w-6" />
          No photo yet
        </div>
      )}
      {tag.photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-b border-border p-2">
          {tag.photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setShown(i)}
              aria-label={`Show photo ${i + 1}`}
              className={cn('shrink-0 overflow-hidden rounded-lg border-2', i === shown ? 'border-[var(--accent)]' : 'border-transparent')}
            >
              <TagPhoto url={p.url} alt={`Tag ${tag.number} photo ${i + 1}`} className="h-14 w-14" />
            </button>
          ))}
        </div>
      )}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-2xl font-extrabold tracking-wider">Tag {tag.number}</p>
            <p className="mt-0.5 text-base font-semibold leading-snug">{tag.productName}</p>
            {tag.sku && <p className="font-mono text-xs text-muted-foreground">{tag.sku}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Price</p>
            <p className="text-xl font-bold">{formatPeso(Number(tag.price))}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={tag.status} />
          {tag.sellable
            ? <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Can be sold</span>
            : tag.notSellableReason && <span className="text-sm text-muted-foreground">{tag.notSellableReason}</span>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {tag.engineNumber && <><dt className="text-muted-foreground">Engine No.</dt><dd className="font-mono font-semibold">{tag.engineNumber}</dd></>}
          {tag.chassisNumber && <><dt className="text-muted-foreground">Chassis No.</dt><dd className="font-mono font-semibold">{tag.chassisNumber}</dd></>}
          {tag.notes && <><dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-line">{tag.notes}</dd></>}
          {hasCost && <><dt className="text-muted-foreground">Cost</dt><dd className="font-semibold">{formatPeso(Number(tag.cost))}</dd></>}
          <dt className="text-muted-foreground">Tagged</dt>
          <dd>{new Date(tag.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd>
        </dl>
        {footer}
      </div>
    </article>
  );
}
