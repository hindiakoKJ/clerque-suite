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
  // Sprint 23 — Solo lineup (POS-only, three tiers). The only actively
  // promoted plan family for new signups.
  | 'SOLO_LITE'  | 'SOLO_STANDARD' | 'SOLO_PRO'
  // ── PARKED — kept in code for grandfathered tenants, NOT actively
  //    promoted to new signups. Redesign queued for a follow-up sprint:
  //    repositioning around "Counter + Sync" naming, smoothing the seat-
  //    count cliff above SOLO_PRO, and consolidating the 7 SKUs below
  //    into a smaller, clearer ladder.
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
  // ── Sprint 23 Solo lineup (POS-only, 3 tiers) ───────────────────────────
  SOLO_LITE: {
    moduleCount: 1, baseSeats: 1, maxAddons: 0, maxTotal: 1,
    pricePhpMonthlyCents: 19_900, addonSeatPhpMonthlyCents: 0,
    annualMonthEquivalent: 10,
  },
  SOLO_STANDARD: {
    moduleCount: 1, baseSeats: 3, maxAddons: 0, maxTotal: 3,
    pricePhpMonthlyCents: 39_900, addonSeatPhpMonthlyCents: 0,
    annualMonthEquivalent: 10,
  },
  SOLO_PRO: {
    moduleCount: 1, baseSeats: 5, maxAddons: 0, maxTotal: 5,
    pricePhpMonthlyCents: 49_900, addonSeatPhpMonthlyCents: 0,
    annualMonthEquivalent: 10,
  },

  // ── PARKED — Pair (any two modules) ─────────────────────────────────────
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
  // Solo lineup
  SOLO_LITE:     { maxBranches: 1, maxAiPerMonth:   0, apiRatePerHour:   0 },
  SOLO_STANDARD: { maxBranches: 1, maxAiPerMonth:   0, apiRatePerHour:   0 },
  SOLO_PRO:      { maxBranches: 1, maxAiPerMonth:   0, apiRatePerHour: 100 },
  // PARKED — multi-module legacy
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

  // ── Sprint 23 — Solo-tier-specific gating ──────────────────────────────
  /** Recipe-based product cap. -1 = unlimited, 0 = recipe mode disabled. */
  maxRecipes:                 number;
  /** Number of inventory items that can have advanced tracking (batches +
   *  expiry + FEFO consumption hint) enabled. -1 = unlimited, 0 = disabled. */
  maxAdvancedInventoryItems:  number;
  /** Number of Sales Lead delegations (separate supervisor PIN holders).
   *  -1 = unlimited, 0 = owner is the only supervisor. */
  salesLeadDelegation:        number;
  /** Customer phone-lookup at the till (autocomplete in PaymentModal). */
  customerPhoneLookup:        boolean;
  /** Receipt customization level. */
  receiptCustomization:       'none' | 'headerFooter' | 'full';
  /** Advanced POS reports (hourly heatmaps, weekday patterns, attach rate). */
  advancedReports:            boolean;
  /** Loyalty Pro — digital stamp cards with QR redemption (beyond points). */
  loyaltyPro:                 boolean;
  /** Auto-backup to user's Google Drive on a daily schedule. */
  autoBackup:                 boolean;
  /** FIFO valuation as an alternative to default WAC (Pro-tier only).
   *  WAC is universal; FIFO is the opt-in upgrade for accountants who want
   *  historical-cost matching during inflationary periods. */
  fifoValuation:              boolean;
  /** Maker-checker authorization on voids/refunds above a tenant-set threshold. */
  makerCheckerVoids:          boolean;
}

