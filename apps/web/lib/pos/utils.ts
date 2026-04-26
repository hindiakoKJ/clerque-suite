/**
 * POS Tax & Discount Utilities — Philippine BIR Compliance
 *
 * Key references:
 *   RA 9994 / RA 7277   — PWD / Senior Citizen 20% discount
 *   RR No. 1-2026       — Receipt / invoice formatting requirements
 *   NIRC Sec 106        — VAT on sale of goods (12%)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE "NET OF VAT" RULE (critical developer note):
 *   Philippine prices are displayed GROSS (VAT-inclusive).
 *   If a customer sees ₱100 and the business is VAT-registered, the true
 *   revenue is ₱100 / 1.12 = ₱89.29.  The ₱10.71 belongs to the BIR.
 *   Never apply the 20% PWD discount on the gross ₱100 for VAT tenants —
 *   the law requires stripping VAT first, then discounting the net.
 *
 * ROUNDING RULE:
 *   Use round2() for all intermediate and final amounts to prevent centavo
 *   drift from floating-point arithmetic (0.1 + 0.2 ≠ 0.3 in IEEE 754).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { TaxStatus } from '@repo/shared-types';

// ── Precision helper ──────────────────────────────────────────────────────────

/**
 * Round to 2 decimal places using "round half away from zero" — the same
 * rounding mode used by BIR CAS (Computerized Accounting System) requirements.
 *
 * Standard JS Math.round() has float drift: Math.round(1.005 * 100) / 100 = 1
 * This implementation adds a tiny epsilon before rounding to fix it.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── VAT computation ───────────────────────────────────────────────────────────

/**
 * Extract the VAT component from a VAT-inclusive (gross) amount.
 * Result is rounded to 2 decimal places; base + vat = amountInclusive exactly.
 */
export function computeVat(amountInclusive: number): { base: number; vat: number } {
  const base = round2(amountInclusive / 1.12);
  const vat  = round2(amountInclusive - base);
  return { base, vat };
}

// ── Core TaxCalculator ────────────────────────────────────────────────────────

export interface TaxBreakdown {
  /** Gross amount before any VAT separation (what the customer tendered) */
  grossAmount:      number;
  /** VAT-exclusive selling price (= grossAmount for NON_VAT / UNREGISTERED) */
  vatableBase:      number;
  /** 12% VAT portion (= 0 for NON_VAT / UNREGISTERED) */
  vatOnLocalSales:  number;
  /** Total amount due (grossAmount for all — same result, different path) */
  totalAmount:      number;
  /** BIR receipt line: VATable Sales (gross, inclusive of VAT) */
  vatableSales:     number;
  /** BIR receipt line: VAT-Exempt Sales (0 unless per-item exemptions exist) */
  vatExemptSales:   number;
  /** BIR receipt line: Zero-Rated Sales (0 unless export / zero-rated items) */
  zeroRatedSales:   number;
}

/**
 * Core tax calculator — the single source of truth for all amount derivations.
 *
 * Usage: call this with the GROSS (VAT-inclusive) subtotal and the tenant's
 * TaxStatus. All other amounts are derived deterministically.
 *
 * @param grossSubtotal  Gross selling price (VAT-inclusive for VAT tenants)
 * @param taxStatus      Tenant's BIR registration classification
 */
export function computeTaxBreakdown(
  grossSubtotal: number,
  taxStatus: TaxStatus,
): TaxBreakdown {
  if (taxStatus === 'VAT') {
    const { base: vatableBase, vat: vatOnLocalSales } = computeVat(grossSubtotal);
    return {
      grossAmount:     round2(grossSubtotal),
      vatableBase,
      vatOnLocalSales,
      totalAmount:     round2(grossSubtotal), // same — VAT already included in gross
      vatableSales:    round2(grossSubtotal), // BIR line = gross (VAT-inclusive amount)
      vatExemptSales:  0,
      zeroRatedSales:  0,
    };
  }

  // NON_VAT or UNREGISTERED — no VAT component at all
  return {
    grossAmount:     round2(grossSubtotal),
    vatableBase:     round2(grossSubtotal),
    vatOnLocalSales: 0,
    totalAmount:     round2(grossSubtotal),
    vatableSales:    0,
    vatExemptSales:  0,
    zeroRatedSales:  0,
  };
}

