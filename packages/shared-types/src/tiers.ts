/**
 * Subscription Tiers — Staff-Size & App Bundle Definitions
 *
 * Each Clerque tenant is on exactly one tier.  The tier dictates:
 *  - The hard cap on staff count (excluding the BUSINESS_OWNER itself)
 *  - The set of apps included in the bundle
 *  - The set of feature flags pre-enabled at this tier
 *
 * This is the SINGLE SOURCE OF TRUTH for tier behavior.  Both backend
 * (TierQuotaGuard, feature gates) and frontend (onboarding wizard,
 * subscription settings page, upgrade CTAs) read from this file.
 *
 * Specific app→tier and feature→tier content is intentionally LOOSE for now;
 * see the `includedApps` / `enabledFeatures` arrays.  These are placeholders
 * suggested by the design doc (`tiers.includedApps` defaults reflect the
 * planning conversation but should be revisited when pricing is finalized).
 *
 * Tier IDs follow the existing Prisma SubscriptionTier enum (TIER_1..TIER_5).
 * The 7 staff-size buckets in the design doc collapse onto the 5 tier slots
 * by sharing slots for Tier_2 (covers Owner+1) and Tier_3 (covers Owner+2..3).
 *
 * Naming note: TIER_1..TIER_5 are immutable enum values (don't rename).
 * The user-facing labels live in `displayName` and may change.
 */

import type { AppCode } from './auth';
import { PERMISSION_MATRIX, type PermissionKey } from './permissions';

export type TierId = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6';

/**
 * Tier feature flag keys.  Each flag corresponds to a feature gate that can
 * be checked across the codebase.  These are coarse-grained on purpose —
 * fine-grained per-action gating belongs in `permissions.ts`.
 *
 * Final mapping below (locked 2026-04-28):
 *
 *   T1 Solo:  pos:basic, pos:offline_sync
 *   T2 Duo:   + ar:pos_collections
 *   T3 Trio:  + ledger:read, time_monitoring
 *   T4 Squad: + ledger:full, multi_branch, ar:full, ap:full
 *   T5 Team:  + payroll:full
 *   T6 Multi: + bir:forms, audit:log  (the full compliance package)
 *
 * The `ar:pos_collections` flag enables a new "Outstanding Sales" page
 * inside the POS app — a lite AR view that lists CHARGE-invoice POS orders
 * with an unpaid balance and lets the owner record collections.  This is
 * NOT the same as `ar:full` (which is the full Ledger AR sub-module with
 * customer master, aging buckets, statements).  POS-collections is the
 * Tier 2 entry point for B2B billing; the full module unlocks at Tier 4.
 */
export type TierFeatureFlag =
  | 'pos:basic'             // Sell / shift / receipt — every tier has this
  | 'pos:offline_sync'      // Dexie + bulk sync endpoint
  | 'ar:pos_collections'    // POS-only "Outstanding Sales" page for collecting CHARGE invoices
  | 'ledger:read'           // Dashboard, COA view, Trial Balance (read-only)
  | 'time_monitoring'       // Clock in/out, own attendance, own timesheets
  | 'ledger:full'           // Manual journal entries, period close, settlement, expense approvals
  | 'multi_branch'          // Branch quota > 1
  | 'ar:full'               // Full Ledger AR sub-module: customers, invoices, aging, statements
  | 'ap:full'               // Full Ledger AP sub-module: vendors, bills, WHT 2307, AP aging
  | 'payroll:full'          // Payroll runs, payslips, salary edits, govt contributions
  | 'bir:forms'             // 2550Q, 1701Q, 2551Q, EWT, SAWT, EIS — formal BIR tax filings
  | 'audit:log'             // Centralized audit-log viewer for compliance review
  | 'custom_personas'       // Owner can create custom persona templates (future)
  | 'ai:enabled';           // Drafter, Guide, Smart Picker, Receipt OCR — TIER_5 + TIER_6 by default; per-tenant override possible

/**
 * Per-tier quota and capability bundle.
 */
export interface TierConfig {
  /** Stable enum value — matches Prisma SubscriptionTier.  DO NOT change. */
  id: TierId;

  /** User-facing display name shown on settings/upgrade screens. */
  displayName: string;

  /** Short description shown in tier picker / upgrade modal. */
  tagline: string;

  /**
   * Maximum staff (User records) permitted on this tier, EXCLUDING owner-role
   * accounts (BUSINESS_OWNER, SUPER_ADMIN).  Hard-capped on POST /users.
   *
   * Tier 1 = 0 (owner only), Tier 2 = 1, Tier 3 = 3, Tier 4 = 5, Tier 5 = unlimited (-1).
   */
  maxStaff: number;

  /** Maximum branches.  -1 = unlimited. */
  maxBranches: number;

