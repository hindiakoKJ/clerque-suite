-- Sprint 19 — LaundryOrder payment timing is independent of activity status.
-- Customers may pay at intake (self-service walk-in), at claim time
-- (legacy full-service), or anywhere in between.

DO $$ BEGIN
  CREATE TYPE "LaundryPaymentStatus" AS ENUM ('UNPAID', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "laundry_orders"
  ADD COLUMN IF NOT EXISTS "paymentStatus" "LaundryPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS "paidAt"        TIMESTAMP(3);

-- Backfill: any existing CLAIMED order with an orderId is implicitly PAID
-- (the legacy claim flow always created a POS Order at claim time).
UPDATE "laundry_orders"
   SET "paymentStatus" = 'PAID',
       "paidAt"        = COALESCE("paidAt", "claimedAt")
 WHERE "status"        = 'CLAIMED'
   AND "orderId"       IS NOT NULL
   AND "paymentStatus" = 'UNPAID';
