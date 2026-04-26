/**
 * TaxCalculator — Philippine BIR-compliant tax computation service.
 *
 * All amounts use Prisma.Decimal at the persistence layer and plain numbers
 * here (rounded to 2 decimal places). The round2() helper uses the same
 * "round half away from zero" mode required by BIR CAS accreditation.
 *
 * References:
 *   NIRC Sec 106  — 12% VAT on sale of goods
 *   RA 9994        — PWD 20% discount
 *   RA 7277        — Senior Citizen 20% discount
 *   RR No. 1-2026  — Receipt / invoice formatting
 */

import { Injectable, BadRequestException } from '@nestjs/common';

export type TaxStatus = 'VAT' | 'NON_VAT' | 'UNREGISTERED';

// ── Precision helper ──────────────────────────────────────────────────────────

/** Round to 2 decimal places (round half away from zero — BIR standard). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Result shapes ─────────────────────────────────────────────────────────────

export interface TaxBreakdown {
  grossAmount:     number;  // Input gross (VAT-inclusive for VAT tenants)
  netAmount:       number;  // VAT-exclusive net (= grossAmount for non-VAT)
  vatAmount:       number;  // 12% VAT portion (= 0 for non-VAT)
  totalAmount:     number;  // = grossAmount (same path, clearer intent)
  // BIR receipt lines (RR No. 1-2026)
  vatableSales:    number;  // Gross amount subject to VAT (= totalAmount for VAT tenants)
  vatExemptSales:  number;  // Reserved for future per-item exemption support
  zeroRatedSales:  number;  // Reserved for future zero-rated export support
}

export interface PwdScResult {
  vatExclusiveBase:       number; // Basis for the 20% (VAT-excl for VAT, gross for others)
  discountOnBase:         number; // 20% of vatExclusiveBase
  discountedVatExclusive: number; // vatExclusiveBase × 80%
  vatOnDiscounted:        number; // 12% recomputed on discountedVatExclusive (0 for non-VAT)
  discountedTotal:        number; // Final price the customer pays
  totalSavings:           number; // Original gross − discountedTotal
}

// ── TaxCalculator ─────────────────────────────────────────────────────────────

@Injectable()
export class TaxCalculatorService {

  /**
   * Compute the tax breakdown for a gross subtotal.
   *
   * THE "NET OF VAT" RULE:
   *   For VAT-registered businesses, the customer-facing price already contains
   *   VAT. The actual taxable revenue is grossSubtotal / 1.12.
   *   Never use the gross amount as revenue; always strip VAT first.
   */
  computeTaxBreakdown(grossSubtotal: number, taxStatus: TaxStatus): TaxBreakdown {
    if (taxStatus === 'VAT') {
      const netAmount  = round2(grossSubtotal / 1.12);
      const vatAmount  = round2(grossSubtotal - netAmount);
      return {
        grossAmount:    round2(grossSubtotal),
        netAmount,
        vatAmount,
        totalAmount:    round2(grossSubtotal),
        vatableSales:   round2(grossSubtotal),
        vatExemptSales: 0,
        zeroRatedSales: 0,
      };
    }

    // NON_VAT / UNREGISTERED — no VAT component
    return {
      grossAmount:    round2(grossSubtotal),
      netAmount:      round2(grossSubtotal),
      vatAmount:      0,
      totalAmount:    round2(grossSubtotal),
      vatableSales:   0,
      vatExemptSales: 0,
      zeroRatedSales: 0,
    };
  }

  /**
   * Validate that the submitted vatAmount matches the expected value for
   * this tenant's tax status. Throws BadRequestException on mismatch.
   */
  assertVatConsistency(submittedVat: number, taxStatus: TaxStatus): void {
    if (taxStatus !== 'VAT' && submittedVat > 0) {
      throw new BadRequestException(
        `Tax status is ${taxStatus}: VAT amount must be zero. ` +
        'Check your POS configuration or contact your administrator.',
      );
    }
  }

  /**
   * PWD / SC 20% discount — RA 9994 / RA 7277.
   *
   * VAT-registered:
   *   Strip 12% VAT → apply 20% on net → recompute VAT on discounted net.
   *
   * NON_VAT / UNREGISTERED:
   *   Apply 20% directly on gross. No VAT stripping needed.
   */
  computePwdScDiscount(grossTotal: number, taxStatus: TaxStatus): PwdScResult {
    if (taxStatus === 'VAT') {
      const vatExclusiveBase       = round2(grossTotal / 1.12);
      const discountOnBase         = round2(vatExclusiveBase * 0.2);
      const discountedVatExclusive = round2(vatExclusiveBase * 0.8);
      const vatOnDiscounted        = round2(discountedVatExclusive * 0.12);
      const discountedTotal        = round2(discountedVatExclusive + vatOnDiscounted);
      return {
        vatExclusiveBase,
        discountOnBase,
        discountedVatExclusive,
        vatOnDiscounted,
        discountedTotal,
        totalSavings: round2(grossTotal - discountedTotal),
      };
    }

    // NON_VAT / UNREGISTERED
    const discountOnBase   = round2(grossTotal * 0.2);
    const discountedTotal  = round2(grossTotal * 0.8);
    return {
      vatExclusiveBase:       round2(grossTotal),
      discountOnBase,
      discountedVatExclusive: discountedTotal,
      vatOnDiscounted:        0,
      discountedTotal,
      totalSavings:           discountOnBase,
    };
  }

  /**
   * Validate a BIR TIN number format: 000-000-000-00000 (15 chars with dashes).
   * Returns a normalised version or throws if invalid.
   */
  validateTin(tin: string): string {
    const normalised = tin.trim().toUpperCase();
    const TIN_REGEX  = /^\d{3}-\d{3}-\d{3}-\d{5}$/;
    if (!TIN_REGEX.test(normalised)) {
      throw new BadRequestException(
        `Invalid TIN format: "${normalised}". Expected format: 000-000-000-00000`,
      );
    }
    return normalised;
  }
}
