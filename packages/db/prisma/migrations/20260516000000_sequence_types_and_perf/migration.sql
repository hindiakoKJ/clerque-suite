-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-16 — Race-safe document numbering: extend SequenceType
--
-- Adds 8 new SequenceType values so every per-tenant document number is
-- generated through NumberingService's atomic UPDATE counter pattern,
-- replacing the legacy MAX+1 / count()+1 generators that were vulnerable
-- to concurrent-write races (hidden by DB unique constraints + retry).
--
-- Idempotent: ADD VALUE IF NOT EXISTS makes re-running safe across
-- multi-replica deploys.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TYPE "SequenceType" ADD VALUE IF NOT EXISTS 'POS_ORDER';
ALTER TYPE "SequenceType" ADD VALUE IF NOT EXISTS 'JOURNAL_ENTRY';
ALTER TYPE "SequenceType" ADD VALUE IF NOT EXISTS 'LAUNDRY_CLAIM';
ALTER TYPE "SequenceType" ADD VALUE IF NOT EXISTS 'TRIP_TICKET';
ALTER TYPE "SequenceType" ADD VALUE IF NOT EXISTS 'JOB_ORDER';
ALTER TYPE "SequenceType" ADD VALUE IF NOT EXISTS 'PROGRESS_BILLING';
ALTER TYPE "SequenceType" ADD VALUE IF NOT EXISTS 'MATERIAL_ISSUANCE';
ALTER TYPE "SequenceType" ADD VALUE IF NOT EXISTS 'PROJECT_CODE';
