-- Ingredients are used when the kitchen or bar marks a line ready.
--
-- The owner's rule: a recipe item waiting at a station with a screen takes its
-- ingredients off stock, and its cost of goods into the books, when it is
-- marked ready -- not when it is rung up. Every line written before this
-- migration was used at the sale, which is exactly what usageOnReady = false
-- says, so no row needs touching.

-- A correction to cost of goods already booked: usage given back when a ticket
-- is un-bumped, or a made item voided or refunded booked as waste.
ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'COGS_ADJUSTMENT';

ALTER TABLE "order_items"
  ADD COLUMN "usageOnReady"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "usagePostedAt" TIMESTAMP(3),
  ADD COLUMN "readyById"     TEXT;

-- The hold is read on every till refresh: find the lines still waiting fast.
CREATE INDEX "order_items_usageOnReady_usagePostedAt_idx" ON "order_items"("usageOnReady", "usagePostedAt");

-- Voids, refunds and un-bumps look up an order's cost-of-goods entries.
CREATE INDEX "accounting_events_orderId_type_idx" ON "accounting_events"("orderId", "type");
