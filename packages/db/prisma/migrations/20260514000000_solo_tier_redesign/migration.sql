-- Sprint 23 — Solo tier redesign
-- ──────────────────────────────────────────────────────────────────────────
-- Auto-migrates every existing STD_SOLO tenant to the new SOLO_LITE plan.
-- Same price (₱199/mo), same seat cap (1), no surprises — purely a naming
-- normalization so the tenant population is consistent with the new lineup.
--
-- STD_DUO and STD_TEAM are deprecated for new signups but explicitly NOT
-- force-migrated here. Some STD_TEAM tenants have 6-10 active seats that
-- would not fit SOLO_PRO (5-seat cap). Grandfathering them on their current
-- plan at their current price preserves their service. They'll be offered
-- one-click migration to SOLO_STANDARD (for DUO) or STD_BIZ (for over-cap
-- TEAM) in the signup re-flow UI — voluntary, not forced.
--
-- The `planCode` column is a TEXT (not a Postgres enum), so no enum-value
-- additions are needed at the DB level. The new SOLO_* codes are valid
-- strings on insert via the existing schema. This migration is purely
-- a data update.
--
-- Safety:
-- - Idempotent: running twice updates 0 rows the second time.
-- - Reversible: the inverse `UPDATE tenants SET "planCode" = 'STD_SOLO'
--   WHERE "planCode" = 'SOLO_LITE'` restores the prior state if anything
--   goes wrong (the prior plan's caps + features are still defined for
--   backward-compat).

UPDATE "tenants"
SET    "planCode" = 'SOLO_LITE'
WHERE  "planCode" = 'STD_SOLO';
