-- Tenant.aiEnabledOverride: per-tenant override of the tier-based AI feature flag.
-- NULL = inherit from tier (TIER_5+ get AI by default).
-- TRUE = force AI on (sales-led perk for a lower-tier tenant).
-- FALSE = force AI off (tenant opted out, billing pause, etc.).

ALTER TABLE "tenants" ADD COLUMN "aiEnabledOverride" BOOLEAN;
