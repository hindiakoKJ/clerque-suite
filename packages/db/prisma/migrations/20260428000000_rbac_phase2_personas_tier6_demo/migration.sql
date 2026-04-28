-- RBAC Phase 2: persona templates, custom permissions, SOD overrides,
-- TIER_6, signup source, demo tenant flag.
--
-- All changes are ADDITIVE and NULLABLE (or default-bearing). Existing rows
-- get safe defaults; nothing breaks.

-- 1. New SignupSource enum
CREATE TYPE "SignupSource" AS ENUM ('WEB', 'PLAYSTORE', 'IMPORTED');

-- 2. Extend SubscriptionTier with TIER_6
--    Postgres ALTER TYPE ADD VALUE is non-transactional but additive — safe.
ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'TIER_6';

-- 3. Tenant flags
ALTER TABLE "tenants" ADD COLUMN "isDemoTenant" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "signupSource" "SignupSource" NOT NULL DEFAULT 'WEB';

-- 4. User RBAC fields
ALTER TABLE "users" ADD COLUMN "personaKey" TEXT;
ALTER TABLE "users" ADD COLUMN "customPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN "sodOverrides" JSONB;
