'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface CycleCount {
  id:          string;
  countNumber: string;
  status:      'OPEN' | 'POSTED' | 'CANCELLED';
  branch:      { id: string; name: string };
  createdAt:   string;
  postedAt:    string | null;
  notes:       string | null;
  _count:      { lines: number };
}

const TINT: Record<string, string> = {
  OPEN:      'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  POSTED:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export default function CycleCountsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [openCountId, setOpenCountId] = useState<string | null>(null);

  const { data: counts = [] } = useQuery<CycleCount[]>({
    queryKey: ['cycle-counts'],
    queryFn:  () => api.get('/warehouse/cycle-counts').then((r) => r.data),
  });

  /*
    Posting asks WHICH KIND of count this is, because the two mean opposite
    things to the books.

    A routine count found a discrepancy: something was wrong, and the
    difference is written off to 5060. A shop's FIRST count is not a
    discrepancy at all — nothing was wrong, the owner simply has stock on the
    shelf — and it credits 3010 Owner's Capital.

    The endpoint has always accepted `isOpeningBalance`; this screen never sent
    it, so it defaulted to false and an opening count booked the entire shelf
    as a NEGATIVE write-off. On ₱48,000 of opening stock that is ₱48,000 of
    invented profit in the first income statement the BIR ever sees.
  */
  const [postTarget, setPostTarget] = useState<CycleCount | null>(null);

  const post = useMutation({
    mutationFn: (v: { id: string; isOpeningBalance: boolean }) =>
      api.post(`/warehouse/cycle-counts/${v.id}/post`, { isOpeningBalance: v.isOpeningBalance })
        .then((r) => r.data),
    onSuccess: (d: { warnings?: string[] }, v) => {
      qc.invalidateQueries({ queryKey: ['cycle-counts'] });
      setPostTarget(null);
      /*
        A first count at a shop that has not priced its ingredients yet can
        come back with a warning per line — dozens of them. Say it once, with
        the number, instead of stacking toasts; and do not say "variances
        applied" as if the books had moved when some of them could not.
      */
      const warnings = d?.warnings ?? [];
      const n = warnings.length;
      toast.success(v.isOpeningBalance
        ? 'Posted as opening stock — booked to Owner’s Capital.'
        : n === 0 ? 'Posted — variances applied.' : 'Posted — the counts are saved.');
      if (n > 0) {
        toast.warning(
          `${n} ingredient${n === 1 ? '' : 's'} had no cost on file, so ${n === 1 ? 'that count' : 'those counts'} `
          + 'changed the shelf but not the books. Set their cost under Stock on hand.',
          { duration: 12000 },
        );
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-[var(--accent)]" />
            Cycle Counts
          </h1>
          <p className="text-sm text-muted-foreground">Physical-count sessions per branch with variance posting.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Start Count
        </button>
      </header>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        {counts.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No counts yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Number</th>
                <th className="text-left px-4 py-2 font-medium">Branch</th>
                <th className="text-right px-4 py-2 font-medium">Lines</th>
                <th className="text-center px-4 py-2 font-medium">Status</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {counts.map((c) => (
                <tr key={c.id} className="border-t border-border/40">
                  <td className="px-4 py-2.5 font-mono text-xs">{c.countNumber}</td>
                  <td className="px-4 py-2.5">{c.branch.name}</td>
                  <td className="px-4 py-2.5 text-right">{c._count.lines}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${TINT[c.status]}`}>
                      {c.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">
                    {c.status === 'OPEN' && (
                      <>
                        <button
                          onClick={() => setOpenCountId(c.id)}
                          className="text-xs text-[var(--accent)] hover:underline mr-2"
                        >
                          Count
                        </button>
                        {/*
                          Posting moves stock by the difference this count
                          found and books the adjustment. There is no unpost --
                          the only statuses are OPEN / POSTED / CANCELLED --
                          and this was an unlabelled icon a thumb could catch
                          while scrolling, so it opens a dialog rather than
                          firing. That dialog also asks whether this is the
                          shop's FIRST count, which decides whether the value
                          lands in a write-off or in Owner's Capital.
                        */}
                        <button
                          onClick={() => setPostTarget(c)}
                          disabled={post.isPending}
                          className="p-1.5 rounded text-emerald-700 hover:bg-emerald-500/15"
                          title="Post variances"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {postTarget && (
        <PostCountModal
          count={postTarget}
          pending={post.isPending}
          onCancel={() => setPostTarget(null)}
          onPost={(isOpeningBalance) => post.mutate({ id: postTarget.id, isOpeningBalance })}
        />
      )}
      {showNew && <NewCountModal onClose={() => setShowNew(false)} />}
      {openCountId && <CountSheetModal countId={openCountId} onClose={() => setOpenCountId(null)} />}
    </div>
  );
}

/**
 * Which kind of count is this?
 *
 * The same counted numbers mean opposite things to the books depending on the
 * answer, and only the person who did the counting knows which it is. A
 * routine count found something WRONG and the difference is a write-off; a
 * first count found nothing wrong at all — it is the owner's stock arriving on
 * the books.
 *
 * Asked rather than inferred. The system could guess "no previous count means
 * opening", but a shop adopting Clerque mid-life has real stock AND a real
 * history, and guessing wrong writes tens of thousands of pesos into the wrong
 * account on the first statement anyone sees.
 */
function PostCountModal({
  count, pending, onCancel, onPost,
}: {
  count: { countNumber: string; branch: { name: string }; _count: { lines: number } };
  pending: boolean;
  onCancel: () => void;
  onPost: (isOpeningBalance: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-lg">Post {count.countNumber}</h2>
          <p className="text-sm text-muted-foreground">
            {count.branch?.name} · {count._count?.lines} item{count._count?.lines === 1 ? '' : 's'}
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          Stock moves by the difference this count found, so anything sold while
          you were counting is kept. This cannot be undone.
        </p>

        <div className="space-y-2">
          <button
            onClick={() => onPost(false)}
            disabled={pending}
            className="w-full text-left rounded-xl border border-border p-3 hover:bg-muted disabled:opacity-50"
          >
            <span className="block text-sm font-semibold">Routine count</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Correcting the records. The difference is booked as a stock
              write-off or gain.
            </span>
          </button>
          <button
            onClick={() => onPost(true)}
            disabled={pending}
            className="w-full text-left rounded-xl border border-border p-3 hover:bg-muted disabled:opacity-50"
          >
            <span className="block text-sm font-semibold">
              Opening stock — this shop&apos;s first count
            </span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Nothing was wrong. Booked to Owner&apos;s Capital as stock the
              owner put into the business.
            </span>
          </button>
        </div>

        <div className="flex justify-end">
          <button onClick={onCancel} disabled={pending} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function NewCountModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  /*
    GET /tenant/branches returns a BARE ARRAY (tenant.service.ts getBranches),
    not { data: [...] }. Reading .data off an array gives undefined, so the
    branch list was permanently empty -- the picker showed only its placeholder
    and the Start button stayed disabled forever. This screen could not be used
    at all. Accept either shape so it cannot break again if the endpoint is
    ever wrapped.
  */
  type Br = { id: string; name: string };
  const { data: branchData } = useQuery<Br[] | { data: Br[] }>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });
  const branches: Br[] = Array.isArray(branchData) ? branchData : branchData?.data ?? [];
  const [branchId, setBranchId] = useState('');
  const [notes, setNotes] = useState('');

  const start = useMutation({
    mutationFn: () => api.post('/warehouse/cycle-counts', { branchId, notes }).then((r) => r.data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['cycle-counts'] }); toast.success('Count started.'); onClose(); },
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold">Start Cycle Count</h2>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <option value="">— branch —</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button onClick={() => start.mutate()} disabled={!branchId || start.isPending} className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50">
            {start.isPending ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CountSheetModal({ countId, onClose }: { countId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: count } = useQuery<{
    id: string; countNumber: string; status: string;
    lines: Array<{ id: string; expectedQty: string; countedQty: string; varianceQty: string;
                   rawMaterial: { id: string; name: string; unit: string } }>;
  }>({
    queryKey: ['cycle-count', countId],
    queryFn:  () => api.get(`/warehouse/cycle-counts/${countId}`).then((r) => r.data),
  });

  const setLine = useMutation({
    mutationFn: ({ lineId, countedQty }: { lineId: string; countedQty: number }) =>
      api.patch(`/warehouse/cycle-counts/lines/${lineId}`, { countedQty }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycle-count', countId] }),
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <header className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-border">
          <h2 className="font-semibold font-mono text-sm">{count?.countNumber}</h2>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </header>
        <div className="px-5 py-3 max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left py-2">Item</th>
                <th className="text-right py-2">Expected</th>
                <th className="text-right py-2">Counted</th>
                <th className="text-right py-2">Variance</th>
              </tr>
            </thead>
            <tbody>
              {(count?.lines ?? []).map((l) => {
                const variance = Number(l.countedQty) - Number(l.expectedQty);
                return (
                  <tr key={l.id} className="border-t border-border/40">
                    <td className="py-2">{l.rawMaterial.name} <span className="text-xs text-muted-foreground">({l.rawMaterial.unit})</span></td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{Number(l.expectedQty).toFixed(3)}</td>
                    <td className="py-2 text-right">
                      <input
                        type="number" step="0.001"
                        defaultValue={l.countedQty}
                        onBlur={(e) => {
                          const val = Number(e.target.value);
                          if (!isNaN(val) && val !== Number(l.countedQty)) {
                            setLine.mutate({ lineId: l.id, countedQty: val });
                          }
                        }}
                        className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-right text-sm"
                      />
                    </td>
                    <td className={`py-2 text-right tabular-nums font-medium ${variance === 0 ? 'text-muted-foreground' : variance > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {variance === 0 ? '—' : (variance > 0 ? '+' : '') + variance.toFixed(3)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