  /** Maximum cashier seats (concurrent CASHIER role assignments). */
  maxCashierSeats: number;

  /**
   * Apps included in this tier — drives the app selector page.
   *
   * NOTE (deferred): the exact mapping below reflects the planning
   * conversation's suggestion but is NOT locked.  Adjust when pricing
   * is finalized.  Backend feature gates should NOT yet consult these
   * during request handling — wiring this is Phase 9 of the plan.
   */
  includedApps: AppCode[];

  /**
   * Feature flags enabled at this tier.  Like includedApps, this is a
   * preliminary mapping; specific feature→tier wiring is Phase 9.
   */
  enabledFeatures: TierFeatureFlag[];

  /**
   * Optional: which staff-size bucket this tier serves.  Used by the
   * onboarding wizard to recommend a tier based on declared staff count.
   * Inclusive bounds.  staffMax = -1 means "unlimited / 11+".
   */
  staffBucket: { min: number; max: number };
}

export const TIERS: Record<TierId, TierConfig> = {
  // ── T1 Solo ────────────────────────────────────────────────────────────────
  // Single-person operation.  Pure POS — sell, take payment, view dashboard.
  // No B2B billing.  Cash-only retail/service.
  TIER_1: {
    id: 'TIER_1',
    displayName: 'Solo',
    tagline: 'Just you running the show.',
    maxStaff: 0,
    maxBranches: 1,
    maxCashierSeats: 1,
    includedApps: ['POS'],
    enabledFeatures: ['pos:basic', 'pos:offline_sync'],
    staffBucket: { min: 0, max: 0 },
  },

  // ── T2 Duo ─────────────────────────────────────────────────────────────────
  // Owner + one helper.  POS + a new "Outstanding Sales" page that lets the
  // owner track and collect on CHARGE (B2B) invoices created at the till.
  // Still no Ledger app — back-office work happens inside POS.
  TIER_2: {
    id: 'TIER_2',
    displayName: 'Duo',
    tagline: 'You plus a helping hand. Bill B2B and collect later.',
    maxStaff: 1,
    maxBranches: 1,
    maxCashierSeats: 2,
    includedApps: ['POS'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ar:pos_collections',
    ],
    staffBucket: { min: 1, max: 1 },
  },

  // ── T3 Trio ────────────────────────────────────────────────────────────────
  // Small team starting to need basic books.  Ledger app appears in
  // read-only mode (Dashboard, COA view, Trial Balance).  Payroll app
  // appears at clock-only level (employees clock in/out and view their
  // own attendance/timesheets).  No manual journal entries yet — auto-
  // posting via the event queue handles bookkeeping silently.
  TIER_3: {
    id: 'TIER_3',
    displayName: 'Trio',
    tagline: 'A small team that needs eyes on the books and clocked-in hours.',
    maxStaff: 3,
    maxBranches: 1,
    maxCashierSeats: 3,
    includedApps: ['POS', 'LEDGER', 'PAYROLL'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ar:pos_collections',
      'ledger:read',
      'time_monitoring',
    ],
    staffBucket: { min: 2, max: 3 },
  },

  // ── T4 Squad ───────────────────────────────────────────────────────────────
  // Mid-size with full back-office.  Manual journal entries, period
  // close/reopen, settlement reconciliation, employee expense approvals.
  // AR (customer master, aging, statements) and AP (vendor bills, WHT
  // 2307 capture, AP aging) sub-modules unlock.  Multi-branch enabled.
  // STILL NO payroll runs, BIR forms, audit log — the business outsources
  // payroll and BIR filings to a CPA at this stage.
  TIER_4: {
    id: 'TIER_4',
    displayName: 'Squad',
    tagline: 'Mid-size back-office with AR, AP, and multi-branch.',
    maxStaff: 5,
    maxBranches: 2,
    maxCashierSeats: 5,
    includedApps: ['POS', 'LEDGER', 'PAYROLL'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ar:pos_collections',
      'ledger:read',
      'time_monitoring',
      'ledger:full',
      'multi_branch',
      'ar:full',
      'ap:full',
    ],
    staffBucket: { min: 4, max: 5 },
  },

  // ── T5 Team ────────────────────────────────────────────────────────────────
  // Same back-office as T4 but brings payroll in-house.  Payroll runs,
  // payslips, salary edits, govt contributions (SSS, PhilHealth, Pag-IBIG).
  // Still no formal BIR form generation or centralized audit log — those
  // unlock at T6 when the business needs full compliance posture.
  TIER_5: {
    id: 'TIER_5',
    displayName: 'Team',
    tagline: 'Back-office plus payroll and govt contributions in-house.',
    maxStaff: 10,
    maxBranches: 5,
    maxCashierSeats: 10,
    includedApps: ['POS', 'LEDGER', 'PAYROLL'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ar:pos_collections',
      'ledger:read',
      'time_monitoring',
      'ledger:full',
      'multi_branch',
      'ar:full',
      'ap:full',
      'payroll:full',
      'ai:enabled',
    ],
    staffBucket: { min: 6, max: 10 },
  },

  // ── T6 Multi ───────────────────────────────────────────────────────────────
  // Compliance-grade enterprise.  Full BIR form generation (2550Q, 1701Q,
  // 2551Q, EIS).  Centralized audit log for external auditors and CPA
  // review.  Unlimited staff, branches, cashier seats.  Custom personas
  // available for fine-tuned RBAC.
  TIER_6: {
    id: 'TIER_6',
    displayName: 'Multi',
    tagline: 'Full compliance package — BIR forms, audit log, unlimited scale.',
    maxStaff: -1, // unlimited
    maxBranches: -1, // unlimited
    maxCashierSeats: -1, // unlimited
    includedApps: ['POS', 'LEDGER', 'PAYROLL'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ar:pos_collections',
      'ledger:read',
      'time_monitoring',
      'ledger:full',
      'multi_branch',
      'ar:full',
      'ap:full',
      'payroll:full',
      'bir:forms',
      'audit:log',
      'custom_personas',
      'ai:enabled',
    ],
    staffBucket: { min: 11, max: -1 },
  },
};

