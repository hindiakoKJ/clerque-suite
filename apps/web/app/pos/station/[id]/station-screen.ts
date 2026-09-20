/**
 * What the kitchen or bar screen says about itself: its title, and why its
 * orders did not load. Pure, so Node's own test runner checks it (the folder's
 * brackets are a glob, so the run starts inside it):
 *   cd "apps/web/app/pos/station/[id]" && node --test station-screen.spec.mjs
 */

/**
 * The screen's title. A logged-in screen knows the station from the floor
 * layout; a paired tablet has no layout of its own (the layout needs a login),
 * so it uses the station the prep levels answer with. "Station" only until
 * either has loaded.
 */
export function stationTitle(
  fromLayout: { name: string } | null | undefined,
  fromPrep: { name: string } | null | undefined,
): string {
  return fromLayout?.name || fromPrep?.name || 'Station';
}

export type QueueProblem =
  /** Signed out, unpaired, paired to a station that is gone: only pairing again fixes it. */
  | { kind: 'unpaired'; detail: string | null }
  /** The server refused or failed for another reason, or could not be reached. */
  | { kind: 'failed'; detail: string | null };

/**
 * Why the orders did not load, or null when they did.
 *
 * It used to say "All caught up" whatever the reason, so a tablet that had
 * been signed out -- or paired to "Any matching station", which is no station
 * -- sat looking finished while tickets waited.
 *
 *   401, 403, 404  signed out, paired elsewhere, or no such station
 *   no response    the shared client turns a 401 it could not refresh (a
 *                  paired tablet has no login to refresh) into a plain error
 *                  with no response, so that is signed out too; an axios
 *                  error with no response is the connection
 */
export function queueProblem(error: unknown): QueueProblem | null {
  if (!error) return null;
  const e = error as { isAxiosError?: boolean; response?: { status?: number; data?: { message?: string | string[] } } };
  const m = e.response?.data?.message;
  const detail = (Array.isArray(m) ? m.join(' ') : m) || null;
  const status = e.response?.status;
  if (status === 401 || status === 403 || status === 404) return { kind: 'unpaired', detail };
  if (status) return { kind: 'failed', detail };
  if (e.isAxiosError) return { kind: 'failed', detail: null };
  return { kind: 'unpaired', detail: null };
}
