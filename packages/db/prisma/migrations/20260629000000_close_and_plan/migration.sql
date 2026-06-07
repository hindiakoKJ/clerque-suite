-- Sprint 26 — Close & Plan flow for MSME bakery pilots.
--
-- Adds the data fields the evening-routine UI needs:
--   - StickerTier enum + RawMaterialLot.stickerTier
--   - RawMaterialLot.dupeOverride (audit when owner overrides a
--     duplicate-detection warning)
--   - RawMaterialLot.stickerLastPrintedAt (drives "needs reprint" banner)

CREATE TYPE "StickerTier" AS ENUM ('USE_FIRST', 'EXPIRING_SOON', 'EXPIRED', 'NORMAL');

ALTER TABLE "raw_material_lots"
  ADD COLUMN "stickerTier" "StickerTier" DEFAULT 'NORMAL',
  ADD COLUMN "dupeOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stickerLastPrintedAt" TIMESTAMP(3);

-- Index for duplicate detection — recent receives per item per branch.
CREATE INDEX "raw_material_lots_tenant_branch_raw_received_idx"
  ON "raw_material_lots" ("tenantId", "branchId", "rawMaterialId", "receivedAt");

-- Backfill existing rows to NORMAL (default already handles new rows;
-- this is for clarity). The daily cron will reassess all ACTIVE lots
-- on its first run after deploy.
UPDATE "raw_material_lots"
  SET "stickerTier" = 'NORMAL'
  WHERE "stickerTier" IS NULL;
