/**
 * Clerque LEGACY pricing — `TIER_*` system, predates `plans.ts`.
 *
 * ⚠️ DO NOT EXTEND with new TIER_* entries. New plan codes belong in
 *    `plans.ts` (PLAN_CAPS / PLAN_FEATURES / PLAN_LIMITS). This file
 *    survives because the AI-quota helpers (`getAiQuotaForTenant`,
 *    `AI_ADDONS`) are still imported by auth.service + tenant.service.
 *    Migration of the AI helpers onto the plans.ts model is queued for
 *    the Business/Suite tier redesign sprint.
 *
 * What lives here (still actively imported):
 *   - AI_ADDONS, AiAddonType, AiAddonPackage  → tenant.service, auth.service
 *   - getAiQuotaForTenant, AiQuotaResolution  → auth.service (JWT mint)
 *   - canBuyAiAddon, AI_ADDON_ELIGIBLE_TIERS  → tenant.service
 *   - TIER_PRICING, GROWTH_LEVERS             → tenant.service (display)
 *
 * What is canonical in plans.ts (don't shadow these here):
 *   - PlanCode enum + per-plan caps, features, prices, setup fees
 *
 * All amounts are in PHP. The system is single-currency for now (FX is
 * stubbed in JournalLine but not engaged).
 */

import type { TierId } from './tiers';

export interface TierPricing {
  /** One-time fee charged at signup. Covers onboarding, COA seed, training. */
  setupFeePhp:    number;
  /** Monthly recurring fee. */
  monthlyPhp:     number;
  /** Annual prepay price (2 free months — 16% effective discount). */
  annualPhp:      number;
}

/**
 * Tier prices — anchored on TIER_1 ₱2,000 OTF + ₱300/mo per the volume strategy.
 * Setup fees scale ~2x per tier; monthly fees ~1.6-1.8x per tier.
 */
export const TIER_PRICING: Record<TierId, TierPricing> = {
  TIER_1: { setupFeePhp:  2_000, monthlyPhp:   300, annualPhp:  3_000 },
  TIER_2: { setupFeePhp:  3_500, monthlyPhp:   500, annualPhp:  5_000 },
  TIER_3: { setupFeePhp:  5_500, monthlyPhp:   800, annualPhp:  8_000 },
  TIER_4: { setupFeePhp:  8_500, monthlyPhp: 1_400, annualPhp: 14_000 },
  TIER_5: { setupFeePhp: 14_000, monthlyPhp: 2_500, annualPhp: 25_000 },
  TIER_6: { setupFeePhp: 22_000, monthlyPhp: 4_500, annualPhp: 45_000 },
};

/* ─── AI add-on packages ────────────────────────────────────────────── */

export type AiAddonType = 'STARTER_50' | 'STANDARD_200' | 'PRO_500';

export interface AiAddonPackage {
  type:           AiAddonType;
  /** User-facing label for the subscription page. */
  displayName:    string;
  /** Monthly prompt allowance. */
  promptsIncluded: number;
  /** Monthly price in PHP. */
  monthlyPhp:     number;
  /** One-line marketing pitch shown on the upsell CTA. */
  pitch:          string;
}

export const AI_ADDONS: Record<AiAddonType, AiAddonPackage> = {
  STARTER_50: {
    type:            'STARTER_50',
    displayName:     'AI Starter',
    promptsIncluded: 50,
    monthlyPhp:      250,
    pitch:           'Try AI assistance — 50 drafts or checks per month.',
  },
  STANDARD_200: {
    type:            'STANDARD_200',
    displayName:     'AI Standard',
    promptsIncluded: 200,
    monthlyPhp:      600,
    pitch:           'Most popular — 200 prompts/month, ~7 per business day.',
  },
  PRO_500: {
    type:            'PRO_500',
    displayName:     'AI Pro',
    promptsIncluded: 500,
    monthlyPhp:      1_400,
    pitch:           'Heavy usage — 500 prompts/month for daily AI workflows.',
  },
};

/* ─── Growth levers (locked) ────────────────────────────────────────── */

