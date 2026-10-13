'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatPeso } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagCard } from '@/components/inventory/TagCard';
import { costTag, listTags } from '@/lib/inventory/tag-api';
import { PAID_FROM, apiErrorText, type PaidFrom, type Tag } from '@/lib/inventory/tags';

/**
 * Waiting for cost (owner only): every part that was tagged and photographed
 * but has no cost yet. The owner checks the photos, types what the part cost
 * and where the money came from. That one step puts the part in stock and in
 * the books, and only then can it be sold.
 */
export default function WaitingForCostPage() {
  const { data: tags = [], isLoading, isError, error, refetch } = useQuery<Tag[]>({
    queryKey: ['tags', 'WAITING_FOR_COST'],
    queryFn: () => listTags({ status: 'WAITING_FOR_COST' }),
    staleTime: 15_000,
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Waiting for cost</h2>
        <p className="text-sm text-muted-foreground">
          Setting a part&apos;s cost puts it in stock and in the books (Inventory, against where the money came from). Only then can it be sold.
        </p>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : isError ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <p className="font-medium text-red-700 dark:text-red-300">{apiErrorText(error, 'Could not load the parts waiting for cost.')}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : tags.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-base font-semibold">Nothing is waiting</p>
          <p className="mt-1 text-sm text-muted-foreground">Every tagged part has its cost.</p>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium">{tags.length} part{tags.length === 1 ? '' : 's'} waiting</p>
          <div className="grid gap-4 md:grid-cols-2">
            {tags.map((t) => (
              <TagCard key={t.id} tag={t} footer={<CostForm tag={t} />} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CostForm({ tag }: { tag: Tag }) {
  const queryClient = useQueryClient();
  const [cost, setCost] = useState('');
  const [paidFrom, setPaidFrom] = useState<PaidFrom>('OWNER_FUNDED');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const value = Number(cost);
  const valid = cost.trim() !== '' && Number.isFinite(value) && value >= 0;
  const price = Number(tag.price);
  const noPhoto = tag.photos.length === 0;

  async function save() {
    if (!valid) { setError('Type what this part cost, in pesos.'); return; }
    setSaving(true);
    setError('');
    try {
      await costTag(tag.id, Math.round(value * 100) / 100, paidFrom);
      toast.success(`Tag ${tag.number} is in stock and can be sold.`);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    } catch (e) {
      setError(apiErrorText(e, 'The cost was not saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      {noPhoto && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          This part has no photo. Add one from Find a tag before setting its cost.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Cost (₱)</span>
          <Input
            value={cost}
            onChange={(e) => { setCost(e.target.value); setError(''); }}
            inputMode="decimal"
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            className="h-12 text-lg font-semibold"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Paid from</span>
          <select
            value={paidFrom}
            onChange={(e) => setPaidFrom(e.target.value as PaidFrom)}
            className="h-12 w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus:border-[var(--accent)]"
          >
            {PAID_FROM.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </div>
      {valid && price > 0 && value > price && (
        <p className="text-xs text-amber-700 dark:text-amber-400">The cost is more than the price ({formatPeso(price)}).</p>
      )}
      {error && <p className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{error}</p>}
      <Button onClick={save} disabled={saving || noPhoto} className="h-12 w-full text-base">
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Set cost and put in stock'}
      </Button>
    </div>
  );
}
