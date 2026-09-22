/**
 * How one row of the Stock Movements log reads on screen.
 *
 * The log is built from two places (product stock logs, and ingredient events
 * from the books), and the second does not always say what it was: a write-off
 * or a kitchen "thrown out" arrives typed STOCK_IN with a minus quantity, and
 * an ingredient used up by a prep batch arrives with stock before and after
 * both hard-coded to 0. Shown as sent, a write-off read "Stock In -1 pc" and a
 * batch read "Stock after 0" for a shelf holding 8 kg.
 *
 * Kept free of React and Next so it can be tested on its own.
 */

export interface MovementLike {
  kind:            'PRODUCT' | 'RAW_MATERIAL';
  type:            string;
  quantity:        number;
  quantityBefore?: number | null;
  quantityAfter?:  number | null;
  reference?:      string | null;
}

const TYPE_LABEL: Record<string, string> = {
  INITIAL:          'Opening Stock',
  STOCK_IN:         'Stock In',
  STOCK_OUT:        'Stock Out',
  ADJUSTMENT:       'Adjustment',
  SALE_DEDUCTION:   'Sale',
  VOID_REVERSAL:    'Void Reversed',
  // Sent by a newer API that names these itself.
  WRITE_OFF:        'Write-off',
  WASTE:            'Thrown out',
  COUNT_CORRECTION: 'Count correction',
  OPENING_BALANCE:  'Opening Stock',
  TRANSFER_IN:      'Transfer In',
  TRANSFER_OUT:     'Transfer Out',
};

/** A kitchen or bar tablet's "Thrown out" entry: its reference is WASTE-<tap key>. */
export function isStationWaste(m: Pick<MovementLike, 'reference'>): boolean {
  return typeof m.reference === 'string' && m.reference.startsWith('WASTE-');
}

/** The word in the Type column. Stock that LEFT is never called "Stock In". */
export function movementLabel(m: MovementLike): string {
  if (isStationWaste(m)) return 'Thrown out';
  if (m.quantity < 0 && (m.type === 'STOCK_IN' || m.type === 'INITIAL')) return 'Stock Out';
  return TYPE_LABEL[m.type] ?? m.type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** Which way the stock went, for the colour and the arrow. */
export function movementDirection(m: MovementLike): 'sale' | 'in' | 'out' {
  if (m.type === 'SALE_DEDUCTION') return 'sale';
  return m.quantity > 0 ? 'in' : 'out';
}

/**
 * Stock after the movement, or null when the log does not know it.
 *
 * Before 0, after 0 and a quantity that is not 0 cannot all be true (before
 * plus the quantity IS the after), so that row's figures were never recorded.
 * A blank is honest; a 0 tells the owner the shelf is empty.
 */
export function stockAfter(m: MovementLike): number | null {
  if (m.quantityAfter == null) return null;
  if (m.quantity !== 0 && m.quantityAfter === 0 && m.quantityBefore === 0) return null;
  return m.quantityAfter;
}

/**
 * The Reference column. A delivery number or an order number helps; a
 * database id or a tablet's tap key is noise to the person reading the log.
 */
export function referenceText(reference: string | null | undefined): string | null {
  if (!reference) return null;
  if (reference.startsWith('WASTE-')) return 'Station tablet';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const cuid = /^c[a-z0-9]{20,}$/;
  if (uuid.test(reference) || cuid.test(reference)) return null;
  return reference;
}

/** A timestamp as the shop's wall clock reads it (Manila), for the export. */
export function manilaStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // sv-SE prints YYYY-MM-DD HH:mm:ss, which sorts and opens cleanly in Excel.
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Manila', hour12: false });
}
