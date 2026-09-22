/**
 * How one ingredient's page reads its movements.
 *
 * The API sends five kinds of row: a delivery (or a batch of this prep
 * made), a sale that used it, a prep batch that used it, a write-off, and a
 * count's correction. The page used to know two of them, so a write-off and
 * a batch never appeared and "On hand" was the lots' leftovers added up
 * rather than what the stock book says is on the shelf.
 *
 * Kept free of React and Next so it can be tested on its own.
 */

export type TimelineKind = 'RECEIPT' | 'CONSUMPTION' | 'PREP' | 'WRITE_OFF' | 'COUNT';

export interface TimelineRow {
  kind:        TimelineKind;
  /** Signed: + arrived, - left. */
  quantity:    number;
  /** Signed like `quantity`. */
  totalValue:  number;
  reference?:  string | null;
  orderId?:    string | null;
}

/** The colour family of a row: what came in, what a sale took, what a prep took, what was lost, what a count moved. */
export type TimelineTone = 'in' | 'sale' | 'prep' | 'out' | 'count';

/** The heading of a row, in the words the staff use. */
export function rowTitle(m: Pick<TimelineRow, 'kind' | 'quantity' | 'reference'>): string {
  switch (m.kind) {
    case 'RECEIPT':     return typeof m.reference === 'string' && m.reference.startsWith('BATCH-') ? 'Batch made' : 'Stock received';
    case 'CONSUMPTION': return 'Used by a sale';
    case 'PREP':        return 'Used in a prep batch';
    case 'WRITE_OFF':   return 'Written off';
    case 'COUNT':       return m.quantity >= 0 ? 'Found at count' : 'Missing at count';
    default:            return 'Stock moved';
  }
}

export function rowTone(m: Pick<TimelineRow, 'kind' | 'quantity'>): TimelineTone {
  switch (m.kind) {
    case 'RECEIPT':     return 'in';
    case 'CONSUMPTION': return 'sale';
    case 'PREP':        return 'prep';
    case 'WRITE_OFF':   return 'out';
    case 'COUNT':       return 'count';
    default:            return m.quantity >= 0 ? 'in' : 'out';
  }
}

export interface TimelineSummary {
  /** Deliveries and batches of this prep made. */
  purchasesQty:   number;
  purchasesValue: number;
  /** Everything that left the shelf: sales, prep batches, write-offs, and what a count found missing. */
  usedQty:        number;
  usedValue:      number;
  /** The part of `used` that was lost rather than used. */
  writtenOffQty:  number;
  writtenOffValue: number;
}

/** The range's figures, from the same rows the timeline shows, so the two always agree. */
export function summarize(rows: TimelineRow[]): TimelineSummary {
  const s: TimelineSummary = { purchasesQty: 0, purchasesValue: 0, usedQty: 0, usedValue: 0, writtenOffQty: 0, writtenOffValue: 0 };
  for (const m of rows) {
    if (m.kind === 'RECEIPT') {
      s.purchasesQty   += m.quantity;
      s.purchasesValue += m.totalValue;
      continue;
    }
    // A count that found MORE is not a purchase and not a use; it corrects the book and stays out of both.
    if (m.quantity >= 0) continue;
    s.usedQty   += -m.quantity;
    s.usedValue += -m.totalValue;
    if (m.kind === 'WRITE_OFF') {
      s.writtenOffQty   += -m.quantity;
      s.writtenOffValue += -m.totalValue;
    }
  }
  return s;
}

export interface OnHand {
  quantity: number;
  value:    number;
  /** true when the figure is the stock book's; false when only the lots were available (an older API). */
  fromBook: boolean;
}

/**
 * What is on the shelf. The stock book's figure when the API sends it (the
 * same number Stock on hand shows); the lots' leftovers only as the fallback
 * for an API that does not.
 */
export function onHandOf(
  lots: { onHand?: { quantity: number; value: number } | null; lots?: Array<{ qtyRemaining: number; valueRemaining: number }> | null } | null | undefined,
): OnHand {
  if (lots?.onHand && Number.isFinite(lots.onHand.quantity)) {
    return { quantity: lots.onHand.quantity, value: lots.onHand.value, fromBook: true };
  }
  const rows = lots?.lots ?? [];
  return {
    quantity: rows.reduce((s, l) => s + l.qtyRemaining, 0),
    value:    rows.reduce((s, l) => s + l.valueRemaining, 0),
    fromBook: false,
  };
}

/**
 * A cost per ml, per gram or per piece. Two decimals turned ₱0.098 a ml into
 * "₱0.10" and ₱0.091 a gram into "₱0.09", so up to four are kept here.
 * Totals keep the usual two.
 */
export function perUnitPeso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** The order's own page. `/pos/orders?focus=` went to the list, which never read it. */
export function orderHref(orderId: string): string {
  return `/pos/orders/${encodeURIComponent(orderId)}`;
}
