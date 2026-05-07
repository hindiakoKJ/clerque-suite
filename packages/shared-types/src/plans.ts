/**
 * Modular pricing plans (2026-05-08).
 *
 * Replaces the old single-axis SubscriptionTier (TIER_1..TIER_6) with a
 * two-axis model: how many modules + staff cap. The legacy `tier` enum is
 * retained on Tenant for rollback safety but is advisory only.
 *
 * The module set per plan code:
 *   STD_*   → exactly one of POS / Ledger / Payroll (chosen by buyer)
 *   PAIR_*  → exactly two
 *   SUITE_* → all three
 *   ENTERPRISE → all three, custom-negotiated, no automated enforcement
 *
 * Each plan has a HARD ceiling — staffSeatQuota + staffSeatAddons must remain
 * <= maxTotal. There are no unlimited tiers; over-50-staff customers go through
 * an Enterprise sales contact form.
 */

export type ClerqueModule = 'POS' | 'LEDGER' | 'PAYROLL';

export type PlanCode =
  | 'STD_SOLO' | 'STD_DUO' | 'STD_TEAM' | 'STD_BIZ'
  | 'PAIR_T1'  | 'PAIR_T2' | 'PAIR_T3'
  | 'SUITE_T1' | 'SUITE_T2' | 'SUITE_T3'
  | 'ENTERPRISE';

export interface PlanCap {
  /** Modules included in the plan: 1 (standalone), 2 (pair), 3 (suite). */
  moduleCount:    1 | 2 | 3;
  /** Base staff seats included in the price. */
  baseSeats:      number;
  /** Maximum number of add-on seats that can be purchased on top of base. */
  maxAddons:      number;
  /** Hard ceiling = baseSeats + maxAddons. Cannot be exceeded by any means. */
  maxTotal:       number;
  /** Monthly price in PHP centavos (₱1.00 = 100). */
  pricePhpMonthlyCents:   number;
  /** Per-additional-seat ₱/mo in centavos. 0 means add-ons not allowed. */
  addonSeatPhpMonthlyCents: number;
  /** Annual prepay discount: pay 10 × monthly = 2 months free. */
  annualMonthEquivalent:  10;
}

