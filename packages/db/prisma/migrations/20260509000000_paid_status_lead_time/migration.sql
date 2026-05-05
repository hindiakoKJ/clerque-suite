-- Sprint 7 — PAID status + lead-time tracking on Order.
--
-- New status:
--   PAID — payment received, items still in production at bar/kitchen.
--          Transitions to COMPLETED automatically when KDS marks the last
--          prep item as READY. Lead time KPI = readyAt - paidAt.
--
-- New columns:
--   paidAt   — when payment was received (= completedAt for legacy rows)
--   readyAt  — when the LAST prep item was bumped to READY by KDS
--              (= paidAt for orders with no prep items / no station routing)
--
-- Idempotent — IF NOT EXISTS guards make re-runs safe.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PAID';

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paidAt"  TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3);

-- Backfill: legacy COMPLETED rows didn't track paidAt/readyAt separately.
-- Treat them as instant production: paidAt = readyAt = completedAt.
-- Idempotent: only fills NULLs.
UPDATE "orders"
   SET "paidAt"  = "completedAt"
 WHERE "paidAt"  IS NULL
   AND "completedAt" IS NOT NULL;

UPDATE "orders"
   SET "readyAt" = "completedAt"
 WHERE "readyAt" IS NULL
   AND "completedAt" IS NOT NULL;
