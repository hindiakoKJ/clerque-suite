/**
 * The magnetmoments.cc → Clerque ("Magnet Books") contract. A shop's "mark
 * paid" posts one sale event; a refund posts one refund event. Kept small on
 * purpose — this is a home business, not an ERP.
 *
 * Money is always an integer number of MINOR units (centavos / cents) in the
 * shop's currency. Clerque's ledger works in Prisma.Decimal major units; the
 * ingest converts at this boundary via `minorToMajor()`, which is EXACT
 * (integer ÷ 100) and never touches a float. Books are GROSS — no tax split.
 */

export interface MagnetSaleLine {
  sku?:             string;
  description:      string;
  qty:              number;
  unit_price_minor: number;
  amount_minor:     number;
}

export interface MagnetSaleEvent {
  event_type:  'sale';
  shop_ref:    string;
  order_ref:   string;                     // the shop's order no — stable per sale
  occurred_at: string;                     // ISO-8601 — the paid time
  customer?:   { name?: string; email?: string };
  tender: {
    type:          'cash' | 'online' | 'other';
    channel?:      string;                 // gcash | maya | bank | ...
    provider_ref?: string;                 // payment reference, for reconciliation
  };
  lines:  MagnetSaleLine[];
  totals: { amount_minor: number; currency: string };
}

export interface MagnetRefundEvent {
  event_type:  'refund';
  shop_ref:    string;
  order_ref:   string;
  refund_ref:  string;
  occurred_at: string;
  reason?:     string;
  totals:      { amount_minor: number; currency: string };   // positive magnitude
}

export type MagnetEvent = MagnetSaleEvent | MagnetRefundEvent;

/** Exact integer-minor → major-unit number for the Decimal ledger. Never a float op. */
export function minorToMajor(minor: number): number {
  // minor is an integer; dividing by 100 yields at most 2 decimal places,
  // which Prisma.Decimal(12,2) stores exactly. Same conversion as pesos().
  return Math.round(minor) / 100;
}
