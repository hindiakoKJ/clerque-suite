-- Sprint 19 — Returns / refunds policy. Pharmacy owners specifically asked
-- for this; the till's existing dual-auth (cashier + supervisor PIN) is
-- too permissive for medicine returns where Rx-required products + DDB-
-- controlled drugs need owner-level oversight on every void.
--
-- Default false everywhere; pharmacy tenants get it ON immediately so the
-- policy is in effect from the first day after this migration runs.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "returnsOwnerOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "tenants"
   SET "returnsOwnerOnly" = true
 WHERE "businessType" = 'PHARMACY';