export const PLAN_FEATURES: Record<PlanCode, PlanFeatures> = {
  // ── Sprint 23 Solo lineup ────────────────────────────────────────────────
  SOLO_LITE: {
    // Loyverse-Free-equivalent baseline + PH compliance. No premium features.
    birForms: false, customRoles: false, auditLog: false, crossModuleReports: false,
    aiAddons: false, apiAccess: 'none', whitelabel: false, customDomain: false,
    maxRecipes: 5, maxAdvancedInventoryItems: 0, salesLeadDelegation: 0,
    customerPhoneLookup: false, receiptCustomization: 'none', advancedReports: false,
    loyaltyPro: false, autoBackup: false, fifoValuation: false, makerCheckerVoids: false,
  },
  SOLO_STANDARD: {
    // Adds unlimited recipes + 10 FEFO/batch/expiry items + Sales Lead + customer lookup + receipt header/footer.
    birForms: false, customRoles: false, auditLog: false, crossModuleReports: false,
    aiAddons: false, apiAccess: 'none', whitelabel: false, customDomain: false,
    maxRecipes: -1, maxAdvancedInventoryItems: 10, salesLeadDelegation: 1,
    customerPhoneLookup: true, receiptCustomization: 'headerFooter', advancedReports: false,
    loyaltyPro: false, autoBackup: false, fifoValuation: false, makerCheckerVoids: false,
  },
  SOLO_PRO: {
    // All Solo-line features unlocked. Single module (POS) — multi-module is PAIR/SUITE.
    birForms: false, customRoles: true, auditLog: true, crossModuleReports: false,
    aiAddons: false, apiAccess: 'read', whitelabel: false, customDomain: false,
    maxRecipes: -1, maxAdvancedInventoryItems: -1, salesLeadDelegation: -1,
    customerPhoneLookup: true, receiptCustomization: 'full', advancedReports: true,
    loyaltyPro: true, autoBackup: true, fifoValuation: true, makerCheckerVoids: true,
  },

  // ── PARKED — multi-module legacy ────────────────────────────────────────
  PAIR_T1:    { birForms: true,  customRoles: false, auditLog: false, crossModuleReports: true,  aiAddons: false, apiAccess: 'none',      whitelabel: false, customDomain: false, maxRecipes: -1, maxAdvancedInventoryItems: 10, salesLeadDelegation: 1, customerPhoneLookup: true, receiptCustomization: 'headerFooter', advancedReports: false, loyaltyPro: false, autoBackup: false, fifoValuation: false, makerCheckerVoids: false },
  PAIR_T2:    { birForms: true,  customRoles: false, auditLog: false, crossModuleReports: true,  aiAddons: true,  apiAccess: 'none',      whitelabel: false, customDomain: false, maxRecipes: -1, maxAdvancedInventoryItems: -1, salesLeadDelegation: -1, customerPhoneLookup: true, receiptCustomization: 'full', advancedReports: true, loyaltyPro: true, autoBackup: true, fifoValuation: true, makerCheckerVoids: true },
  PAIR_T3:    { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: true,  aiAddons: true,  apiAccess: 'read',      whitelabel: false, customDomain: false, maxRecipes: -1, maxAdvancedInventoryItems: -1, salesLeadDelegation: -1, customerPhoneLookup: true, receiptCustomization: 'full', advancedReports: true, loyaltyPro: true, autoBackup: true, fifoValuation: true, makerCheckerVoids: true },
  SUITE_T1:   { birForms: true,  customRoles: false, auditLog: false, crossModuleReports: true,  aiAddons: true,  apiAccess: 'none',      whitelabel: false, customDomain: false, maxRecipes: -1, maxAdvancedInventoryItems: -1, salesLeadDelegation: -1, customerPhoneLookup: true, receiptCustomization: 'full', advancedReports: true, loyaltyPro: true, autoBackup: true, fifoValuation: true, makerCheckerVoids: true },
  SUITE_T2:   { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: true,  aiAddons: true,  apiAccess: 'read',      whitelabel: false, customDomain: false, maxRecipes: -1, maxAdvancedInventoryItems: -1, salesLeadDelegation: -1, customerPhoneLookup: true, receiptCustomization: 'full', advancedReports: true, loyaltyPro: true, autoBackup: true, fifoValuation: true, makerCheckerVoids: true },
  SUITE_T3:   { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: true,  aiAddons: true,  apiAccess: 'readwrite', whitelabel: false, customDomain: false, maxRecipes: -1, maxAdvancedInventoryItems: -1, salesLeadDelegation: -1, customerPhoneLookup: true, receiptCustomization: 'full', advancedReports: true, loyaltyPro: true, autoBackup: true, fifoValuation: true, makerCheckerVoids: true },
  ENTERPRISE: { birForms: true,  customRoles: true,  auditLog: true,  crossModuleReports: true,  aiAddons: true,  apiAccess: 'readwrite', whitelabel: true,  customDomain: true,  maxRecipes: -1, maxAdvancedInventoryItems: -1, salesLeadDelegation: -1, customerPhoneLookup: true, receiptCustomization: 'full', advancedReports: true, loyaltyPro: true, autoBackup: true, fifoValuation: true, makerCheckerVoids: true },
};

