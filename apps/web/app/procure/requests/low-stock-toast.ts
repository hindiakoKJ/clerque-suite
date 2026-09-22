/**
 * The message after Check stock (POST /procure/requests/pull-low-stock).
 *
 * Kept free of React and the toast library so it can be tested on its own.
 */

export interface PullLowStockResult {
  added:        number;
  unmonitored?: number;
  toMake?:      Array<{ name: string }>;
  /** Low, but already on a sent or bought list, so nothing was added for them. */
  onTheWay?:    Array<{ name: string; unit: string; coming: number; requestNumber?: string }>;
}

export function lowStockToast(d: PullLowStockResult): { kind: 'success' | 'warning'; message: string } {
  // An ingredient with no reorder level can never appear on this list, so
  // "nothing is below its reorder level" was being said in two very
  // different situations: everything is stocked, and nobody is watching.
  // Say which one it is.
  const blind = d.unmonitored ?? 0;
  const blindNote = blind > 0
    ? ` ${blind} ingredient${blind === 1 ? ' has' : 's have'} no reorder level, so ${blind === 1 ? 'it' : 'they'} can never show up here.`
    : '';

  // Low but already coming: nothing was added for these. Saying "nothing is
  // below its reorder level" would be false, and would hide a list someone may
  // have forgotten to close. Naming the list tells them where to look.
  const coming = d.onTheWay ?? [];
  const comingNote = coming.length
    ? ` ${coming.slice(0, 3).map((c) =>
        `${c.name} (${c.coming.toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${c.unit}${c.requestNumber ? ` on ${c.requestNumber}` : ''})`,
      ).join(', ')}` +
      (coming.length > 3 ? ` and ${coming.length - 3} more` : '') +
      ` ${coming.length === 1 ? 'is' : 'are'} low but already on a sent or bought list.`
    : '';

  if (d.added) {
    // "1 item that is", "2 items that are": the toast is read aloud across a kitchen.
    return { kind: 'success', message: `Added ${d.added} item${d.added === 1 ? ' that is below its' : 's that are below their'} reorder level.${comingNote}${blindNote}` };
  }
  if (coming.length) return { kind: 'warning', message: `Nothing new to add.${comingNote}${blindNote}` };
  if (blind > 0) return { kind: 'warning', message: `Nothing is below its reorder level.${blindNote}` };
  return { kind: 'success', message: 'Nothing is below its reorder level right now.' };
}