// ── PWD / SC discount ─────────────────────────────────────────────────────────

export interface PwdScDiscountResult {
  /** VAT-exclusive base (= grossTotal for NON_VAT / UNREGISTERED) */
  vatExclusiveBase:       number;
  /** 20% of vatExclusiveBase — the line item on the receipt */
  discountOnBase:         number;
  /** Discounted VAT-exclusive amount */
  discountedVatExclusive: number;
  /** VAT recomputed on discountedVatExclusive (= 0 for non-VAT tenants) */
  vatOnDiscounted:        number;
  /** Final price customer pays */
  discountedTotal:        number;
  /** Total reduction vs original gross (discountOnBase + VAT relief) */
  totalSavings:           number;
}

/**
 * PH law (RA 9994 / RA 7277) — VAT-REGISTERED businesses.
 *
 * Step-by-step per BIR rules:
 *   1. Strip VAT:    vatExcl = grossTotal / 1.12
 *   2. 20% discount: discount = vatExcl × 0.20
 *   3. Discounted net: discountedVatExcl = vatExcl × 0.80
 *   4. Recompute VAT: newVat = discountedVatExcl × 0.12
 *   5. Total:        discountedTotal = discountedVatExcl + newVat
 *
 * Example (₱150 gross):
 *   VAT-excl base     = 150 / 1.12  = ₱133.93
 *   20% discount      = 133.93 × 20% = ₱26.79
 *   Discounted net    = 133.93 × 80% = ₱107.14
 *   VAT on discounted = 107.14 × 12% = ₱12.86
 *   Total due         =                ₱120.00
 */
export function computePwdScDiscount(totalVatInclusive: number): PwdScDiscountResult {
  const vatExclusiveBase       = round2(totalVatInclusive / 1.12);
  const discountOnBase         = round2(vatExclusiveBase * 0.2);
  const discountedVatExclusive = round2(vatExclusiveBase * 0.8);
  const vatOnDiscounted        = round2(discountedVatExclusive * 0.12);
  const discountedTotal        = round2(discountedVatExclusive + vatOnDiscounted);
  const totalSavings           = round2(totalVatInclusive - discountedTotal);
  return {
    vatExclusiveBase,
    discountOnBase,
    discountedVatExclusive,
    vatOnDiscounted,
    discountedTotal,
    totalSavings,
  };
}

/**
 * PH law (RA 9994 / RA 7277) — NON-VAT / UNREGISTERED businesses.
 *
 * No VAT to strip — apply 20% directly on the gross price.
 *
 * Example (₱150 gross):
 *   20% discount  = 150 × 20% = ₱30.00
 *   Total due     = 150 × 80% = ₱120.00
 */
export function computePwdScDiscountNonVat(grossTotal: number): PwdScDiscountResult {
  const discountOnBase         = round2(grossTotal * 0.2);
  const discountedTotal        = round2(grossTotal * 0.8);
  return {
    vatExclusiveBase:       round2(grossTotal),
    discountOnBase,
    discountedVatExclusive: discountedTotal,   // same as discountedTotal for non-VAT
    vatOnDiscounted:        0,
    discountedTotal,
    totalSavings:           discountOnBase,
  };
}

/**
 * Dispatch to the correct PWD/SC discount function based on taxStatus.
 * Use this in the cart store and backend service for DRY dispatch.
 */
export function computeDiscount(grossTotal: number, taxStatus: TaxStatus): PwdScDiscountResult {
  return taxStatus === 'VAT'
    ? computePwdScDiscount(grossTotal)
    : computePwdScDiscountNonVat(grossTotal);
}
