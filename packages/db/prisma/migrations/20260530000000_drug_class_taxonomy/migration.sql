-- Sprint 19 — Philippine drug-classification taxonomy (12 categories).
--
-- Replaces the implicit two-boolean state (isRxRequired, isControlledDrug)
-- with an explicit DrugClass enum on Product. The booleans become derived
-- values written by ProductsService — kept for backward-compat with queries
-- that filter on them (the OrdersService Rx guard from commit 2d30c97 reads
-- isRxRequired directly; rather than rename N call sites, we project the
-- boolean from the enum and keep the existing logic intact).
--
-- Backfill mapping (conservative — owner can re-classify upward later):
--   isRxRequired=false, isControlledDrug=false  →  OTC
--   isRxRequired=true,  isControlledDrug=false  →  RX_ONLY
--   isRxRequired=true,  isControlledDrug=true   →  DDB_S4 (most common — benzodiazepines)
--   isRxRequired=false, isControlledDrug=true   →  RX_ONLY (inconsistent input → safe upgrade)

CREATE TYPE "DrugClass" AS ENUM (
  'OTC', 'OTC_BTC', 'RX_ONLY',
  'DDB_S2', 'DDB_S3', 'DDB_S4', 'DDB_S5',
  'VACCINE', 'DEVICE', 'SUPPLEMENT', 'COSMETIC', 'OTHER'
);

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "drugClass" "DrugClass" NOT NULL DEFAULT 'OTC';

UPDATE "products"
   SET "drugClass" = CASE
     WHEN "isRxRequired" = true  AND "isControlledDrug" = true  THEN 'DDB_S4'::"DrugClass"
     WHEN "isRxRequired" = true  AND "isControlledDrug" = false THEN 'RX_ONLY'::"DrugClass"
     WHEN "isRxRequired" = false AND "isControlledDrug" = true  THEN 'RX_ONLY'::"DrugClass"
     ELSE 'OTC'::"DrugClass"
   END;