/**
 * Resolve whether AI features are enabled for a given tenant.
 * Override beats tier:
 *   - override === true  → AI on regardless of tier (sales perk)
 *   - override === false → AI off regardless of tier (opt-out)
 *   - override === null  → inherit from tier (TIER_5 + TIER_6 enabled)
 */
export function isAiEnabledForTenant(
  tier: TierId,
  override: boolean | null | undefined,
): boolean {
  if (override === true)  return true;
  if (override === false) return false;
  return TIERS[tier].enabledFeatures.includes('ai:enabled');
}

/**
 * Recommend a tier based on declared staff count (0..N+).  Used by the
 * onboarding wizard step "How many staff do you have?".
 *
 * Returns the SMALLEST tier whose staffBucket contains the count.
 * Falls back to TIER_6 for very large counts (11+).
 */
export function recommendTierForStaffCount(staffCount: number): TierConfig {
  if (staffCount < 0) staffCount = 0;
  for (const tier of Object.values(TIERS)) {
    const { min, max } = tier.staffBucket;
    if (staffCount >= min && (max === -1 || staffCount <= max)) {
      return tier;
    }
  }
  return TIERS.TIER_6;
}

/**
 * Check whether adding ONE more staff would exceed the tier's cap.
 * Owner-role users are NOT counted.  -1 in maxStaff means unlimited.
 *
 * @param tierId   Current tier of the tenant
 * @param currentStaffCount  Current count of NON-owner staff (BUSINESS_OWNER excluded)
 * @returns true if the (currentStaffCount + 1)th staff would exceed the cap
 */
export function wouldExceedStaffCap(
  tierId: TierId,
  currentStaffCount: number,
): boolean {
  const cap = TIERS[tierId].maxStaff;
  if (cap === -1) return false; // unlimited
  return currentStaffCount + 1 > cap;
}

/**
 * Check whether a tier includes a specific app.
 */
export function tierIncludesApp(tierId: TierId, app: AppCode): boolean {
  return TIERS[tierId].includedApps.includes(app);
}

/**
 * Check whether a tier has a feature flag enabled.
 *
 * NOTE: This helper exists so feature checks can be added incrementally —
 * call sites can start consulting it BEFORE we lock the specific
 * feature→tier mapping (Phase 9 of the plan).  Until then, treat the
 * `enabledFeatures` arrays in TIERS as advisory only.
 */
export function tierHasFeature(
  tierId: TierId,
  flag: TierFeatureFlag,
): boolean {
  return TIERS[tierId].enabledFeatures.includes(flag);
}

/**
 * Returns the next tier "up" from the given one, or null if already at top.
 * Used by the upgrade CTA to know what tier to recommend.
 */
export function nextTier(tierId: TierId): TierConfig | null {
  const order: TierId[] = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5', 'TIER_6'];
  const idx = order.indexOf(tierId);
  if (idx === -1 || idx === order.length - 1) return null;
  return TIERS[order[idx + 1]];
}

/* ─── Permission ↔ Tier-feature bridge (Option 6 — Tier-Bounded Customization) ───
 *
 * Each granular permission (from permissions.ts) may require a tier feature
 * flag to be exercisable.  Permissions NOT listed in PERMISSION_REQUIRES_FEATURE
 * are universally available at all tiers — gated only by the user's role
 * (per PERMISSION_MATRIX) and any custom overrides the owner has toggled.
 *
 * The Staff Edit UI uses these helpers to render each permission in one of
 * four states:
 *   - available + enabled   ☑
 *   - available + disabled  ☐
 *   - tier-locked           🔒 with upgrade hint
 *   - role-locked           🔒 with role hint
 *
 * Backend defense-in-depth: assertPermission() should also call
 * isPermissionAvailableAtTier() so a user who somehow has a permission in
 * their JWT but their tenant downgraded still gets blocked.
 */

