-- Sprint 19 — Ransomware kill switch on Tenant.
-- SUPER_ADMIN can freeze a compromised tenant; all writes 423 Locked.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "readOnlyMode"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "readOnlyReason"  TEXT,
  ADD COLUMN IF NOT EXISTS "readOnlySetAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "readOnlySetById" TEXT;

-- New ConsoleAction enum values for ransomware response audit trail.
DO $$ BEGIN
  ALTER TYPE "ConsoleAction" ADD VALUE IF NOT EXISTS 'CLEAR_ALL_DATA';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "ConsoleAction" ADD VALUE IF NOT EXISTS 'TENANT_FROZEN';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "ConsoleAction" ADD VALUE IF NOT EXISTS 'TENANT_UNFROZEN';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
