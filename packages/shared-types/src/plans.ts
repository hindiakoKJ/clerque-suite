/**
 * Clerque packaging.
 *
 * ── History ────────────────────────────────────────────────────────────────
 * This file used to hold an 11-code ladder (SOLO_LITE/STANDARD/PRO/BOOKS,
 * PAIR_T1..T3, SUITE_T1..T3, ENTERPRISE) crossed with a module matrix, where
 * a plan dictated WHICH of POS / Ledger / Payroll a tenant could switch on.
 * That ladder was retired: only two of the eleven codes were ever sellable,
 * the active lineup was non-monotonic (SOLO_STANDARD cost more than SOLO_PRO
 * and granted strictly less), and the module matrix made the one thing the
 * product now needs — a tenant running POS and the books together, fed by
 * both a till and an ecosystem app — the awkward case.
 *
 * ── Today ──────────────────────────────────────────────────────────────────
 * There is ONE package. Everything is on. Pricing and tiering will be designed
 * fresh on top of this, so nothing here encodes a price or a ceiling that
 * anyone has agreed to yet — see UNCAPPED_* below.
 *
 * The MECHANISM is deliberately intact. PLAN_CAPS / PLAN_LIMITS /
 * PLAN_FEATURES are still `Record<PlanCode, …>`, so re-introducing tiers later
 * means adding entries to these tables rather than rebuilding the plumbing
 * that reads them (48 `@RequirePlanFeature` decorator sites, AppAccessGuard,
 * the JWT, the API-key resolver).
 *
 * ── Why no data migration was needed ───────────────────────────────────────
 * `Tenant.planCode` is an unvalidated TEXT column. Previously, a value with no
 * entry in these tables was a live hazard: PlanFeatureGuard fails closed,
 * `PLAN_CAPS[code].baseSeats` throws, and — worst — the API-key resolver reads
 * `apiAccess` as 'none' and returns null, which surfaces as
 * "Invalid or expired API key", indistinguishable from a revoked key.
 * With a single package, `normalizePlanCode()` maps ANY stored string onto it,
 * so legacy rows keep working and that entire class of bug is gone.
 */

export type ClerqueModule = 'POS' | 'LEDGER' | 'PAYROLL';

/**
 * The only package. Named neutrally on purpose — when tiering returns, this
 * stays as the base entry and new codes join it.
 */
export type PlanCode = 'CLERQUE';

/** The single package every tenant is on. Use instead of the literal. */
export const DEFAULT_PLAN_CODE: PlanCode = 'CLERQUE';

/**
 * Placeholder ceilings. Large finite numbers rather than -1/Infinity so every
 * existing numeric comparison (seat guard, branch cap, subscription screen)
 * keeps working unchanged and still renders sensibly. These are NOT commercial
 * limits — they exist so the enforcement paths stay exercised until real
 * pricing sets real numbers.
 */
const UNCAPPED_SEATS    = 9_999;
const UNCAPPED_BRANCHES = 999;

export interface PlanCap {
  /** Modules included in the plan: 1 (standalone), 2 (pair), 3 (suite). */
  moduleCount:    1 | 2 | 3;
  /** Base staff seats included in the price. */
  baseSeats:      number;
  /** Maximum number of add-on seats that can be purchased on top of base. */
  maxAddons:      number;
  /** Hard ceiling = baseSeats + maxAddons. Cannot be exceeded by any means. */
  maxTotal:       number;
  /** Monthly price in PHP centavos (₱1.00 = 100). 0 = not yet priced. */
  pricePhpMonthlyCents:   number;
  /** Per-additional-seat ₱/mo in centavos. 0 means add-ons not allowed. */
  addonSeatPhpMonthlyCents: number;
  /** Annual prepay discount: pay 10 × monthly = 2 months free. */
  annualMonthEquivalent:  10;
}

