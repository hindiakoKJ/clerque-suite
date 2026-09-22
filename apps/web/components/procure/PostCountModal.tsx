'use client';
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
 *
 * Used by Cycle Counts' Post and by a weekly count's "Adjust the books to
 * match" (WeeklyCountReview), which passes its own title and says first what
 * the adjustment will and will not touch.
 */
export function PostCountModal({
  count, pending, onCancel, onPost, title, notes,
}: {
  count: { countNumber: string; branch: { name: string }; _count: { lines: number } };
  pending: boolean;
  onCancel: () => void;
  onPost: (isOpeningBalance: boolean) => void;
  /** Defaults to "Post <number>". */
  title?: string;
  /** Said before the choice, one line each. */
  notes?: string[];
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-full overflow-y-auto p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-lg">{title ?? `Post ${count.countNumber}`}</h2>
          <p className="text-sm text-muted-foreground">
            {title ? `${count.countNumber} · ` : ''}{count.branch?.name} · {count._count?.lines} item{count._count?.lines === 1 ? '' : 's'}
          </p>
        </div>

        {notes && notes.length > 0 && (
          <ul className="space-y-1 text-sm text-foreground">
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}

        <p className="text-sm text-muted-foreground">
          Stock moves by the difference this count found, so anything sold while
          you were counting is kept. If another count has adjusted or counted an
          item since this one did, that item is left alone. This cannot be undone.
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
