/**
 * Shared domain types for Clerque Counter. Mirrors a subset of the Cloud API
 * contracts — full types live in `packages/shared-types` on the monorepo and
 * will be wired through here once we extract the cross-app package.
 */

export type BusinessType =
  | 'COFFEE_SHOP' | 'RESTAURANT' | 'BAKERY' | 'FOOD_STALL' | 'BAR_LOUNGE' | 'CATERING'
  | 'RETAIL'
  | 'SERVICE'
  | 'LAUNDRY'
  | 'MANUFACTURING'
  | 'PHARMACY'
  | 'TRUCKING'
  | 'CONSTRUCTION'
  | 'MEDICAL_EQUIPMENT'
  | 'GAS_STATION'
  // ── Legacy / fallback values kept for older JWTs ────────────────────────
  | 'COFFEE_FB'
  | 'RETAIL_SARISARI'
  | 'F_AND_B'
  | 'OTHER';

/** Plan codes the app cares about (others = no Counter access). */
export type PlanCode = 'SOLO_LITE' | 'SOLO_STANDARD' | 'SOLO_PRO';

export interface TenantConfig {
  id: string;
  name: string;
  businessType: BusinessType;
  planCode: PlanCode;
  isVatRegistered: boolean;
  tin: string;
  taxStatus: 'VAT' | 'NON_VAT' | 'UNREGISTERED';
  /** Pre-printed BIR OR booklet — next OR number to assign. */
  nextOrNumber: number;
  receiptHeaderNote?: string;
  receiptFooterNote?: string;
  receiptLogoUrl?: string;
  /** FDA License to Operate — printed on every receipt header for DME tenants. */
  fdaLicenseNumber?: string;
  /** Plan-feature flags pre-resolved by the Cloud /me endpoint. */
  planFeatures: PlanFeatures;
}

export interface PlanFeatures {
  maxRecipes: number;
  maxAdvancedInventoryItems: number;
  salesLeadDelegation: number;
  customerPhoneLookup: boolean;
  receiptCustomization: 'none' | 'headerFooter' | 'full';
  advancedReports: boolean;
  loyaltyPro: boolean;
  autoBackup: boolean;
  fifoValuation: boolean;
  makerCheckerVoids: boolean;
  auditLog: boolean;
  customRoles: boolean;
  apiAccess: 'none' | 'read' | 'readwrite';
}

export interface AuthSession {
  jwt: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: 'BUSINESS_OWNER' | 'BRANCH_MANAGER' | 'CASHIER' | 'SALES_LEAD' | 'MDM' | 'WAREHOUSE_STAFF' | 'SUPER_ADMIN';
    isSalesLead: boolean;
  };
  cashier?: {
    id: string;
    name: string;
    pinVerifiedAt: number;
  };
}

export type SyncState = 'online' | 'offline' | 'syncing';

export interface CartLine {
  id: string;                 // client-side uuid
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  qty: number;
  unitPrice: number;          // ₱ cents
  modifiers: CartModifier[];
  lineTotal: number;          // ₱ cents, post-modifier
  /** Pharmacy: per-batch FEFO consumption. */
  lotId?: string;
  lotExpiresAt?: string;
  /** Pharmacy: dispensing pharmacist who PIN-attested. */
  dispensedById?: string;
  /** F&B: per-line kitchen status. */
  kitchenStatus?: 'NEW' | 'FIRED' | 'READY' | 'SERVED';
  /** Discount applied to this line. MARKDOWN is the bakery end-of-day
   *  bread-near-expiry % off — separated from SENIOR/PWD so Z-read can
   *  break out markdown sales for margin analysis without conflating them
   *  with VAT-exempt PWD discounts. */
  discount?: { kind: 'SENIOR' | 'PWD' | 'MANUAL' | 'MARKDOWN'; percent?: number; fixedCents?: number };
  /** Void marker (struck-through line; sequence preserved for BIR audit). */
  voidedAt?: string;
  voidReason?: string;
  /** Soft-removed before order finalize (no PIN). Distinct from voidedAt. */
  removed?: boolean;
}

export interface CartModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceAdjustment: number;     // ₱ cents
}

export type PaymentMethod = 'CASH' | 'GCASH' | 'PAYMAYA' | 'CARD' | 'OTHER';

export interface CartPayment {
  method: PaymentMethod;
  amount: number;             // ₱ cents
  reference?: string;
}

export type DiningMode = 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';

export interface CartState {
  lines: CartLine[];
  payments: CartPayment[];
  /** F&B */
  diningMode?: DiningMode;
  tableNumber?: string;
  /** Customer (B2B or loyalty). */
  customer?: {
    id?: string;
    name?: string;
    phone?: string;
    tin?: string;
  };
  /** Order-level senior/PWD ID — applied to multiple lines. */
  pwdScId?: { idRef: string; ownerName: string; kind: 'SENIOR' | 'PWD' };
}
