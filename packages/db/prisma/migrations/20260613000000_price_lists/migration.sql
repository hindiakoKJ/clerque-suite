-- Wholesale Price Lists
-- A named per-customer pricing override sheet. Counter cart resolves
-- per-line price from the customer's PriceList when one is assigned,
-- otherwise falls back to Product.price.

-- 1) Customer.priceListId column
ALTER TABLE "customers" ADD COLUMN "priceListId" TEXT;

-- 2) Price list header
CREATE TABLE "price_lists" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "notes"     TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_lists_tenantId_name_key" ON "price_lists"("tenantId", "name");
CREATE INDEX "price_lists_tenantId_isActive_idx" ON "price_lists"("tenantId", "isActive");

ALTER TABLE "price_lists"
  ADD CONSTRAINT "price_lists_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Per-product line override
CREATE TABLE "price_list_items" (
  "id"          TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "unitPrice"   DECIMAL(12, 2) NOT NULL,
  "minQuantity" DECIMAL(12, 3),
  CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_list_items_priceListId_productId_key"
  ON "price_list_items"("priceListId", "productId");
CREATE INDEX "price_list_items_priceListId_idx" ON "price_list_items"("priceListId");
CREATE INDEX "price_list_items_productId_idx"  ON "price_list_items"("productId");

ALTER TABLE "price_list_items"
  ADD CONSTRAINT "price_list_items_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "price_list_items"
  ADD CONSTRAINT "price_list_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) FK on Customer.priceListId (added after price_lists table exists)
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
