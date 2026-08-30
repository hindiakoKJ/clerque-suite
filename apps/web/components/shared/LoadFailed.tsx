'use client';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * What to show when a query fails.
 *
 * The pattern this replaces was `if (isLoading || !data) return <Spinner />`,
 * which collapses two different situations into one screen: "still loading"
 * and "this is never going to work". A dead API, a closed accounting period,
 * an expired session or a 403 all rendered a spinner that span forever, with
 * no message and no way to retry short of reloading the tab. Someone standing
 * at a counter cannot tell those apart, so they wait, then they call.
 *
 * Pulling the server's own message through matters as much as the retry: the
 * API already says useful things like "that accounting period is closed" or
 * "the database schema is out of sync", and the spinner was throwing all of
 * it away.
 */
export function LoadFailed({
  error,
  onRetry,
  retrying = false,
  what = 'this page',
}: {
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  /** Named in the heading: "Could not load the sales dashboard". */
  what?: string;
}) {
  const fromServer = (error as {
    response?: { data?: { message?: string | string[] } };
  } | null | undefined)?.response?.data?.message;

  const message =
    (Array.isArray(fromServer) ? fromServer.join(' ') : fromServer) ??
    'Check the connection and try again.';

  return (
    <div className="mx-auto my-8 max-w-md rounded-xl border border-border bg-card p-6 text-center">
      <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" />
      <h2 className="mt-2 text-sm font-semibold">Could not load {what}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50"
        >
          {retrying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Try again
        </button>
      )}
    </div>
  );
}
