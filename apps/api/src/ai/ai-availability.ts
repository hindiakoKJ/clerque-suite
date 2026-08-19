/**
 * The AI master switch.
 *
 * AI is OFF right now. It is meant to come back, so this is a switch rather
 * than a deletion: nothing about the AI features has been removed, and
 * flipping one environment variable restores them exactly as they were.
 *
 * ── Turning AI back on ────────────────────────────────────────────────────
 *   Set  AI_FEATURES_ENABLED=true  on the API service and restart.
 *   (Railway → the API service → Variables. No deploy, no code change.)
 *
 * Anything other than the literal string "true" leaves AI off, and an unset
 * variable leaves it off — so a fresh environment, a typo, or a missing
 * config all fail closed rather than quietly opening a paid provider.
 *
 * ── Where it is enforced ──────────────────────────────────────────────────
 * Three layers, deepest first. The depth is deliberate: the outer layers give
 * users a clean answer, the inner one is what actually prevents spend.
 *
 *   1. `AiService.call()` — refuses before any request reaches Anthropic.
 *      Catches any caller that bypasses the HTTP layer entirely: a scheduler,
 *      an internal service, or a future route added without the guard.
 *   2. `AiQuotaGuard`     — every /ai/* route 403s with code AI_DISABLED,
 *      checked AHEAD of the platform-admin bypass so support cannot spend
 *      either.
 *   3. `resolveAiQuota()` — the JWT is minted with aiQuotaMonthly 0, so the
 *      web and Counter UIs hide their AI affordances instead of showing
 *      buttons that fail. Both already gate on `aiQuotaMonthly > 0`, so no
 *      frontend change was needed and none can drift out of sync.
 *
 * Assigning an AI add-on is blocked too (see TenantService.setAiAddon) —
 * otherwise a tenant could be sold something inert.
 *
 * ── Why this is not in shared-types ───────────────────────────────────────
 * shared-types is bundled into the browser, where `process.env` is inlined at
 * build time and cannot be re-read. Keeping the switch server-side means one
 * runtime source of truth that the frontend inherits through the JWT.
 */

import {
  getAiQuotaForTenant,
  type AiAddonType,
  type AiQuotaResolution,
} from '@repo/shared-types';

/** True only when AI has been explicitly switched on for this deployment. */
export function isAiEnabled(): boolean {
  return process.env.AI_FEATURES_ENABLED === 'true';
}

/**
 * The tenant's effective AI quota, master switch included.
 *
 * Use this instead of calling `getAiQuotaForTenant` directly. The switch has
 * to outrank the SUPER_ADMIN override, which otherwise outranks everything —
 * so while AI is off there is no combination of plan, add-on and override
 * that yields a non-zero quota.
 */
export function resolveAiQuota(input: {
  planIncluded:    number;
  addonType?:      AiAddonType | null;
  addonExpiresAt?: Date | null;
  override?:       number | null;
}): AiQuotaResolution {
  if (!isAiEnabled()) {
    return {
      monthlyQuota: 0,
      source:       'kill_switch',
      enabled:      false,
      activeAddon:  null,
    };
  }
  return getAiQuotaForTenant(
    input.planIncluded,
    input.addonType,
    input.addonExpiresAt,
    input.override,
  );
}
