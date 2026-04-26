export type SubscriptionTier = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5';
export type TenantStatus = 'ACTIVE' | 'GRACE' | 'SUSPENDED';
export type InventoryMode = 'UNIT_BASED' | 'RECIPE_BASED';
export type ValuationMethod = 'WAC' | 'FIFO';

/**
 * Business type — determines default chart of accounts on tenant onboarding
 * and which feature sets are unlocked (e.g. recipe/ingredient inventory for F&B).
 */
export type BusinessType =
  // F&B group — all of these unlock recipe-based inventory and modifier groups
  | 'COFFEE_SHOP'   // Café, milk tea, coffee kiosk (legacy value — kept for backward compat)
  | 'RESTAURANT'    // Dine-in or takeout restaurant
  | 'BAKERY'        // Bakery, pastry shop, cake shop
  | 'FOOD_STALL'    // Carinderia, turo-turo, market stall
  | 'BAR_LOUNGE'    // Bar, lounge, nightspot with food/drinks
  | 'CATERING'      // Catering / events food service
  // Non-F&B group
  | 'RETAIL'
  | 'SERVICE'
  | 'MANUFACTURING';

/**
 * The complete set of F&B business types.
 * Any type in this set unlocks:
 *   • Recipe-based inventory (ingredient BOM)
 *   • Modifier groups (Size, Add-ons, Temperature, etc.)
 *   • Ingredients tab in Inventory
 */
export const FNB_BUSINESS_TYPES = [
  'COFFEE_SHOP',
  'RESTAURANT',
  'BAKERY',
  'FOOD_STALL',
  'BAR_LOUNGE',
  'CATERING',
] as const;

export type FnbBusinessType = (typeof FNB_BUSINESS_TYPES)[number];

/**
 * Returns true when the given business type is a Food & Beverage operation.
 * Use this everywhere instead of `businessType === 'COFFEE_SHOP'`.
 */
export function isFnbType(businessType: string | null | undefined): boolean {
  return (FNB_BUSINESS_TYPES as readonly string[]).includes(businessType ?? '');
}

/**
 * Accounting method:
 * - ACCRUAL: revenue/expense recognized when earned/incurred (standard for VAT-registered MSMEs)
 * - CASH: recognized when cash moves (simplified; backyard / non-registered businesses)
 */
export type AccountingMethod = 'CASH' | 'ACCRUAL';

/**
 * BIR registration / VAT status — the single source of truth for tax behavior.
 *
 * VAT          → BIR-registered + VAT-registered (12% VAT on sales, issues VAT Official Receipt)
 * NON_VAT      → BIR-registered but NOT VAT-registered (no 12% VAT, issues Official Receipt)
 * UNREGISTERED → No BIR COR (issues Acknowledgement Receipt only; no TIN displayed)
 *
 * Derivations (maintained on Tenant for backward compatibility):
 *   isVatRegistered  = taxStatus === 'VAT'
 *   isBirRegistered  = taxStatus === 'VAT' || taxStatus === 'NON_VAT'
 */
export type TaxStatus = 'VAT' | 'NON_VAT' | 'UNREGISTERED';

/** Derive convenience flags from the canonical TaxStatus. */
export function taxStatusFlags(status: TaxStatus) {
  return {
    isVatRegistered: status === 'VAT',
    isBirRegistered: status === 'VAT' || status === 'NON_VAT',
  };
}

/* ─── MDM / RBAC helpers ─────────────────────────────────────────────────── */

/**
 * Roles that may INSERT/UPDATE/DELETE master data (Products, Employees).
 * Used by both the backend @Roles() decorators and the frontend canEdit gate.
 */
export const MASTER_DATA_ROLES = ['BUSINESS_OWNER', 'MDM'] as const;
export type MasterDataRole = (typeof MASTER_DATA_ROLES)[number];

/**
 * Roles that may INSERT/UPDATE/DELETE payroll and financial report records.
 * Restricted to OWNER only — MDM has no access to financial data.
 */
export const OWNER_ONLY_ROLES = ['BUSINESS_OWNER'] as const;

/** Returns true when the given role may write products/employees. */
export function canManageMasterData(role: string | undefined | null): boolean {
  return (MASTER_DATA_ROLES as readonly string[]).includes(role ?? '');
}

/** Returns true when the given role may access payroll/financial reports. */
export function isOwnerRole(role: string | undefined | null): boolean {
  return role === 'BUSINESS_OWNER';
}

export interface TenantContext {
  id:               string;
  name:             string;
  tier:             SubscriptionTier;
  status:           TenantStatus;
  businessType:     BusinessType;
  branchQuota:      number;
  cashierSeatQuota: number;
  hasTimeMonitoring: boolean;
  /** Legacy flag — use taxStatus for finer control */
  hasBirForms:      boolean;
  /**
   * Primary tax classification per BIR registration.
   * All tax math and receipt formatting derives from this field.
   */
  taxStatus:        TaxStatus;
  /** Derived from taxStatus — kept for backward compatibility */
  isBirRegistered:  boolean;
  /** Derived from taxStatus — kept for backward compatibility */
  isVatRegistered:  boolean;
  /** Accounting method for this tenant */
  accountingMethod: AccountingMethod;
  /** BIR Tax Identification Number (format: 000-000-000-00000) */
  tinNumber?:       string;
  /** Business name as it appears on the BIR Certificate of Registration */
  businessName?:    string;
  /** Registered address as it appears on the BIR Certificate of Registration */
  registeredAddress?: string;
  /** True when the tenant holds a BIR Permit to Use (PTU) for CAS-accredited POS */
  isPtuHolder:      boolean;
  /** PTU number as printed on the BIR PTU certificate */
  ptuNumber?:       string;
  /** Machine Identification Number (MIN) assigned by BIR during CAS accreditation */
  minNumber?:       string;
}

/* ─── Provider Phase ─────────────────────────────────────────────────────────
 *
 * Controls which document titles and BIR compliance features are active.
 *
 * Phase 1 — Internal Management (pre-accreditation):
 *   All POS receipts use "ACKNOWLEDGEMENT RECEIPT" regardless of taxStatus.
 *   PTU/MIN numbers hidden. BIR-specific footers suppressed.
 *   This protects businesses from issuing official receipts before they have
 *   the necessary BIR accreditation (PTU, COR, CAS).
 *
 * Phase 2 — BIR Certified (post-accreditation):
 *   Receipt titles follow taxStatus: VAT OR / Non-VAT OR / AR.
 *   PTU and MIN printed when available. Full BIR compliance footers shown.
 */
export type ProviderPhase = 1 | 2;

/**
 * Returns the active provider phase from the NEXT_PUBLIC_PROVIDER_PHASE env var.
 * Defaults to 1 (safest — no BIR document issuance) if the env var is absent or invalid.
 * Call this only on the client side (or in a Next.js layout).
 */
export function getProviderPhase(): ProviderPhase {
  if (typeof process === 'undefined') return 1;
  const raw = (process.env.NEXT_PUBLIC_PROVIDER_PHASE ?? '1').trim();
  return raw === '2' ? 2 : 1;
}