/**
 * Permissions that require a specific tier feature flag.
 * If a permission is NOT in this map, it's universally available (every tier).
 */
export const PERMISSION_REQUIRES_FEATURE: Partial<Record<PermissionKey, TierFeatureFlag>> = {
  // ── Ledger read-level (T3+) ───────────────────────────────────────────────
  'ledger:view':                 'ledger:read',
  'ledger:trial_balance':        'ledger:read',
  'ledger:export':               'ledger:read',
  'finance:cash_flow':           'ledger:read',

  // ── Ledger full-level (T4+): manual journal, period mgmt, settlement ──────
  'ledger:journal_entry':        'ledger:full',
  'ledger:period_close':         'ledger:full',
  'ledger:period_reopen':        'ledger:full',
  'finance:bank_recon':          'ledger:full',

  // ── Payroll (T5+) ─────────────────────────────────────────────────────────
  'payroll:view_salary':         'payroll:full',
  'payroll:edit':                'payroll:full',
  'payroll:run':                 'payroll:full',
  // Assigning the PAYROLL_MASTER role requires payroll to exist as a feature
  'staff:assign_payroll_master': 'payroll:full',

  // ── Compliance (T6 only) ──────────────────────────────────────────────────
  'audit:view':                  'audit:log',
  'bir:view':                    'bir:forms',

  // Universal permissions intentionally NOT listed — gated only by role:
  //   product:create, product:edit_*, product:deactivate
  //   order:create, order:void_*, order:apply_discount
  //   inventory:view, inventory:adjust, inventory:set_threshold
  //   staff:view, staff:create, staff:edit, staff:deactivate, staff:reset_password
  //   staff:assign_mdm                  (universal action; role-gated to OWNER)
  //   settings:tax, settings:general
  //   bir:generate_eis                  (per-order EIS export at till — POS basic)
};

/**
 * Check whether a specific permission is exercisable at a given tier.
 * Permissions not in PERMISSION_REQUIRES_FEATURE return true (universal).
 */
export function isPermissionAvailableAtTier(
  permission: PermissionKey,
  tier: TierId,
): boolean {
  const requiredFlag = PERMISSION_REQUIRES_FEATURE[permission];
  if (!requiredFlag) return true;
  return TIERS[tier].enabledFeatures.includes(requiredFlag);
}

/**
 * Return all permissions exercisable at this tier.  Used by the Staff Edit
 * UI to know which checkboxes to show as available vs tier-locked.
 *
 * The result is the SUPERSET — actual exercisability still depends on the
 * user's role (via PERMISSION_MATRIX) and any custom overrides.
 */
export function listAvailablePermissionsAtTier(tier: TierId): PermissionKey[] {
  return (Object.keys(PERMISSION_MATRIX) as PermissionKey[]).filter(
    (p) => isPermissionAvailableAtTier(p, tier),
  );
}

/**
 * Return all permissions that are tier-locked (NOT exercisable) at this tier.
 * Used by the Staff Edit UI to show 🔒 lock icons with upgrade hints.
 */
export function listTierLockedPermissions(tier: TierId): PermissionKey[] {
  return (Object.keys(PERMISSION_MATRIX) as PermissionKey[]).filter(
    (p) => !isPermissionAvailableAtTier(p, tier),
  );
}

/**
 * For a tier-locked permission, return the FEATURE FLAG that locks it.
 * The UI uses this to show "Upgrade to Tier X" hints — caller looks up
 * which tier first includes the flag.
 *
 * Returns null if the permission is universal (never tier-locked).
 */
export function getRequiredFeatureForPermission(
  permission: PermissionKey,
): TierFeatureFlag | null {
  return PERMISSION_REQUIRES_FEATURE[permission] ?? null;
}

/**
 * For a feature flag, return the LOWEST tier that enables it.
 * Used for upgrade-CTA hints: "Upgrade to Tier 4 to unlock Journal Entries".
 *
 * Returns null if no tier in TIERS includes this flag (shouldn't happen
 * for a valid TierFeatureFlag, but defensive for future flags added before
 * being wired into a tier).
 */
export function lowestTierForFeature(
  flag: TierFeatureFlag,
): TierId | null {
  const order: TierId[] = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5', 'TIER_6'];
  for (const id of order) {
    if (TIERS[id].enabledFeatures.includes(flag)) return id;
  }
  return null;
}
