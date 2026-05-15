-- Sprint 23 cleanup — remove STD_BIZ (single-module, 10-25 seat plan)
-- ──────────────────────────────────────────────────────────────────────────
-- STD_BIZ is being removed from the active plan lineup. Any existing
-- STD_BIZ tenant migrates to PAIR_T3 (25 seats, 2 modules) — same seat
-- ceiling, modest price increase (₱1,899 → ₱2,899), gains a second module
-- the operator can choose to enable.
--
-- PAIR / SUITE / ENTERPRISE plans are PARKED (not removed) — they remain
-- valid plan codes for grandfathered tenants and as targets here.
-- Their tier-level redesign is queued for a follow-up sprint.
--
-- Safety:
-- - Idempotent: no-op on re-run once all tenants are migrated.
-- - If zero STD_BIZ tenants exist (likely in a developing product), this
--   migration affects 0 rows and is harmless.
-- - PAIR_T3 customers get to keep all 25 seats and gain a 2nd module
--   capability (operator chooses POS + Ledger or POS + Payroll on next
--   plan-edit). The price increase is a known trade-off for the simpler
--   tier matrix.
-- - The post-migration tenant.planCode is the only legitimate value
--   for what was STD_BIZ; the TypeScript PlanCode union shrinks in the
--   same commit to enforce this going forward.

UPDATE "tenants"
SET    "planCode" = 'PAIR_T3'
WHERE  "planCode" = 'STD_BIZ';
