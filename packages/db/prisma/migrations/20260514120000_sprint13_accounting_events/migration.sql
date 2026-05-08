-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-14 — Sprint 13 Step A: vertical-engine AccountingEvent types
--
-- Declares four new event types so vertical services (Trucking,
-- Construction) can queue PENDING accounting events. The JE handlers in
-- journal.service.processEvent are NOT yet implemented for these types —
-- the cron's default `else` branch will mark them SYNCED with skipped:true
-- (same pattern as MATERIAL_ISSUANCE today). Step B ships the handlers
-- alongside extended journal.accounting.spec.ts coverage.
--
-- Event payloads carry the full context so the future handler does not
-- need to re-read source rows:
--
--   TRIP_CASH_ADVANCE    { tripId, tripNumber, driverId, branchId, amount, issuedAt }
--   TRIP_LIQUIDATION     { tripId, tripNumber, driverId, branchId,
--                          cashAdvance, receiptsTotal, variance,
--                          categoryBreakdown, liquidatedAt, liquidatedById }
--   PROGRESS_BILLING     { billingId, billingNumber, projectId,
--                          grossAmount, retentionAmount, netAmount,
--                          stageDescription, percentComplete, issuedAt }
--   RETENTION_RELEASE    { releaseId, progressBillingId, billingNumber,
--                          projectId, releasedAmount, releaseMethod, releasedAt }
--
-- Idempotent: ADD VALUE IF NOT EXISTS makes re-running safe.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'TRIP_CASH_ADVANCE';
ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'TRIP_LIQUIDATION';
ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'PROGRESS_BILLING';
ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'RETENTION_RELEASE';
