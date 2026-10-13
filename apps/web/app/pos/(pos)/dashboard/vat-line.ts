/**
 * The VAT-line card on the owner's dashboard.
 *
 * A non-VAT shop must register for VAT once its gross sales pass ₱3,000,000 in
 * any 12 months. GET /reports/vat-line sends the shop's last-12-months figure
 * (owner only; nothing for a VAT-registered shop). This decides what the card
 * says: nothing under ₱2,400,000, a heads-up from there, and "see your
 * bookkeeper" at or over the line.
 *
 * Kept free of React and Next so it can be tested on its own.
 */

export const VAT_LINE_ROUTE = '/reports/vat-line';

export type VatLineData =
  | { applies: false }
  | { applies: true; grossSales: number; line: number; warnAt: number; from: string; to: string };

export interface VatLineCard {
  tone:     'amber' | 'red';
  headline: string;
  /** What to do about it. Only once the line is reached. */
  advice:   string | null;
}

/** Whole pesos, rounded down: ₱2,999,999.60 must not read as ₱3,000,000. */
const peso = (n: number) => '₱' + Math.floor(n).toLocaleString('en-PH');

export function vatLineCard(data: VatLineData | null | undefined): VatLineCard | null {
  if (!data || !data.applies) return null;
  const { grossSales, line, warnAt } = data;
  if (!(grossSales >= warnAt)) return null;
  const headline = `Sales in the last 12 months: ${peso(grossSales)} of the ${peso(line)} VAT line`;
  return grossSales >= line
    ? { tone: 'red', headline, advice: 'Talk to your bookkeeper about VAT registration (BIR Form 1905).' }
    : { tone: 'amber', headline, advice: null };
}
