'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { cn, formatPeso } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BranchPicker } from '@/components/inventory/BranchPicker';
import { StatusBadge } from '@/components/inventory/TagCard';
import { TagPhoto } from '@/components/inventory/TagPhoto';
import { useInventoryBranch } from '@/hooks/inventory/useInventoryBranch';
import { listTags } from '@/lib/inventory/tag-api';
import { apiErrorText, type Tag, type TagStatus } from '@/lib/inventory/tags';

/**
 * All tags (owner, manager, MDM): every tagged part, by status, with a search
 * over the number, the product, the engine or chassis number and the notes.
 * The cost column appears only when the server sent costs, which it does for
 * the owner (or a role the shop lets see costs).
 */

const FILTERS: { value: TagStatus | ''; label: string }[] = [
  { value: '',                 label: 'All' },
  { value: 'WAITING_FOR_COST', label: 'Waiting for cost' },
  { value: 'IN_STOCK',         label: 'In stock' },
  { value: 'SOLD',             label: 'Sold' },
  { value: 'RETIRED',          label: 'Written off' },
];

export default function AllTagsPage() {
  const { branchId } = useInventoryBranch();
  const [status, setStatus] = useState<TagStatus | ''>('');
  const [q, setQ] = useState('');
  const query = useDebounce(q.trim(), 300);

  const { data: tags = [], isLoading, isError, error, refetch, isFetching } = useQuery<Tag[]>({
    queryKey: ['tags', 'list', status, branchId, query],
    queryFn: () => listTags({ status, branchId, q: query }),
    staleTime: 15_000,
  });

  const showCost = tags.some((t) => t.cost !== undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">All tags</h2>
          <p className="text-sm text-muted-foreground">Every tagged part, and where it is in its life.</p>
        </div>
        <BranchPicker />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value || 'ALL'}
            type="button"
            onClick={() => setStatus(f.value)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              status === f.value
                ? 'border-transparent bg-[var(--accent)] text-white'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a number, a part, an engine or chassis number"
          className="h-11 pl-9"
          aria-label="Search tags"
        />
        {isFetching && !isLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : isError ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <p className="font-medium text-red-700 dark:text-red-300">{apiErrorText(error, 'Could not load the tags.')}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : tags.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {query || status ? 'No tags match.' : 'No parts have been tagged yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Price</th>
                {showCost && <th className="px-3 py-2 text-right">Cost</th>}
                <th className="px-3 py-2">Tagged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tags.map((t) => (
                <tr key={t.id} className="align-middle">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {t.photos[0]
                        ? <TagPhoto url={t.photos[0].url} alt={`Tag ${t.number}`} className="h-10 w-10 shrink-0 rounded-md" />
                        : <span className="h-10 w-10 shrink-0 rounded-md bg-muted" aria-hidden />}
                      <span className="font-mono font-bold">{t.number}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium leading-snug">{t.productName}</div>
                    {(t.engineNumber || t.chassisNumber) && (
                      <div className="font-mono text-xs text-muted-foreground">
                        {t.engineNumber ? `Engine ${t.engineNumber}` : `Chassis ${t.chassisNumber}`}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatPeso(Number(t.price))}</td>
                  {showCost && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {t.cost !== undefined && t.cost !== null ? formatPeso(Number(t.cost)) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
