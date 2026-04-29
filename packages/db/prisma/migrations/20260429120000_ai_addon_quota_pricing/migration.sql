-- Replace the boolean aiEnabledOverride with a quota-based addon system.
--
-- Old: aiEnabledOverride Boolean?  (3-state: null/true/false)
-- New:
--   aiAddonType        AiAddonType?  - which package they bought
--   aiAddonExpiresAt   DateTime?     - subscription validity
--   aiQuotaOverride    Int?          - SUPER_ADMIN-set custom quota
--
-- Plus setupFeePaidAt for the one-time fee tracking.
--
-- Migration is destructive on the override: existing values are NOT preserved
-- (none should exist in production yet — the boolean was added <24h ago and
-- no real tenants have it set). If anyone DID set it, manually re-apply via
-- PATCH /tenant/ai-addon after deploy.

-- 1. New enum
CREATE TYPE "AiAddonType" AS ENUM ('STARTER_50', 'STANDARD_200', 'PRO_500');

-- 2. Drop the boolean override (renamed model — no data migration)
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "aiEnabledOverride";

-- 3. New addon + override fields
ALTER TABLE "tenants" ADD COLUMN "setupFeePaidAt"   TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "aiAddonType"      "AiAddonType";
ALTER TABLE "tenants" ADD COLUMN "aiAddonExpiresAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "aiQuotaOverride"  INTEGER;
