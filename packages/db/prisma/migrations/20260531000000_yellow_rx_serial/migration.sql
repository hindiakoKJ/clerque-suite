-- Sprint 19 — DDB Schedule II Yellow Rx serial + dispensing pharmacist link.
--
-- yellowRxSerial: required for DDB_S2 sales (RA 9165 §61 — Yellow DDB Form 1
--   serial captured at till). Nullable since 99% of orders are non-S2.
-- dispensedById: User.id of the pharmacist who PIN-attested at the till.
--   Lets us join back to User to print the dispensing pharmacist's name on
--   the OR alongside their PRC license.

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "yellowRxSerial" TEXT,
  ADD COLUMN IF NOT EXISTS "dispensedById"  TEXT;

CREATE INDEX IF NOT EXISTS "order_items_dispensed_by_idx"
  ON "order_items" ("dispensedById")
  WHERE "dispensedById" IS NOT NULL;
