/**
 * POS calculation utilities.
 *
 * VAT is 12% (Philippines).
 * PWD/SC discount governed by RA 9994 (Senior Citizens Act) and RA 7277 (Magna Carta for PWD).
 */

export function computeVat(amountInclusive: number): { base: number; vat: number } {
  const base = amountInclusive / 1.12;
  const vat  = amountInclusive - base;
  return { base, vat };
}

/**
 * PH law (RA 9994 / RA 7277):
 * - 20% discount applied on the VAT-EXCLUSIVE selling price
 * - VAT recomputed on the discounted VAT-exclusive base
 * - Customer pays NO VAT on the discounted portion
 *
 * Example (₱150 VAT-inclusive):
 *   VAT-exclusive base     = 150 / 1.12 = ₱133.93
 *   20% discount on base   = 133.93 × 20% = ₱26.79
 *   Discounted VAT-excl    = 133.93 × 80% = ₱107.14
 *   VAT on discounted base = 107.14 × 12% = ₱12.86
 *   Total due              = ₱107.14 + ₱12.86 = ₱120.00
 */
export function computePwdScDiscount(totalVatInclusive: number): {
  vatExclusiveBase:       number;
  discountOnBase:         number;
  discountedVatExclusive: number;
  vatOnDiscounted:        number;
  discountedTotal:        number;
  totalSavings:           number;
} {
  const vatExclusiveBase       = totalVatInclusive / 1.12;
  const discountOnBase         = vatExclusiveBase * 0.2;
  const discountedVatExclusive = vatExclusiveBase * 0.8;
  const vatOnDiscounted        = discountedVatExclusive * 0.12;
  const discountedTotal        = discountedVatExclusive + vatOnDiscounted;
  const totalSavings           = totalVatInclusive - discountedTotal;
  return { vatExclusiveBase, discountOnBase, discountedVatExclusive, vatOnDiscounted, discountedTotal, totalSavings };
}
