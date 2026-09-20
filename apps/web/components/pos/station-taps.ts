/**
 * The small rules every recording tap on a kitchen or bar screen shares
 * ("Made", "Thrown out"). Pure, so Node's own test runner checks them:
 *   cd apps/web && node --test components/pos/station-taps.spec.mjs
 *
 * Each tap sends a key, and the server records a key once, so a double-tap or
 * a retry after the signal dropped is never counted twice.
 */

/*
  A fresh tap key. crypto.randomUUID only exists on HTTPS or localhost, and a
  kitchen tablet on the shop's own network may be neither, so the fallback is
  time plus randomness -- unique enough for one screen's taps.
*/
export const newTapKey = (): string =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/**
 * After a tap that failed, keep its key or start a new one?
 *
 * No answer at all (the signal dropped) or a server error: it may or may not
 * have been recorded, so the key is KEPT -- tapping again then either records
 * it or is told it already was. A refusal (4xx) recorded nothing, so the next
 * tap is a new try.
 */
export function keepTapKey(status: number | undefined): boolean {
  return !(status != null && status >= 400 && status < 500);
}

/** The status and the server's own words of a failed request, when it answered at all. */
export function tapFailure(error: unknown): { status?: number; message?: string } {
  const r = (error as { response?: { status?: number; data?: { message?: string | string[] } } } | null)?.response;
  const m = r?.data?.message;
  return { status: r?.status, message: Array.isArray(m) ? m.join(' ') : m };
}

/** What a failed tap says when the server gave no words of its own. */
export function tapFailureText(error: unknown): string {
  const { status, message } = tapFailure(error);
  if (message) return message;
  return status
    ? 'Could not record it. Tap again: it will not be counted twice.'
    : 'No connection. Tap again when it is back: it will not be counted twice.';
}

/**
 * The words on a prep tile's own "Made" button: a pre-made item drawn as a tile
 * (not inside a chain card) that has enough on hand for one batch. Null when a
 * batch cannot be made now -- the server would refuse it.
 */
export function tileMadeLabel(row: { kind: 'MAKE' | 'MOVE'; batches: number }): string | null {
  if (!(row.batches > 0)) return null;
  return row.kind === 'MOVE' ? 'Moved a batch' : 'Made a batch';
}
