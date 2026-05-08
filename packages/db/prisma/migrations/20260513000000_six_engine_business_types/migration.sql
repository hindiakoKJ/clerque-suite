-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-13 — Six-engine vertical structure
--
-- Adds three BusinessType enum values that complete the six-engine model:
--
--   PHARMACY      — Compliance-Engine (Rx tracking, lots, DDB register, expiry)
--   TRUCKING      — Logistics-Engine (trip tickets, liquidation, fleet assets)
--   CONSTRUCTION  — Project-Engine (project P&L, WIP, progress billing)
--
-- These enum slots register the verticals with the platform; their full
-- vertical-specific schema (Prescription, ProductLot, TripTicket, Project,
-- etc.) ships incrementally as each engine's first paying tenant onboards.
-- The VerticalPack registry has stub packs that surface placeholder POS
-- nav and demo seed paths until then.
--
-- Idempotent: ADD VALUE IF NOT EXISTS makes re-running safe across multi-
-- replica deploys and any environment that may have applied via prisma db
-- push first.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'PHARMACY';
ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'TRUCKING';
ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'CONSTRUCTION';
