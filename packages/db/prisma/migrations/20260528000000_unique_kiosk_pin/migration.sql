-- Sprint 19 — Kiosk PIN uniqueness + kiosk-only account flag.
--
-- 1. Add User.kioskOnly flag (default false; existing users unaffected).
-- 2. CLEAR all existing kioskPin values. Reason: previously they were
--    bcrypt-hashed at write time (users.service.ts), which broke kiosk
--    authentication entirely (lookup compared raw PIN to hash) AND
--    defeated uniqueness (every bcrypt hash is salted, so the same PIN
--    produces different hashes). Switching to plaintext storage so the
--    kiosk can actually authenticate. Owners re-issue PINs from the
--    Staff edit modal as employees enroll — nothing is in production
--    use yet (the kiosk shipped today).
-- 3. Enforce one (tenantId, kioskPin) pair per tenant via PARTIAL unique
--    index. Postgres ignores NULL rows, so users without a PIN don't
--    compete.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "kioskOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "kioskPin" = NULL WHERE "kioskPin" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_kiosk_pin_unique"
  ON "users" ("tenantId", "kioskPin")
  WHERE "kioskPin" IS NOT NULL;
