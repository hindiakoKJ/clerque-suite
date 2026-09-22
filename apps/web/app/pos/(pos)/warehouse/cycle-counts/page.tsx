'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { activeBranches } from '@/app/procure/active-branches';
import { countBadge, countCaption, isWeeklyCount, leftAloneText, postedTitle, type BadgeTone, type PostResult } from '@/app/procure/cycle-counts/count-row';
import { PostCountModal } from '@/components/procure/PostCountModal';
import { WeeklyCountReview } from '@/components/procure/WeeklyCountReview';

interface CycleCount {
  id:          string;
  countNumber: string;
  // RECORDED: a kitchen or bar screen's weekly count as it was sent. Stock and the books untouched.
  status:      'OPEN' | 'RECORDED' | 'POSTED' | 'CANCELLED';
  branch:      { id: string; name: string };
  createdAt:   string;
  postedAt:    string | null;
  notes:       string | null;
  _count:      { lines: number };
}

/** Who may open a weekly count's review (station-count.controller.ts WEEKLY_REVIEW_ROLES); warehouse staff see the badge only. */
const WEEKLY_REVIEW_ROLES: string[] = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SUPER_ADMIN'];

const TINT: Record<BadgeTone, string> = {
  open:      'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  recorded:  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  posted:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  cancelled: 'bg-muted text-muted-foreground',
  other:     'bg-muted text-muted-foreground',
};

// useSearchParams has to sit inside a Suspense boundary, or Next's build cannot prerender the page.
export default function CycleCountsPage() {
  return (
    <Suspense>
      <CycleCounts />
    </Suspense>
  );
}

function CycleCounts() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [openCountId, setOpenCountId] = useState<string | null>(null);
  /*
    A kitchen or bar screen's weekly count opens in its own review: the
    reconciliation, with "Adjust the books to match" and "Ask for a recount".
    The bell for a sent count links here with ?review=<id>. Read from the
    address as it changes, not once on load: the bell can be tapped while
    this page is already open, and then only the address changes.
  */
  const [reviewId, setReviewId] = useState<string | null>(null);
  const canReview = useAuthStore((s) => !!s.user && (!!s.user.isSuperAdmin || WEEKLY_REVIEW_ROLES.includes(s.user.role)));
  const wanted = useSearchParams().get('review');
  useEffect(() => {
    if (wanted) setReviewId(wanted);
  }, [wanted]);
  const closeReview = () => {
    setReviewId(null);
    // Off the address too, so a refresh does not open it again.
    if (new URLSearchParams(window.location.search).has('review')) window.history.replaceState(null, '', window.location.pathname);
  };

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
    onSuccess: (d: PostResult, v) => {
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
      toast.success(postedTitle(d, v.isOpeningBalance));
      // An item another count had already adjusted or counted again is left alone: said, with why, so the shelf's figure does not surprise.
      const left = leftAloneText(d);
      if (left) toast.info(left, { duration: 15000 });
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

      {/*
        Scrolls sideways rather than clipping: on a phone the table is wider
        than the card, and with overflow hidden the Count and Post buttons on
        the right were cut off -- the count is done standing at the shelf with
        a phone, and nobody could open or post one.
      */}
      <section className="rounded-xl border border-border bg-card overflow-x-auto">
        {counts.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No counts yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 sm:px-4 py-2 font-medium">Number</th>
                {/* Off on a phone, so Count and Post fit beside the number without scrolling. */}
                <th className="hidden sm:table-cell text-left px-4 py-2 font-medium">Branch</th>
                <th className="text-right px-3 sm:px-4 py-2 font-medium">Lines</th>
                {/* Under the number on a phone: "Recorded - books not changed" does not fit a column there. */}
                <th className="hidden sm:table-cell text-center px-3 sm:px-4 py-2 font-medium">Status</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {counts.map((c) => {
                const weekly = isWeeklyCount(c.notes);
                const badge = countBadge(c);
                const badgeEl = (
                  <span className={`inline-block text-xs font-semibold rounded-full px-2 py-0.5 ${TINT[badge.tone]}`}>
                    {badge.label}
                  </span>
                );
                return (
                  <tr key={c.id} className="border-t border-border/40">
                    <td className="px-3 sm:px-4 py-2.5">
                      <span className="block font-mono text-xs">{c.countNumber}</span>
                      {/* When, and whether a buy list started it: six one-line counts from six lists looked the same. */}
                      <span className="block text-[11px] text-muted-foreground">{countCaption(c)}</span>
                      <span className="mt-1 block sm:hidden">{badgeEl}</span>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5">{c.branch.name}</td>
                    <td className="px-3 sm:px-4 py-2.5 text-right">{c._count.lines}</td>
                    <td className="hidden sm:table-cell px-3 sm:px-4 py-2.5 text-center">{badgeEl}</td>
                    <td className="px-2 py-2.5 text-right whitespace-nowrap">
                      {/*
                        A weekly count is reviewed, never counted or posted from
                        here: a recorded one is the station's count as it was
                        sent, and its review holds Adjust the books to match.
                      */}
                      {weekly && canReview && (
                        <button
                          onClick={() => setReviewId(c.id)}
                          className="inline-flex min-h-9 items-center px-1 text-xs font-medium text-[var(--accent)] hover:underline"
                        >
                          Review
                        </button>
                      )}
                      {!weekly && c.status === 'OPEN' && (
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
                            className="inline-flex items-center gap-1 rounded p-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/15"
                            title="Post variances"
                          >
                            <CheckCircle2 className="h-4 w-4" /> Post
                          </button>
                        </>
                      )}
                      {/* A posted count can be opened to read what was counted; nothing on it can change. */}
                      {!weekly && c.status === 'POSTED' && (
                        <button
                          onClick={() => setOpenCountId(c.id)}
                          className="text-xs text-[var(--accent)] hover:underline"
                        >
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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
      {reviewId && canReview && <WeeklyCountReview key={reviewId} countId={reviewId} onClose={closeReview} />}
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
  type Br = { id: string; name: string; isActive?: boolean };
  const { data: branchData } = useQuery<Br[] | { data: Br[] }>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });
  // Branches still in use only: a closed branch has no shelf to count.
  const branches: Br[] = activeBranches(Array.isArray(branchData) ? branchData : branchData?.data ?? []);
  const user = useAuthStore((s) => s.user);
  const [branchId, setBranchId] = useState('');
  const [notes, setNotes] = useState('');
  /*
    Chosen for the person whenever it can be: their own branch, or the only
    one the shop has. A one-branch owner was shown "— branch —" and a greyed
    Start button on every count.
  */
  const defaultBranch = user?.branchId || (branches.length === 1 ? branches[0].id : '');
  useEffect(() => { if (!branchId && defaultBranch) setBranchId(defaultBranch); }, [branchId, defaultBranch]);

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
  // Only an open count takes numbers; a posted one is opened to read.
  const editable = count?.status === 'OPEN';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <header className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-border">
          <h2 className="font-semibold font-mono text-sm">
            {count?.countNumber}
            {count && !editable && <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">{count.status.toLowerCase()} — view only</span>}
          </h2>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </header>
        {/* Sideways too: four columns and a number box do not fit a phone. */}
        <div className="px-5 py-3 max-h-[70vh] overflow-auto">
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
                        readOnly={!editable}
                        onBlur={(e) => {
                          if (!editable) return;
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
