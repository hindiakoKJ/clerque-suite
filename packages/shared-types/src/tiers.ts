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

export type TierId = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5';

/**
 * Tier feature flag keys.  Each flag corresponds to a feature gate that can
 * be checked across the codebase.  These are coarse-grained on purpose —
 * fine-grained per-action gating belongs in `permissions.ts`.
 *
 * Reserved for future use; specific feature mapping is deferred per the plan.
 */
export type TierFeatureFlag =
  | 'pos:basic'             // Sell / shift / receipt — every tier has this
  | 'pos:offline_sync'      // Dexie + bulk sync endpoint
  | 'ledger:read'           // Trial balance, P&L, journal viewing
  | 'ledger:full'           // Manual journal entries, period close, export
  | 'payroll:full'          // Payroll runs, payslips, attendance management
  | 'ar:full'               // Accounts Receivable: customers, invoices, aging
  | 'ap:full'               // Accounts Payable: vendors, bills, payments
  | 'multi_branch'          // Branch quota > 1
  | 'bir:forms'             // 2550Q, 1701Q, 2307, EIS export
  | 'time_monitoring'       // Clock in/out, timesheets
  | 'custom_personas';      // Owner can create custom persona templates (future)

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
  TIER_2: {
    id: 'TIER_2',
    displayName: 'Duo',
    tagline: 'You plus a helping hand.',
    maxStaff: 1,
    maxBranches: 1,
    maxCashierSeats: 2,
    includedApps: ['POS', 'LEDGER'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ledger:read',
    ],
    staffBucket: { min: 1, max: 1 },
  },
  TIER_3: {
    id: 'TIER_3',
    displayName: 'Trio',
    tagline: 'A small team, full ledger.',
    maxStaff: 3,
    maxBranches: 1,
    maxCashierSeats: 3,
    includedApps: ['POS', 'LEDGER'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ledger:read',
      'ledger:full',
      'bir:forms',
    ],
    staffBucket: { min: 2, max: 3 },
  },
  TIER_4: {
    id: 'TIER_4',
    displayName: 'Squad',
    tagline: 'Multi-station with payroll.',
    maxStaff: 5,
    maxBranches: 2,
    maxCashierSeats: 5,
    includedApps: ['POS', 'LEDGER', 'PAYROLL'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ledger:read',
      'ledger:full',
      'payroll:full',
      'time_monitoring',
      'bir:forms',
      'multi_branch',
    ],
    staffBucket: { min: 4, max: 10 },
  },
  TIER_5: {
    id: 'TIER_5',
    displayName: 'Multi',
    tagline: 'Multi-branch, full back-office.',
    maxStaff: -1, // unlimited
    maxBranches: -1, // unlimited
    maxCashierSeats: -1, // unlimited
    includedApps: ['POS', 'LEDGER', 'PAYROLL'],
    enabledFeatures: [
      'pos:basic',
      'pos:offline_sync',
      'ledger:read',
      'ledger:full',
      'payroll:full',
      'time_monitoring',
      'ar:full',
      'ap:full',
      'bir:forms',
      'multi_branch',
    ],
    staffBucket: { min: 11, max: -1 },
  },
};

/**
 * Recommend a tier based on declared staff count (0..N+).  Used by the
 * onboarding wizard step "How many staff do you have?".
 *
 * Returns the SMALLEST tier whose staffBucket contains the count.
 * Falls back to TIER_5 for very large counts.
 */
export function recommendTierForStaffCount(staffCount: number): TierConfig {
  if (staffCount < 0) staffCount = 0;
  for (const tier of Object.values(TIERS)) {
    const { min, max } = tier.staffBucket;
    if (staffCount >= min && (max === -1 || staffCount <= max)) {
      return tier;
    }
  }
  return TIERS.TIER_5;
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
  const order: TierId[] = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5'];
  const idx = order.indexOf(tierId);
  if (idx === -1 || idx === order.length - 1) return null;
  return TIERS[order[idx + 1]];
}
