/**
 * What the report page opens on when a link asks for a view.
 *
 * The end-of-day bell links here with ?from=D&to=D&branchId=B, meaning "this
 * branch's day". Without reading those, the page opened 30 days of the
 * viewer's own branch on Stock on Hand, and none of it matched the bell.
 *
 * Kept free of React and Next so it can be tested on its own.
 */

export type Tab = 'on-hand' | 'purchases' | 'consumption';

/** A real calendar day written YYYY-MM-DD, the only shape the report's dates take. */
export function isDay(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  // The pattern alone lets 2026-02-30 through; a date that rolls over is not the day asked for.
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function reportView(
  params: { get(name: string): string | null },
  user: { role?: string | null; branchId?: string | null } | null | undefined,
): { dates: { from: string; to: string } | null; tab: Tab; branchId: string | null } {
  const from = params.get('from');
  const to   = params.get('to');
  // Both or neither: half a range from a hand-edited link is not the day the bell meant.
  const dates = isDay(from) && isDay(to) ? { from, to } : null;

  /*
    A manager tied to one branch stays on it, whatever the link says. The owner
    (whose account is usually tied to the Main branch) and anyone not tied to a
    branch may open the branch the link names. The bell only goes to the owner
    and to managers of that branch or of every branch, so this never turns a
    real bell tap away.
  */
  const asked = params.get('branchId');
  const branchId = asked && (user?.role === 'BUSINESS_OWNER' || !user?.branchId || asked === user.branchId)
    ? asked
    : (user?.branchId ?? null);

  return { dates, tab: dates ? 'consumption' : 'on-hand', branchId };
}