// Sprint 23 — PLAN_MONTHLY_PRICE_PHP_CENTS deleted.
//
// Previously there was a separate map here that disagreed with
// `PLAN_CAPS[plan].pricePhpMonthlyCents` (e.g., STD_SOLO was ₱199 in
// PLAN_CAPS but ₱499 in this duplicate map). The billing service used
// the duplicate while the marketing/settings UI used PLAN_CAPS — meaning
// customers saw ₱199 on the website but got billed ₱499.
//
// Canonical source for ALL price reads is now `PLAN_CAPS[plan].pricePhpMonthlyCents`.
// The plans.spec.ts invariant test asserts there is exactly one price per plan.

/** Plan-level setup fee in PHP centavos. One-time, waived on annual prepay. */
export const PLAN_SETUP_FEE_PHP_CENTS: Record<PlanCode, number> = {
  // Solo lineup — no setup fees (entry-friendly)
  SOLO_LITE:       0,
  SOLO_STANDARD:   0,
  SOLO_PRO:        0,
  // PARKED — multi-module legacy
  PAIR_T1:    99_900,
  PAIR_T2:   199_900,
  PAIR_T3:   349_900,
  SUITE_T1:  149_900,
  SUITE_T2:  299_900,
  SUITE_T3:  499_900,
  ENTERPRISE: 999_900,
};

/**
 * STD_* (Single Module) plans must have exactly one of {POS, Ledger, Payroll}
 * enabled — the user picks which module they want at the plan-selection step.
 *
 * Previously this was hard-coded to POS-only; Sprint 21 broadened to support
 * Ledger-only signups (accounting-firm tenants, bookkeepers servicing
 * multiple SMEs) and Payroll-only signups (HR-outsource shops). Pricing is
 * unchanged — a Single Module plan at any module costs the same.
 *
 * Returns the validation error message if the combination is invalid for
 * the standalone tier, or null if valid. PAIR / SUITE / ENTERPRISE plans
 * always return null here — they have their own module-count enforcement
 * in the moduleCount-vs-onCount check.
 */
export function validateSoloModuleCombo(
  planCode: PlanCode,
  modulePos: boolean,
  moduleLedger: boolean,
  modulePayroll: boolean,
): string | null {
  // After Sprint 23 cleanup, only SOLO_* plans are single-module-restricted.
  // PAIR_* / SUITE_* / ENTERPRISE handle module-count enforcement via their
  // own logic in tenant.service. (Previously STD_BIZ also fell here; it was
  // removed in commit 91ce574's successor.)
  const isSolo = planCode.startsWith('SOLO_');
  if (!isSolo) return null;

  const planLabel = planCode
    .replace('SOLO_', 'Solo ')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b./g, (c) => c.toUpperCase());

  if (!modulePos) {
    return `${planLabel} plan is POS-only — the POS module must be enabled.`;
  }
  if (moduleLedger || modulePayroll) {
    return `${planLabel} plan is POS-only — Ledger and Payroll cannot be enabled. Upgrade to Pair for 2 modules.`;
  }
  return null;
}

/**
 * Alias kept for clarity in newer callers. Same logic — name better reflects
 * that this rule applies to all STD_* plans, not just Solo.
 */
export const validateStandaloneModuleCombo = validateSoloModuleCombo;

