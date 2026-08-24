-- Recipe deduction pause + per-line deduction marker.
--
-- Both columns are nullable with no default, so this is additive and safe on a
-- live database: existing rows read as "not paused" (tenants) and "no record
-- that ingredients were deducted" (order lines).
--
-- The marker sits on the LINE, not the order, because a single order routinely
-- mixes a latte (recipe entered, deducted) with a slice of cake (no recipe yet,
-- did not). An order-level flag would either lose the cake forever or replay
-- the latte twice.
--
-- Deliberately NOT backfilling. Stamping historical lines as deducted would
-- hide exactly the backlog Recipe Catch-Up exists to replay; stamping them as
-- not-deducted would assert something we cannot know. Null means "unknown,
-- predates the marker", and the catch-up surfaces that cut-off rather than
-- guessing.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "recipeDeductionPausedAt" TIMESTAMP(3);

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "ingredientsDeductedAt" TIMESTAMP(3);

-- Recipe Catch-Up scans "lines in a window that never deducted". Partial, so
-- the index only carries the rows the scan actually wants.
CREATE INDEX IF NOT EXISTS "order_items_pending_deduction_idx"
  ON "order_items" ("orderId")
  WHERE "ingredientsDeductedAt" IS NULL;
