/**
 * Clerque Counter — Receipt Authority (mirror)
 *
 * LOCAL MIRROR of `receiptAuthority()` in packages/shared-types/src/tenant.ts.
 * Counter builds standalone for Expo and does not import @repo/shared-types
 * (see src/types/index.ts) — keep the two in lock-step; the canonical one is
 * unit-tested in apps/api/src/tax/receipt-authority.spec.ts.
 *
 * Shared by the visual `Receipt.tsx` AND the Bluetooth thermal path
 * `receiptToEscPos.ts` so the on-screen slip and the printed slip can never
 * disagree about what document they are.
 *
 * Owner's rule (KJ): what document a slip IS is decided by THE TENANT's own
 * facts — taxStatus (are they BIR-registered, VAT or not) AND isPtuHolder
 * (does this system hold the PTU/MIN to issue their official sales document).
 * The provider phase is only a safety catch: phase 1 holds everyone at
 * Acknowledgement Receipt; phase 2 never promotes a non-PTU tenant.
 *
 * kind = 'SALES_INVOICE' ONLY when taxStatus is VAT | NON_VAT AND
 * isPtuHolder === true AND phase === 2. Otherwise 'ACKNOWLEDGEMENT'.
 */

import type { TenantConfig } from '@/types';

export type ProviderPhase = 1 | 2;

export interface ReceiptAuthority {
  kind:         'ACKNOWLEDGEMENT' | 'SALES_INVOICE';
  title:        string;
  titleFil:     string;
  numberPrefix: 'AR' | 'SI';
  showVatLine:  boolean;
  showPtu:      boolean;
  disclaimer:   string | null;
}

export const ACKNOWLEDGEMENT_DISCLAIMER =
  'THIS IS NOT A SALES INVOICE OR OFFICIAL RECEIPT. FOR INTERNAL MANAGEMENT USE ONLY.';

export function receiptAuthority(input: {
  taxStatus:    TenantConfig['taxStatus'];
  isPtuHolder?: boolean | null;
  phase?:       ProviderPhase;
}): ReceiptAuthority {
  const { taxStatus, isPtuHolder } = input;
  // Counter has no NEXT_PUBLIC_PROVIDER_PHASE — default to the safe phase 1.
  const phase        = input.phase ?? 1;
  const isRegistered = taxStatus === 'VAT' || taxStatus === 'NON_VAT';
  const promote      = isRegistered && isPtuHolder === true && phase === 2;

  if (!promote) {
    return {
      kind:         'ACKNOWLEDGEMENT',
      title:        'ACKNOWLEDGEMENT RECEIPT',
      titleFil:     'Resibo ng Pagtanggap',
      numberPrefix: 'AR',
      showVatLine:  false,
      showPtu:      false,
      disclaimer:   ACKNOWLEDGEMENT_DISCLAIMER,
    };
  }

  const isVat = taxStatus === 'VAT';
  return {
    kind:         'SALES_INVOICE',
    title:        isVat ? 'VAT SALES INVOICE' : 'SALES INVOICE',
    titleFil:     'Resibo ng Benta',
    numberPrefix: 'SI',
    showVatLine:  isVat,
    showPtu:      true,
    disclaimer:   null,
  };
}

/**
 * What the Counter prints TODAY. TenantConfig carries no isPtuHolder yet (the
 * JWT does — wiring it through AuthProvider/TenantConfig is a follow-up), so
 * we FAIL SAFE to Acknowledgement Receipt: Counter must never print
 * "Official Receipt" / "OR #" without PTU authority.
 */
export function counterReceiptAuthority(tenant: Pick<TenantConfig, 'taxStatus'>): ReceiptAuthority {
  return receiptAuthority({ taxStatus: tenant.taxStatus, isPtuHolder: false });
}