/** Returns the user-facing display name for a plan code. */
export function planLabel(code: PlanCode): string {
  return ({
    SOLO_LITE:     'Solo Lite',
    SOLO_STANDARD: 'Solo Standard',
    SOLO_PRO:      'Solo Pro',
    // PARKED — multi-module legacy (will be renamed/redesigned in a follow-up sprint)
    PAIR_T1:       'Pair T1 (legacy)',
    PAIR_T2:       'Pair T2 (legacy)',
    PAIR_T3:       'Pair T3 (legacy)',
    SUITE_T1:      'Suite T1 (legacy)',
    SUITE_T2:      'Suite T2 (legacy)',
    SUITE_T3:      'Suite T3 (legacy)',
    ENTERPRISE:    'Enterprise (legacy)',
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

// ─────────────────────────────────────────────────────────────────────────────
// Plan-based permission / persona availability
//
// Replaces the legacy tier-feature-flag indirection with a direct mapping to
// plan modules + PLAN_FEATURES. Used by the Staff Edit UI and assertPermission
// defense-in-depth checks. The legacy isPermissionAvailableAtTier still exists
// in tiers.ts for backward compatibility but is no longer consulted at runtime.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanContext {
  planCode:     PlanCode;
  modulePos:    boolean;
  moduleLedger: boolean;
  modulePayroll:boolean;
}

/**
 * Permission → plan-availability check. Returns true when the tenant's plan
 * (modules + features) makes the permission exercisable. Permissions not
 * listed below are universal — gated only by role.
 *
 * Mirrors the semantic intent of tiers.PERMISSION_REQUIRES_FEATURE:
 *   ledger:* read       → Ledger module on
 *   ledger:* full       → Ledger module on (no extra feature flag — Ledger is binary)
 *   payroll:*           → Payroll module on
 *   audit:view          → PLAN_FEATURES.auditLog
 *   bir:view            → PLAN_FEATURES.birForms
 *   staff:assign_payroll_master → Payroll module on
 */
export function isPermissionAvailableUnderPlan(
  permission: string,
  ctx: PlanContext,
): boolean {
  const f = PLAN_FEATURES[ctx.planCode];

  switch (permission) {
    // Ledger surface
    case 'ledger:view':
    case 'ledger:trial_balance':
    case 'ledger:export':
    case 'finance:cash_flow':
    case 'ledger:journal_entry':
    case 'ledger:period_close':
    case 'ledger:period_reopen':
    case 'finance:bank_recon':
      return ctx.moduleLedger || PLAN_CAPS[ctx.planCode].moduleCount === 3;

    // Payroll surface
    case 'payroll:view_salary':
    case 'payroll:edit':
    case 'payroll:run':
    case 'staff:assign_payroll_master':
      return ctx.modulePayroll || PLAN_CAPS[ctx.planCode].moduleCount === 3;

    // Compliance
    case 'audit:view': return f.auditLog;
    case 'bir:view':   return f.birForms;

    default:
      return true; // universal
  }
}

/**
 * Returns the human-readable upgrade hint for a plan-locked permission, or
 * null if the permission is universally available. Used by the Staff Edit UI
 * to render "Upgrade to Pair / Suite / Enterprise" tooltips.
 */
export function getRequiredPlanForPermission(permission: string): string | null {
  switch (permission) {
    case 'ledger:view':
    case 'ledger:trial_balance':
    case 'ledger:export':
    case 'finance:cash_flow':
    case 'ledger:journal_entry':
    case 'ledger:period_close':
    case 'ledger:period_reopen':
    case 'finance:bank_recon':
      return 'Add the Ledger module (Pair or Suite plan).';
    case 'payroll:view_salary':
    case 'payroll:edit':
    case 'payroll:run':
    case 'staff:assign_payroll_master':
      return 'Add the Payroll module (Pair or Suite plan).';
    case 'audit:view':
      return 'Upgrade to Business / Pair T3 / Suite T2 or higher (audit log).';
    case 'bir:view':
      return 'Upgrade to Duo or higher (BIR forms).';
    default:
      return null;
  }
}
