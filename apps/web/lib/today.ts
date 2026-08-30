/**
 * Today, as the person looking at the screen would write it.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, not the local one.
 * Manila is UTC+8, so between midnight and 08:00 local it returns YESTERDAY.
 * That is precisely the window a cafe is open before service: the milk and
 * bread arrive at 06:00, the owner records the delivery, and it is booked to
 * the previous day. On the first of the month it lands in the previous
 * accounting PERIOD, which may already be closed.
 *
 * Every date the user is shown as a default should come from here. Filenames
 * and export stamps can keep using UTC — nobody reconciles against those.
 */
export function todayIso(): string {
  const d = new Date();
  // Local getters, then pad — this is the date on the wall clock, whatever
  // timezone the tablet is set to.
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** `todayIso()` shifted by whole days. Negative goes back. */
export function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
