-- Sprint 19 — PayRun gains LOCKED state (immutable + GL-posted).
-- Idempotent: safe to re-run.

DO $$ BEGIN
  ALTER TYPE "PayRunStatus" ADD VALUE IF NOT EXISTS 'LOCKED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- JournalSource gains 'PAYROLL' so payroll-originated JEs can be filtered.
DO $$ BEGIN
  ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'PAYROLL';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
