-- Moving-Average Cost (WAC) on InventoryItem.
-- Recomputed on every positive-qty receipt when unitCost is supplied.
-- Drives COGS posting at sale time, replacing the older snapshot model.

ALTER TABLE "inventory_items" ADD COLUMN "avgCost" DECIMAL(12,4);
