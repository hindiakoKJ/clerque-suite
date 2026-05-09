-- Sprint 19 — Employee separation (attrition) tracking.
-- Adds separationType + separationReason to users; idempotent so safe to re-run.

DO $$ BEGIN
  CREATE TYPE "SeparationType" AS ENUM (
    'RESIGNED', 'TERMINATED', 'RETIRED', 'END_OF_CONTRACT', 'ABANDONED', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "separationType"   "SeparationType",
  ADD COLUMN IF NOT EXISTS "separationReason" TEXT;
