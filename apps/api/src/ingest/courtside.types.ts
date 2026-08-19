/**
 * The CourtSide → Clerque outbox contract. CourtSide is LIVE and owns this
 * shape — we consume it, we do not redesign it.
 *
 * Money is always an integer number of centavos. Clerque's ledger works in
 * Prisma.Decimal pesos; the ingest converts at this boundary via `pesos()`,
 * which is EXACT (integer ÷ 100) and never touches a float.
 */

export type CourtSideLineType =
  | 'court_time'       // a whole court booked by the hour   → Court Rental Income (4110)
  | 'open_play_seat'   // a club session sold per head        → Open Play Income   (4111)
  | 'tournament_entry';// a paid registration                → Tournament Income  (4112)

export interface CourtSideSaleLine {
  type:               CourtSideLineType;
  description:        string;
  qty:                number;
  unit:               string;             // 'hour' | 'seat' | 'ea'
  unit_price_centavos: number;
  amount_centavos:    number;
}

export interface CourtSideSaleEvent {
  event_type:  'sale';
  club_ref:    string;
  occurred_at: string;                     // ISO-8601, UTC — the paid time
  order_ref:   string;                     // human order no
  customer: {
    player_ref: string | null;
    name:       string;
    mobile:     string | null;             // E.164
  };
  tender: {
    type:         'online' | 'cash';
    channel:      string;                  // gcash | maya | qrph | card | ...
    provider_ref: string | null;           // Xendit reference, for payout reconciliation
  };
  totals: {
    gross_centavos:        number;
    discount_centavos:     number;
    fee_centavos:          number;
    net_centavos:          number;         // what the club actually collected
    provider_fee_centavos: number;         // Xendit's cut
    currency:              'PHP';
  };
  lines: CourtSideSaleLine[];
  tax:   { treatment: 'TBD' | string; vat_centavos: number };
}

export interface CourtSideRefundEvent {
  event_type:  'refund';
  club_ref:    string;
  occurred_at: string;
  order_ref:   string;
  refund_ref:  string;
  reason:      string;
  totals:      { net_centavos: number; currency: 'PHP' };
}

export type CourtSideEvent = CourtSideSaleEvent | CourtSideRefundEvent;

/** Exact integer-centavos → peso number for the Decimal ledger. Never a float op. */
export function pesos(centavos: number): number {
  // centavos is an integer; dividing by 100 yields at most 2 decimal places,
  // which Prisma.Decimal(12,2) stores exactly. We keep it a JS number only
  // as far as the Order payload, which the ledger reads as Decimal.
  return Math.round(centavos) / 100;
}
