-- Platform foundation, slice 1: Clerque as a headless commerce backend.
--
-- A tenant may now have several writers creating sales: the first-party POS
-- (web + Counter), an ecosystem app calling the API with a service key, and
-- eventually a customer-facing online checkout. These columns let us tell
-- them apart in reports and make external writes retry-safe.
--
-- Fully additive and backfill-free:
--   • "channel" has a DEFAULT, so every existing row reads as 'POS' (true —
--     they were all made in the POS) and Postgres 11+ adds it without a
--     table rewrite.
--   • "externalRef" is NULL on every existing row, and Postgres treats NULLs
--     as distinct in a unique index, so the new constraint cannot collide
--     with historical POS orders.

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('POS', 'API', 'ONLINE');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'POS',
ADD COLUMN     "createdByApiKeyId" TEXT,
ADD COLUMN     "externalRef" TEXT;

-- CreateIndex
-- Key resolution looked up candidates by prefix with no index, so every
-- authenticated API request scanned api_keys and ran a bcrypt compare per
-- candidate row: latency plus a cheap DoS vector.
CREATE INDEX "api_keys_keyPrefix_idx" ON "api_keys"("keyPrefix");

-- CreateIndex
-- Per-app revenue reporting: "sales made by the booking app last month".
CREATE INDEX "orders_tenantId_channel_paidAt_idx" ON "orders"("tenantId", "channel", "paidAt");

-- CreateIndex
-- Retry safety for external writers: replaying the same externalRef must
-- return the original sale, never create a second one.
CREATE UNIQUE INDEX "orders_tenantId_externalRef_key" ON "orders"("tenantId", "externalRef");
