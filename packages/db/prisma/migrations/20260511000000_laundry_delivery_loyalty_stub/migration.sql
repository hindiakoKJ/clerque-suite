-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-11 — Laundry vertical follow-ups
--
-- Adds:
--   1. Customer.defaultAddress         — pickup/delivery address (vs BIR address)
--   2. Customer.loyaltyVisits          — auto-incremented on every CLAIMED order
--   3. LaundryDeliveryStatus enum      — rider workflow states
--   4. LaundryOrder.isDelivery         — boolean flag
--   5. LaundryOrder.deliveryAddress    — text (auto-fills from Customer.defaultAddress)
--   6. LaundryOrder.deliveryFee        — added to totalAmount on intake
--   7. LaundryOrder.deliveryStatus     — null for walk-in tickets
--   8. LaundryOrder.publicStubToken    — unguessable token for /stub/<token> page
--
-- All additive + nullable. The unique index on publicStubToken is over a brand-new
-- column with no existing rows, so it cannot fail. We capture this as a versioned
-- migration so `prisma db push --accept-data-loss` is not needed at deploy time.
-- ──────────────────────────────────────────────────────────────────────────

-- 1 + 2 — Customer extensions
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "defaultAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "loyaltyVisits"  INTEGER NOT NULL DEFAULT 0;

-- 3 — LaundryDeliveryStatus enum
DO $$ BEGIN
  CREATE TYPE "LaundryDeliveryStatus" AS ENUM (
    'PENDING_PICKUP',
    'OUT_FOR_PICKUP',
    'AT_LAUNDROMAT',
    'OUT_FOR_DELIVERY',
    'DELIVERED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4-8 — LaundryOrder extensions
ALTER TABLE "laundry_orders"
  ADD COLUMN IF NOT EXISTS "isDelivery"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryFee"     DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "deliveryStatus"  "LaundryDeliveryStatus",
  ADD COLUMN IF NOT EXISTS "publicStubToken" TEXT;

-- Unique index on the new token. Skipped with IF NOT EXISTS so re-running is safe.
CREATE UNIQUE INDEX IF NOT EXISTS "laundry_orders_publicStubToken_key"
  ON "laundry_orders"("publicStubToken");