export const GROWTH_LEVERS = {
  /** First 30 days of TIER_1 are free — converts trial users to paid. */
  freeT1Days: 30,
  /** First N customers get setup fee waived (Launch Member badge). */
  launchMemberSetupFeeWaived: 50,
  /** Existing customers get 1 month free per successful referral. */
  referralCreditMonths: 1,
  /** Annual prepay is automatically priced at 10× monthly (= 2 free months). */
  annualMonthsFree: 2,
} as const;

/* ─── AI feature access — derived from tier + addon ─────────────────── */

/**
 * AI prompts a tier includes by default (before any add-on or override).
 * TIER_4 starts at 0 — they must buy the add-on for AI access.
 * TIER_5 includes 200 (covers most owners' usage).
 * TIER_6 includes 500 (covers high-volume bookkeepers).
 */
export const TIER_AI_INCLUDED: Record<TierId, number> = {
  TIER_1: 0,
  TIER_2: 0,
  TIER_3: 0,
  TIER_4: 0,
  TIER_5: 200,
  TIER_6: 500,
};

export interface AiQuotaResolution {
  /** Total monthly prompts allowed. */
  monthlyQuota:     number;
  /** Where the quota came from — for the subscription page badge. */
  source:
    | 'tier_locked'   // tier doesn't include AI and no addon — quota = 0
    | 'tier_included' // tier-bundled quota only
    | 'addon_only'    // addon quota (TIER_4 case)
    | 'tier+addon'    // both stack
    | 'override'      // SUPER_ADMIN override beats both
    | 'kill_switch';  // forced off (override = 0)
  /** True when AI is fully enabled (any non-zero quota or override). */
  enabled:          boolean;
  /** Active addon if any — null when expired or never purchased. */
  activeAddon:      AiAddonType | null;
}

/**
 * Single source of truth for whether a tenant gets AI access this month.
 *
 * Resolution order:
 *   1. override (SUPER_ADMIN-set)  — always wins; 0 = kill switch
 *   2. tier-included + valid addon — sum
 *
 * An addon is considered active iff aiAddonExpiresAt is in the future
 * (or null, meaning legacy / lifetime — we don't issue these but accept them).
 */
export function getAiQuotaForTenant(
  tier:              TierId,
  addonType:         AiAddonType | null | undefined,
  addonExpiresAt:    Date | null | undefined,
  override:          number | null | undefined,
): AiQuotaResolution {
  // Override beats everything.
  if (typeof override === 'number') {
    return {
      monthlyQuota: Math.max(0, override),
      source:       override === 0 ? 'kill_switch' : 'override',
      enabled:      override > 0,
      activeAddon:  null,
    };
  }

  const tierIncluded = TIER_AI_INCLUDED[tier] ?? 0;

  const addonValid =
    addonType != null &&
    (addonExpiresAt == null || addonExpiresAt > new Date());

  const addonQuota = addonValid && addonType
    ? AI_ADDONS[addonType].promptsIncluded
    : 0;

  const monthlyQuota = tierIncluded + addonQuota;

  let source: AiQuotaResolution['source'];
  if (monthlyQuota === 0)         source = 'tier_locked';
  else if (tierIncluded > 0 && addonQuota > 0) source = 'tier+addon';
  else if (addonQuota > 0)        source = 'addon_only';
  else                            source = 'tier_included';

  return {
    monthlyQuota,
    source,
    enabled:     monthlyQuota > 0,
    activeAddon: addonValid ? (addonType ?? null) : null,
  };
}

/**
 * Tiers that are eligible to BUY the AI add-on. TIER_1-TIER_3 don't have
 * journal-entry write access, so the AI Drafter / Guide aren't useful.
 * (Receipt OCR and Smart Picker are tied to JE editing too.)
 */
export const AI_ADDON_ELIGIBLE_TIERS: TierId[] = ['TIER_4', 'TIER_5', 'TIER_6'];

export function canBuyAiAddon(tier: TierId): boolean {
  return AI_ADDON_ELIGIBLE_TIERS.includes(tier);
}
