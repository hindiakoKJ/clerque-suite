/**
 * AI add-on packages and quota resolution.
 *
 * This file used to be the legacy TIER_1..TIER_6 pricing model, kept alive
 * only because the AI helpers still hung off it — a migration its own header
 * described as "queued". That is now done: the included AI quota comes from
 * `PLAN_LIMITS[plan].maxAiPerMonth`, and the tier ladder is gone.
 *
 * Deleted with the ladder, all of which had zero call sites:
 *   TIER_PRICING, GROWTH_LEVERS, TIER_AI_INCLUDED,
 *   AI_ADDON_ELIGIBLE_TIERS, canBuyAiAddon
 *
 * Why the migration mattered: the ENFORCED quota was computed from
 * `Tenant.tier` while the subscription screen displayed
 * `PLAN_LIMITS.maxAiPerMonth`. The two could disagree outright — the local
 * demo tenant sits on a plan advertising 200 prompts with an enforced quota
 * of 0, because its `tier` column says TIER_1. There is now one number.
 *
 * All amounts are in PHP. The system is single-currency for now (FX is
 * stubbed in JournalLine but not engaged).
 */

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

/* ─── AI quota resolution ───────────────────────────────────────────── */

export interface AiQuotaResolution {
  /** Total monthly prompts allowed. */
  monthlyQuota:     number;
  /** Where the quota came from — for the subscription page badge. */
  source:
    | 'plan_locked'   // plan includes no AI and no addon — quota = 0
    | 'plan_included' // plan-bundled quota only
    | 'addon_only'    // addon quota on a plan that bundles none
    | 'plan+addon'    // both stack
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
 *   2. plan-included + valid addon — sum
 *
 * `planIncluded` is `PLAN_LIMITS[plan].maxAiPerMonth`. It is passed in rather
 * than looked up here so this module stays free of a plans.ts import.
 *
 * An addon is considered active iff aiAddonExpiresAt is in the future
 * (or null, meaning legacy / lifetime — we don't issue these but accept them).
 */
export function getAiQuotaForTenant(
  planIncluded:      number,
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

  const included = Math.max(0, planIncluded ?? 0);

  const addonValid =
    addonType != null &&
    (addonExpiresAt == null || addonExpiresAt > new Date());

  const addonQuota = addonValid && addonType
    ? AI_ADDONS[addonType].promptsIncluded
    : 0;

  const monthlyQuota = included + addonQuota;

  let source: AiQuotaResolution['source'];
  if (monthlyQuota === 0)                    source = 'plan_locked';
  else if (included > 0 && addonQuota > 0)   source = 'plan+addon';
  else if (addonQuota > 0)                   source = 'addon_only';
  else                                       source = 'plan_included';

  return {
    monthlyQuota,
    source,
    enabled:     monthlyQuota > 0,
    activeAddon: addonValid ? (addonType ?? null) : null,
  };
}