export const PLAN_CAPS: Record<PlanCode, PlanCap> = {
  CLERQUE: {
    // All three modules. A tenant may still switch an individual module off
    // for itself (Tenant.modulePos/moduleLedger/modulePayroll) — the package
    // no longer dictates the combination.
    moduleCount: 3,
    baseSeats: UNCAPPED_SEATS, maxAddons: 0, maxTotal: UNCAPPED_SEATS,
    // Pricing is a deliberate blank. Every price read goes through
    // PLAN_CAPS[plan].pricePhpMonthlyCents, so setting a real number here is
    // the single edit that turns pricing back on.
    pricePhpMonthlyCents: 0, addonSeatPhpMonthlyCents: 0,
    annualMonthEquivalent: 10,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAN_LIMITS — branch / AI / API ceilings per plan.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanLimits {
  maxBranches:    number;
  maxAiPerMonth:  number;
  apiRatePerHour: number;  // 0 = no API access
}

export const PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  // maxAiPerMonth is now the ENFORCED quota, not a display value. It used to
  // be decorative while the real quota came from the legacy Tenant.tier
  // column, which meant the subscription screen and the AI guard could
  // disagree — a tenant could be shown 200 prompts and get 0.
  //
  // This is what the package bundles WHEN AI is switched on. It is currently
  // moot: AI_FEATURES_ENABLED is off, so every tenant resolves to 0 no matter
  // what this says (see apps/api/src/ai/ai-availability.ts). Revisit the
  // number when pricing decides what a prompt is worth.
  CLERQUE: {
    maxBranches: UNCAPPED_BRANCHES,
    maxAiPerMonth: 1_000,
    apiRatePerHour: 5_000,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAN_FEATURES — cross-cutting features. NOT vertical-specific (verticals like
// Laundry, F&B, Construction are POS-module features available at every plan
// that includes POS).
// ─────────────────────────────────────────────────────────────────────────────

export type ApiAccessLevel = 'none' | 'read' | 'readwrite';

/**
 * Six flags were removed alongside the ladder — crossModuleReports, aiAddons,
 * whitelabel, customDomain, customRoles and fifoValuation. Each was defined
 * and populated for all 11 plans but read by no guard, no service and no UI.
 * (FIFO is really controlled by Tenant.valuationMethod, which is untouched.)
 * Every field below is load-bearing: it has at least one live reader.
 */
export interface PlanFeatures {
  /** BIR forms (2550Q, 1701Q, 2551Q, EWT, SAWT, 2307, EIS) */
  birForms:           boolean;
  /** UI to browse the centralized audit trail */
  auditLog:           boolean;
  /** External REST API access level */
  apiAccess:          ApiAccessLevel;
  /** Full ledger (double-entry, COA, financial statements, AR/AP, periods,
   *  BIR, bank recon, audit, GL queue). Off = SIMPLE ledger only. */
  advancedAccounting: boolean;
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
  /** Maker-checker authorization on voids/refunds above a tenant-set threshold. */
  makerCheckerVoids:          boolean;
}

export const PLAN_FEATURES: Record<PlanCode, PlanFeatures> = {
  CLERQUE: {
    birForms: true,
    auditLog: true,
    // 'readwrite' is what lets an ecosystem app POST a sale. It previously
    // existed only on the two most expensive plans, which made Clerque
    // unusable as a backend for anything but an enterprise venue.
    apiAccess: 'readwrite',
    advancedAccounting: true,
    maxRecipes: -1,
    maxAdvancedInventoryItems: -1,
    salesLeadDelegation: -1,
    customerPhoneLookup: true,
    receiptCustomization: 'full',
    advancedReports: true,
    loyaltyPro: true,
    autoBackup: true,
    makerCheckerVoids: true,
  },
};

/** Plan-level setup fee in PHP centavos. Display-only — nothing enforces it. */
export const PLAN_SETUP_FEE_PHP_CENTS: Record<PlanCode, number> = {
  CLERQUE: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Safe lookups
//
// Tenant.planCode is an unvalidated TEXT column with a legacy default, and
// rows written before the collapse still carry codes like "SUITE_T2" or the
// long-deleted "STD_TEAM". Everything below resolves those onto the single
// package instead of returning undefined, so no read path can be handed a
// hole. Always prefer these over indexing the tables directly.
// ─────────────────────────────────────────────────────────────────────────────

/** Maps any stored plan string — legacy, unknown, null — onto the package. */
export function normalizePlanCode(raw: string | null | undefined): PlanCode {
  return raw === 'CLERQUE' ? 'CLERQUE' : DEFAULT_PLAN_CODE;
}

export function planCapsFor(raw: string | null | undefined): PlanCap {
  return PLAN_CAPS[normalizePlanCode(raw)];
}

export function planLimitsFor(raw: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[normalizePlanCode(raw)];
}

export function planFeaturesFor(raw: string | null | undefined): PlanFeatures {
  return PLAN_FEATURES[normalizePlanCode(raw)];
}

/**
 * Module combination validity.
 *
 * The package no longer dictates which modules a tenant may run — that was
 * the whole point of retiring the matrix. The one invariant left is that a
 * tenant must have SOMETHING switched on, otherwise every AppAccessGuard
 * check fails and the account is silently dark.
 *
 * Returns an error message, or null when the combination is fine.
 */
export function validateModuleCombo(
  _planCode: PlanCode,
  modulePos: boolean,
  moduleLedger: boolean,
  modulePayroll: boolean,
): string | null {
  if (!modulePos && !moduleLedger && !modulePayroll) {
    return 'At least one module (POS, Ledger or Payroll) must be enabled.';
  }
  return null;
}

/** Returns the user-facing display name for a plan code. */
export function planLabel(code: PlanCode): string {
  return ({
    CLERQUE: 'Clerque',
  } satisfies Record<PlanCode, string>)[code];
}

/**
 * Total seat ceiling for a tenant. Returns the lower of:
 *   (a) baseSeats + staffSeatAddons (what the tenant has actually purchased)
 *   (b) PLAN_CAPS[planCode].maxTotal (the absolute ceiling for the plan)
 */
export function effectiveSeatCeiling(
  planCode: PlanCode | string | null | undefined,
  staffSeatAddons: number,
): number {
  const cap = planCapsFor(planCode);
  const purchased = cap.baseSeats + Math.max(0, staffSeatAddons);
  return Math.min(purchased, cap.maxTotal);
}

/**
 * Whether an app is available to a tenant.
 *
 * Reads the per-tenant module flags ONLY. It used to short-circuit to true
 * for any plan with moduleCount 3, which contradicted AppAccessGuard — that
 * guard has always read the flags alone, so a Suite tenant with modulePos
 * false was "enabled" here and 403'd at the wall. The flags are the single
 * source of truth now.
 */
export function isModuleEnabled(
  _planCode: PlanCode | string | null | undefined,
  modules: { modulePos: boolean; moduleLedger: boolean; modulePayroll: boolean },
  app: ClerqueModule,
): boolean {
  if (app === 'POS')     return modules.modulePos;
  if (app === 'LEDGER')  return modules.moduleLedger;
  return modules.modulePayroll;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan-based permission / persona availability
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanContext {
  planCode:     PlanCode;
  modulePos:    boolean;
  moduleLedger: boolean;
  modulePayroll:boolean;
}

/**
 * Permission → plan-availability check. Returns true when the tenant's
 * modules + features make the permission exercisable. Permissions not listed
 * are universal — gated only by role.
 *
 * NOTE this is a UI affordance, not a security boundary. Despite older
 * comments claiming otherwise, `assertPermission` never calls it; the server
 * enforces via RolesGuard / AppAccessGuard / PlanFeatureGuard.
 */
export function isPermissionAvailableUnderPlan(
  permission: string,
  ctx: PlanContext,
): boolean {
  const f = planFeaturesFor(ctx.planCode);

  switch (permission) {
    // SIMPLE ledger — available whenever the Ledger module is on
    case 'ledger:view':
    case 'ledger:export':
      return ctx.moduleLedger;

    // FULL ledger — requires advancedAccounting. Trial balance and the cash-flow
    // statement are double-entry accounting outputs served by the FULL-gated
    // accounts controller, so they live here (NOT in SIMPLE) to match the API.
    case 'ledger:trial_balance':
    case 'finance:cash_flow':
    case 'ledger:journal_entry':
    case 'ledger:period_close':
    case 'ledger:period_reopen':
    case 'finance:bank_recon':
      return ctx.moduleLedger && f.advancedAccounting;

    // Payroll surface
    case 'payroll:view_salary':
    case 'payroll:edit':
    case 'payroll:run':
    case 'staff:assign_payroll_master':
      return ctx.modulePayroll;

    // Compliance
    case 'audit:view': return f.auditLog;
    case 'bir:view':   return f.birForms;

    default:
      return true; // universal
  }
}

/**
 * Upgrade hint for a permission the tenant's setup cannot exercise. With a
 * single package these are always about a switched-off MODULE, never about
 * buying a higher tier — the old copy named plans that no longer exist
 * ("Upgrade to Duo", "Pair T3").
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
      return 'Enable the Ledger module for this business.';
    case 'payroll:view_salary':
    case 'payroll:edit':
    case 'payroll:run':
    case 'staff:assign_payroll_master':
      return 'Enable the Payroll module for this business.';
    default:
      return null;
  }
}
