-- Sprint 23 cleanup — remove legacy STD_SOLO / STD_DUO / STD_TEAM tiers
-- ──────────────────────────────────────────────────────────────────────────
-- The previous migration (20260514000000_solo_tier_redesign) moved every
-- STD_SOLO tenant to SOLO_LITE. This one finishes the cleanup by migrating
-- any remaining STD_DUO and STD_TEAM tenants to their new-lineup equivalents,
-- so the code can safely remove these plan codes from the PlanCode union.
--
-- Migration rules:
--   STD_DUO   → SOLO_STANDARD   (same price ₱399, same 3-seat cap, more features)
--   STD_TEAM  → SOLO_PRO        (cheaper at ₱499 vs ₱999, but only if seats ≤5)
--   STD_TEAM  → STD_BIZ         (when seats > 5 — preserves user access)
--
-- Safety:
-- - Idempotent: re-runs are no-ops once all tenants have been moved.
-- - STD_TEAM with > 5 seats lands on STD_BIZ (₱2,499) — a price increase, but
--   the alternative is losing user access. The natural alternative is for
--   the owner to reduce active seats THEN switch to SOLO_PRO themselves
--   before this migration runs. In a startup with no STD_TEAM tenants yet,
--   this branch never fires.
-- - The `_count.users` field doesn't exist in raw SQL, so we count via the
--   User table directly.

-- Step 1: Move every STD_DUO tenant to SOLO_STANDARD.
UPDATE "tenants"
SET    "planCode" = 'SOLO_STANDARD'
WHERE  "planCode" = 'STD_DUO';

-- Step 2: Move STD_TEAM tenants with ≤5 active users to SOLO_PRO.
UPDATE "tenants" t
SET    "planCode" = 'SOLO_PRO'
WHERE  t."planCode" = 'STD_TEAM'
  AND  (
    SELECT COUNT(*) FROM "users" u
    WHERE u."tenantId" = t."id" AND u."isActive" = true
  ) <= 5;

-- Step 3: Move STD_TEAM tenants with >5 active users to STD_BIZ.
-- (STD_BIZ is retained — it's the natural single-module upgrade above Solo.)
UPDATE "tenants"
SET    "planCode" = 'STD_BIZ'
WHERE  "planCode" = 'STD_TEAM';

-- Note: no DROP TYPE / ALTER TYPE statements needed because Tenant.planCode
-- is stored as TEXT, not as a Postgres enum. The TypeScript PlanCode union
-- shrinks in this same commit; any new tenant insert with the dropped codes
-- now fails validation at the API layer rather than at the DB layer.
