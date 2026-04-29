export type UserRole =
  // Administrative
  | 'SUPER_ADMIN'
  | 'BUSINESS_OWNER'
  // Operations
  | 'BRANCH_MANAGER'
  // Sales & Revenue
  | 'SALES_LEAD'       // Sales + void/discount authority
  | 'CASHIER'
  | 'AR_ACCOUNTANT'    // Accounts Receivable (Phase 4)
  // Expenditure & Inventory
  | 'AP_ACCOUNTANT'    // Accounts Payable (Phase 4)
  | 'MDM'              // Master Data Manager — products/prices; assigned by OWNER only
  | 'WAREHOUSE_STAFF'  // Stock movement only
  // Finance & Compliance
  | 'FINANCE_LEAD'     // Bank recon / cash-flow
  | 'BOOKKEEPER'       // Journal entries / GL
  | 'PAYROLL_MASTER'   // Salaries / payroll; exclusive salary column access
  | 'ACCOUNTANT'       // Legacy — full ledger read
  | 'GENERAL_EMPLOYEE'
  | 'EXTERNAL_AUDITOR';

/* ─── App access ─────────────────────────────────────────────────────────── */

export type AppCode = 'POS' | 'LEDGER' | 'PAYROLL';

/**
 * Ordered by privilege level — higher index = more access.
 * levelValue() uses this order for comparisons.
 */
export type AccessLevel =
  | 'NONE'
  | 'CLOCK_ONLY'   // Payroll: punch-in/out + own history only
  | 'READ_ONLY'
  | 'OPERATOR'     // Can transact; cannot configure settings
  | 'FULL';

export interface AppAccessEntry {
  app: AppCode;
  level: AccessLevel;
}

/** Returns a numeric value for access level comparison */
export function levelValue(level: AccessLevel | undefined): number {
  const order: AccessLevel[] = ['NONE', 'CLOCK_ONLY', 'READ_ONLY', 'OPERATOR', 'FULL'];
  return order.indexOf(level ?? 'NONE');
}

/* ─── Default access per role ────────────────────────────────────────────── */

export const DEFAULT_APP_ACCESS: Record<UserRole, AppAccessEntry[]> = {
  // ── Administrative ───────────────────────────────────────────────────────────
  SUPER_ADMIN:       [{ app: 'POS', level: 'FULL' },      { app: 'LEDGER', level: 'FULL' },      { app: 'PAYROLL', level: 'FULL' }],
  BUSINESS_OWNER:    [{ app: 'POS', level: 'FULL' },      { app: 'LEDGER', level: 'FULL' },      { app: 'PAYROLL', level: 'FULL' }],
  // ── Operations ───────────────────────────────────────────────────────────────
  BRANCH_MANAGER:    [{ app: 'POS', level: 'OPERATOR' },  { app: 'LEDGER', level: 'READ_ONLY' }, { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  // ── Sales & Revenue ──────────────────────────────────────────────────────────
  SALES_LEAD:        [{ app: 'POS', level: 'OPERATOR' },  { app: 'LEDGER', level: 'NONE' },      { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  CASHIER:           [{ app: 'POS', level: 'OPERATOR' },  { app: 'LEDGER', level: 'NONE' },      { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  AR_ACCOUNTANT:     [{ app: 'POS', level: 'NONE' },      { app: 'LEDGER', level: 'OPERATOR' },  { app: 'PAYROLL', level: 'NONE' }],
  // ── Expenditure & Inventory ──────────────────────────────────────────────────
  AP_ACCOUNTANT:     [{ app: 'POS', level: 'NONE' },      { app: 'LEDGER', level: 'OPERATOR' },  { app: 'PAYROLL', level: 'NONE' }],
  MDM:               [{ app: 'POS', level: 'OPERATOR' },  { app: 'LEDGER', level: 'NONE' },      { app: 'PAYROLL', level: 'NONE' }],
  WAREHOUSE_STAFF:   [{ app: 'POS', level: 'OPERATOR' },  { app: 'LEDGER', level: 'NONE' },      { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  // ── Finance & Compliance ─────────────────────────────────────────────────────
  FINANCE_LEAD:      [{ app: 'POS', level: 'READ_ONLY' }, { app: 'LEDGER', level: 'FULL' },      { app: 'PAYROLL', level: 'NONE' }],
  BOOKKEEPER:        [{ app: 'POS', level: 'NONE' },      { app: 'LEDGER', level: 'OPERATOR' },  { app: 'PAYROLL', level: 'NONE' }],
  PAYROLL_MASTER:    [{ app: 'POS', level: 'NONE' },      { app: 'LEDGER', level: 'NONE' },      { app: 'PAYROLL', level: 'FULL' }],
  ACCOUNTANT:        [{ app: 'POS', level: 'NONE' },      { app: 'LEDGER', level: 'FULL' },      { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  GENERAL_EMPLOYEE:  [{ app: 'POS', level: 'NONE' },      { app: 'LEDGER', level: 'NONE' },      { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  EXTERNAL_AUDITOR:  [{ app: 'POS', level: 'READ_ONLY' }, { app: 'LEDGER', level: 'READ_ONLY' }, { app: 'PAYROLL', level: 'NONE' }],
};

/* ─── JWT ────────────────────────────────────────────────────────────────── */

export interface JwtPayload {
  sub:            string;
  name:           string;
  tenantId:       string | null;
  branchId:       string | null;
  role:           UserRole;
  isSuperAdmin:   boolean;
  appAccess:      AppAccessEntry[];
  /**
   * Primary BIR tax classification for the tenant.
   * VAT = VAT-registered; NON_VAT = BIR-registered non-VAT; UNREGISTERED = no COR.
   * Use this for all tax math, receipt formatting, and UI gating.
   */
  taxStatus:       import('./tenant').TaxStatus;
  /** Derived: true when taxStatus === 'VAT'. Kept for backward compatibility. */
  isVatRegistered: boolean;
  /** Derived: true when taxStatus is VAT or NON_VAT. Kept for backward compatibility. */
  isBirRegistered: boolean;
  /** BIR TIN — format 000-000-000-00000. Null for UNREGISTERED tenants. */
  tinNumber?:         string | null;
  /** Business name as on BIR COR. Null for UNREGISTERED tenants. */
  businessName?:      string | null;
  /** Registered address as on BIR COR. */
  registeredAddress?: string | null;
  /** True when the tenant holds a BIR Permit to Use (PTU) for CAS-accredited POS. */
  isPtuHolder:        boolean;
  /** PTU number as printed on the BIR PTU certificate. */
  ptuNumber?:         string | null;
  /** Machine Identification Number (MIN) assigned by BIR during CAS accreditation. */
  minNumber?:         string | null;
  /** Tenant subscription tier — drives tier-locked permission gating in the UI. */
  tier?:              import('./tiers').TierId;
  /**
   * Whether AI features (Drafter, Guide, Smart Picker, Receipt OCR) are
   * enabled for this tenant. Resolved at login from tier + per-tenant
   * override. Frontend hides AI affordances when false; backend
   * AiEnabledGuard returns 403 with code AI_NOT_ENABLED.
   */
  aiEnabled?:         boolean;
  /**
   * RBAC: persona template the user was created from. Reference into
   * packages/shared-types/src/personas.ts. Frontend uses this to render the
   * persona badge + "reset to persona default" affordance on the staff editor.
   */
  personaKey?:        string | null;
  /**
   * RBAC: extra permission grants beyond the role + persona defaults.
   * Backend `assertPermission()` consults this set in addition to the role's
   * default matrix. Empty for users created before the RBAC framework.
   */
  customPermissions?: string[];
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
