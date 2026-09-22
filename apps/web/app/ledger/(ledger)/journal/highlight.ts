/**
 * "View in journal" from an account's ledger lands on /ledger/journal?highlight=<entry id>.
 * The Journal page used to ignore that, so the owner got the whole journal with
 * nothing pointed out. Pure helpers, so they can be tested without a browser.
 */

/** The entry id in the address bar, or null. Anything that is not a plain id is dropped. */
export function readHighlight(search: string): string | null {
  const raw = new URLSearchParams(search).get('highlight');
  // The value goes into an API path, so only a bare id is accepted: no slashes, dots or spaces.
  return raw && /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : null;
}

/**
 * The list to draw: the asked-for entry first, then everyone else in the order
 * the API sent them. The journal is 50 to a page, so the entry may not be on
 * this page at all; it is fetched on its own and put on top either way.
 */
export function pinHighlighted<T extends { id: string }>(rows: T[], pinned: T | null | undefined): T[] {
  if (!pinned) return rows;
  return [pinned, ...rows.filter((r) => r.id !== pinned.id)];
}