export const PLAN_CAPS: Record<PlanCode, PlanCap> = {
  // ── Standalone (one module) ─────────────────────────────────────────────
  STD_SOLO: {
    moduleCount: 1, baseSeats: 1, maxAddons: 0, maxTotal: 1,
    pricePhpMonthlyCents: 19_900, addonSeatPhpMonthlyCents: 0,
    annualMonthEquivalent: 10,
  },
  STD_DUO: {
    moduleCount: 1, baseSeats: 3, maxAddons: 0, maxTotal: 3,
    pricePhpMonthlyCents: 49_900, addonSeatPhpMonthlyCents: 7_900,
    annualMonthEquivalent: 10,
  },
  STD_TEAM: {
    moduleCount: 1, baseSeats: 5, maxAddons: 5, maxTotal: 10,
    pricePhpMonthlyCents: 99_900, addonSeatPhpMonthlyCents: 4_900,
    annualMonthEquivalent: 10,
  },
  STD_BIZ: {
    moduleCount: 1, baseSeats: 10, maxAddons: 15, maxTotal: 25,
    pricePhpMonthlyCents: 189_900, addonSeatPhpMonthlyCents: 2_900,
    annualMonthEquivalent: 10,
  },

  // ── Pair (any two modules) ──────────────────────────────────────────────
  PAIR_T1: {
    moduleCount: 2, baseSeats: 3, maxAddons: 0, maxTotal: 3,
    pricePhpMonthlyCents: 79_900, addonSeatPhpMonthlyCents: 9_900,
    annualMonthEquivalent: 10,
  },
  PAIR_T2: {
    moduleCount: 2, baseSeats: 5, maxAddons: 5, maxTotal: 10,
    pricePhpMonthlyCents: 159_900, addonSeatPhpMonthlyCents: 5_900,
    annualMonthEquivalent: 10,
  },
  PAIR_T3: {
    moduleCount: 2, baseSeats: 10, maxAddons: 15, maxTotal: 25,
    pricePhpMonthlyCents: 289_900, addonSeatPhpMonthlyCents: 3_900,
    annualMonthEquivalent: 10,
  },

  // ── Suite (all three modules) ───────────────────────────────────────────
  SUITE_T1: {
    moduleCount: 3, baseSeats: 5, maxAddons: 0, maxTotal: 5,
    pricePhpMonthlyCents: 119_900, addonSeatPhpMonthlyCents: 9_900,
    annualMonthEquivalent: 10,
  },
  SUITE_T2: {
    moduleCount: 3, baseSeats: 8, maxAddons: 7, maxTotal: 15,
    pricePhpMonthlyCents: 229_900, addonSeatPhpMonthlyCents: 5_900,
    annualMonthEquivalent: 10,
  },
  SUITE_T3: {
    moduleCount: 3, baseSeats: 20, maxAddons: 30, maxTotal: 50,
    pricePhpMonthlyCents: 449_900, addonSeatPhpMonthlyCents: 3_900,
    annualMonthEquivalent: 10,
  },

  // ── Enterprise (sales-led, custom contract) ─────────────────────────────
  // Hard ceiling: 100 staff. Above that = bespoke contract negotiated separately.
  ENTERPRISE: {
    moduleCount: 3, baseSeats: 50, maxAddons: 50, maxTotal: 100,
    pricePhpMonthlyCents: 0, addonSeatPhpMonthlyCents: 0,
    annualMonthEquivalent: 10,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAN_LIMITS — branch / AI / API ceilings per plan.
// Every value is a HARD CEILING — no unlimited tiers anywhere.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanLimits {
  maxBranches:    number;
  maxAiPerMonth:  number;
  apiRatePerHour: number;  // 0 = no API access
}

export const PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  STD_SOLO:   { maxBranches:  1, maxAiPerMonth:    0, apiRatePerHour:     0 },
  STD_DUO:    { maxBranches:  1, maxAiPerMonth:   20, apiRatePerHour:     0 },
  STD_TEAM:   { maxBranches:  2, maxAiPerMonth:   50, apiRatePerHour:     0 },
  STD_BIZ:    { maxBranches:  3, maxAiPerMonth:  100, apiRatePerHour:   100 },
  PAIR_T1:    { maxBranches:  1, maxAiPerMonth:   20, apiRatePerHour:     0 },
  PAIR_T2:    { maxBranches:  2, maxAiPerMonth:   50, apiRatePerHour:     0 },
  PAIR_T3:    { maxBranches:  3, maxAiPerMonth:  100, apiRatePerHour:   100 },
  SUITE_T1:   { maxBranches:  1, maxAiPerMonth:   50, apiRatePerHour:     0 },
  SUITE_T2:   { maxBranches:  3, maxAiPerMonth:  200, apiRatePerHour:   500 },
  SUITE_T3:   { maxBranches:  5, maxAiPerMonth:  500, apiRatePerHour: 1_000 },
  ENTERPRISE: { maxBranches: 15, maxAiPerMonth: 1_000, apiRatePerHour: 5_000 },
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAN_FEATURES — cross-cutting features. NOT vertical-specific (verticals like
// Laundry, F&B, Construction are POS-module features available at every plan
// that includes POS).
// ─────────────────────────────────────────────────────────────────────────────

export type ApiAccessLevel = 'none' | 'read' | 'readwrite';

export interface PlanFeatures {
  /** BIR forms (2550Q, 1701Q, 2551Q, EWT, SAWT, 2307, EIS) */
  birForms:           boolean;
  /** Owner can edit the 38-permission matrix to create custom role variants */
  customRoles:        boolean;
  /** UI to browse the centralized audit trail */
  auditLog:           boolean;
  /** Reports that join sales × AR × payroll cost across modules */
  crossModuleReports: boolean;
  /** Buy AI prompt add-on packages on top of included quota */
  aiAddons:           boolean;
  /** External REST API access level */
  apiAccess:          ApiAccessLevel;
  /** Strip Clerque branding from receipts; replace with tenant's */
  whitelabel:         boolean;
  /** tenant.com instead of clerque.com/tenant */
  customDomain:       boolean;
}

export const PLAN_FEATURES: Record<PlanCode, PlanFeatures> = {
  STD_SOLO:   { birForms: false, customRoles: false, auditLog: false, crossModuleReports: false, aiAddons: false, apiAccess: 'none',      whitelabel: false, customDomain: false },
  STD_DUO:    { birForms: true,  customRoles: false, auditLog: false, crossModuleReports: false, aiAddons: false, apiAccess: 'none',      whitelabel: false, customDomain: false },
  STD_TEAM:   { birForms: true,  customRoles: false, auditLog: false, crossModuleReports: false, aiAddons: true,  apiAccess: 'none',      whitelabel: false, customDomain: false },
  STD_BIZ:    { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: false, aiAddons: true,  apiAccess: 'read',      whitelabel: false, customDomain: false },
  PAIR_T1:    { birForms: true,  customRoles: false, auditLog: false, crossModuleReports: true,  aiAddons: false, apiAccess: 'none',      whitelabel: false, customDomain: false },
  PAIR_T2:    { birForms: true,  customRoles: false, auditLog: false, crossModuleReports: true,  aiAddons: true,  apiAccess: 'none',      whitelabel: false, customDomain: false },
  PAIR_T3:    { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: true,  aiAddons: true,  apiAccess: 'read',      whitelabel: false, customDomain: false },
  SUITE_T1:   { birForms: true,  customRoles: false, auditLog: false, crossModuleReports: true,  aiAddons: true,  apiAccess: 'none',      whitelabel: false, customDomain: false },
  SUITE_T2:   { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: true,  aiAddons: true,  apiAccess: 'read',      whitelabel: false, customDomain: false },
  SUITE_T3:   { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: true,  aiAddons: true,  apiAccess: 'readwrite', whitelabel: false, customDomain: false },
  ENTERPRISE: { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: true,  aiAddons: true,  apiAccess: 'readwrite', whitelabel: true,  customDomain: true  },
};

/** Plan-level setup fee in PHP centavos. One-time, waived on annual prepay. */
export const PLAN_SETUP_FEE_PHP_CENTS: Record<PlanCode, number> = {
  STD_SOLO:        0,
  STD_DUO:    49_900,
  STD_TEAM:   99_900,
  STD_BIZ:   199_900,
  PAIR_T1:    99_900,
  PAIR_T2:   199_900,
  PAIR_T3:   349_900,
  SUITE_T1:  149_900,
  SUITE_T2:  299_900,
  SUITE_T3:  499_900,
  ENTERPRISE: 999_900,
};

/**
 * Solo plan additional rule — only POS module is allowed. Returns the error
 * message if a Solo tenant is attempting to enable Ledger or Payroll, or
 * null if the combination is valid.
 */
export function validateSoloModuleCombo(
  planCode: PlanCode,
  modulePos: boolean,
  moduleLedger: boolean,
  modulePayroll: boolean,
): string | null {
  if (planCode !== 'STD_SOLO') return null;
  if (!modulePos)   return 'Solo plan requires POS to be enabled.';
  if (moduleLedger) return 'Solo plan does not include Ledger. Choose Duo or higher.';
  if (modulePayroll) return 'Solo plan does not include Payroll. Choose Duo or higher.';
  return null;
}

/** Returns the user-facing display name for a plan code. */
export function planLabel(code: PlanCode): string {
  return ({
    STD_SOLO:   'Solo',
    STD_DUO:    'Duo',
    STD_TEAM:   'Team',
    STD_BIZ:    'Business',
    PAIR_T1:    'Pair T1',
    PAIR_T2:    'Pair T2',
    PAIR_T3:    'Pair T3',
    SUITE_T1:   'Suite T1',
    SUITE_T2:   'Suite T2',
    SUITE_T3:   'Suite T3',
    ENTERPRISE: 'Enterprise',
  } satisfies Record<PlanCode, string>)[code];
}

/**
 * Total seat ceiling for a tenant. Returns the lower of:
 *   (a) baseSeats + staffSeatAddons (what the tenant has actually purchased)
 *   (b) PLAN_CAPS[planCode].maxTotal (the absolute ceiling for the plan)
 */
export function effectiveSeatCeiling(
  planCode: PlanCode,
  staffSeatAddons: number,
): number {
  const cap = PLAN_CAPS[planCode];
  const purchased = cap.baseSeats + Math.max(0, staffSeatAddons);
  return Math.min(purchased, cap.maxTotal);
}

export function isModuleEnabled(
  planCode: PlanCode,
  modules: { modulePos: boolean; moduleLedger: boolean; modulePayroll: boolean },
  app: ClerqueModule,
): boolean {
  // Suite plans always include all three. Pair / Standalone respect the per-module flags.
  if (PLAN_CAPS[planCode].moduleCount === 3) return true;
  if (app === 'POS')     return modules.modulePos;
  if (app === 'LEDGER')  return modules.moduleLedger;
  return modules.modulePayroll;
}
