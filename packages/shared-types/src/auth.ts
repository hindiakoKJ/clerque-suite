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
  | 'EXTERNAL_AUDITOR'
  // Service / Display Accounts — credentials for kiosk hardware (KDS, customer
  // display). NOT real employees. No Payroll, no Ledger, no Terminal access.
  // Excluded from staff cap.
  | 'KIOSK_DISPLAY'
  // Machine principal — another app in the ecosystem calling Clerque with an
  // API key (a booking app writing its sales, for example). NOT a person and
  // NOT a User row: there is no login, no seat, no staff-cap slot, and
  // JwtPayload.sub is empty for it. It appears in NO entry of
  // PERMISSION_MATRIX, so it holds no permission unless a route names
  // 'SERVICE' in @Roles(...) explicitly. Never add it to a role picker.
  | 'SERVICE';

/**
 * The subset of UserRole a `User` row may actually hold. SERVICE is excluded
 * because it belongs to an API key, not a person — there is no User row and
 * the Prisma `UserRole` enum has no such value. Use this anywhere a role is
 * persisted, assigned, or offered in a picker.
 */
export type StaffRole = Exclude<UserRole, 'SERVICE'>;

/**
 * The roles a shop can actually HIRE someone into, as a runtime list.
 *
 * There were four copies of this list: the Prisma enum, the `UserRole` type
 * above, `STAFF_ROLES` in the users DTO, and a fourth hand-typed union in the
 * Staff screen. Three of them were meant to say the same thing and had already
 * drifted -- AR_ACCOUNTANT and AP_ACCOUNTANT are valid in the database, carry
 * `ledger:view` in PERMISSION_MATRIX, and are named in 107 @Roles decorators
 * across the API, but neither the DTO nor the UI could assign them. So a
 * hundred-odd endpoints were gated to two roles nobody could hold.
 *
 * One list now, imported by both the DTO and the screen. The Prisma enum stays
 * the database's own source of truth -- it cannot import TypeScript -- and
 * HIREABLE_ROLE_SET below is what keeps the two honest.
 *
 * Two deliberate exclusions:
 *   SUPER_ADMIN — platform staff at HNS, not a shop employee.
 *   SERVICE     — an API key, not a person; it has no User row at all.
 */
export const HIREABLE_ROLES = [
  'BUSINESS_OWNER',
  'BRANCH_MANAGER',
  'SALES_LEAD',
  'CASHIER',
  'MDM',
  'WAREHOUSE_STAFF',
  'FINANCE_LEAD',
  'BOOKKEEPER',
  'ACCOUNTANT',
  'AR_ACCOUNTANT',
  'AP_ACCOUNTANT',
  'PAYROLL_MASTER',
  'GENERAL_EMPLOYEE',
  'EXTERNAL_AUDITOR',
  // Service / display accounts — kiosk credentials, not real employees.
  // No Payroll, no Ledger, no Terminal. Excluded from the staff cap.
  'KIOSK_DISPLAY',
] as const satisfies readonly StaffRole[];

export type HireableRole = (typeof HIREABLE_ROLES)[number];

/** Membership test, so callers do not re-list the values to check one. */
export const HIREABLE_ROLE_SET: ReadonlySet<string> = new Set(HIREABLE_ROLES);

export function isHireableRole(role: string | null | undefined): role is HireableRole {
  return !!role && HIREABLE_ROLE_SET.has(role);
}

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
  // KIOSK_DISPLAY: POS only (read + KDS bump/serve). NO Ledger, NO Payroll —
  // these tablets aren't real employees, they're hardware credentials.
  KIOSK_DISPLAY:     [{ app: 'POS', level: 'OPERATOR' },  { app: 'LEDGER', level: 'NONE' },      { app: 'PAYROLL', level: 'NONE' }],
  // SERVICE: transact-only. OPERATOR (not FULL) because an ecosystem app
  // should be able to ring up a sale but never reconfigure the POS. Ledger
  // and Payroll stay NONE — an external app must never touch the books
  // directly; it writes sales and Clerque derives the accounting.
  // ApiKeyStrategy narrows this further to the tenant's enabled modules.
  SERVICE:           [{ app: 'POS', level: 'OPERATOR' },  { app: 'LEDGER', level: 'NONE' },      { app: 'PAYROLL', level: 'NONE' }],
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
  /** Sprint 19 — Receipt template fields (owner-editable). All optional;
   *  fall back to baked-in defaults when null. */
  receiptHeaderNote?: string | null;
  receiptFooterNote?: string | null;
  receiptLogoUrl?:    string | null;
  /** Sprint 19 — When false (default), staff cannot clock in/out from
   *  their own Sync account; only the shared kiosk tablet works. The
   *  frontend uses this to hide the Clock sidebar link. */
  allowSelfClockIn?:  boolean;
  /** Sprint 19 — Returns/refunds owner-only policy. When true, only
   *  BUSINESS_OWNER + SUPER_ADMIN can void or refund. Pharmacy tenants
   *  default to true; other verticals default false. */
  returnsOwnerOnly?:  boolean;
  /**
   * Owner-toggled ledger surface (2026-08-17). SIMPLE = the non-accountant
   * Ledger only (Record Entry, Profit, Reports, Settlement); the advanced
   * suite is hidden in the nav AND 403'd server-side because the mint
   * overrides planFeatures.advancedAccounting=false. Default FULL.
   */
  ledgerMode?:        'FULL' | 'SIMPLE';
  /**
   * Single-currency tenant locale (2026-08-17). NOT an FX engine — the GL
   * amounts are simply "in this currency". Frontend money formatter reads
   * these; defaults keep the PH fleet unchanged. ISO 3166-1 / ISO 4217 / IANA.
   */
  country?:           string;
  currency?:          string;
  timezone?:          string;
  /**
   * Monthly AI prompt quota resolved from tier-included + active addon +
   * SUPER_ADMIN override. Baked into JWT at login. Frontend uses this to
   * hide AI affordances when 0 and show usage warnings when low. Backend
   * AiQuotaGuard counts this month's usage against the quota.
   *
   * Set to 0 when:
   *   - Tier doesn't include AI and no addon active
   *   - Override is explicitly 0 (kill switch)
   *   - Addon expired
   */
  aiQuotaMonthly?:    number;
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
  /**
   * Tenant module entitlement (modular pricing, 2026-05-08). Baked into
   * the JWT at issuance time so guards can reject requests for disabled
   * modules without an extra DB lookup. All three default to true for
   * backward compatibility — pre-existing tenants keep full access.
   */
  modulePos?:     boolean;
  moduleLedger?:  boolean;
  modulePayroll?: boolean;
  /** Authoritative plan code; drives per-plan staff cap + module checks. */
  planCode?:      import('./plans').PlanCode;
  /**
   * Plan-driven cross-cutting feature flags (custom roles, audit log, API,
   * white-label, etc.). Baked at JWT issuance so guards can check without
   * a DB lookup. Derived from PLAN_FEATURES[planCode].
   */
  planFeatures?:  import('./plans').PlanFeatures;
  /**
   * Plan limits — branch / AI / API hourly rate. Derived from PLAN_LIMITS[planCode].
   */
  planLimits?:    import('./plans').PlanLimits;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
