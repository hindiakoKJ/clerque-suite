-- Sprint 19 — Supplier delivery receiving.
-- Pharmacies receive stock from distributors and need an atomic flow that
-- captures lot + expiry per item → posts to ProductLot + InventoryItem.
-- The optional apBillId link lets the owner manually post the AP bill from
-- /ledger/ap/bills and tie it back; future sprint auto-posts.

CREATE TABLE IF NOT EXISTS "delivery_receipts" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL,
  "branchId"     TEXT NOT NULL,
  "vendorId"     TEXT NOT NULL,
  "drNumber"     TEXT NOT NULL,
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedById" TEXT NOT NULL,
  "notes"        TEXT,
  "apBillId"     TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_receipts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "delivery_receipts_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "delivery_receipts_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_receipts_apBillId_key" ON "delivery_receipts" ("apBillId");
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_receipts_dr_unique"     ON "delivery_receipts" ("tenantId", "vendorId", "drNumber");
CREATE        INDEX IF NOT EXISTS "delivery_receipts_received_idx"  ON "delivery_receipts" ("tenantId", "branchId", "receivedAt");

CREATE TABLE IF NOT EXISTS "delivery_receipt_items" (
  "id"           TEXT PRIMARY KEY,
  "receiptId"    TEXT NOT NULL,
  "productId"    TEXT NOT NULL,
  "lotNumber"    TEXT NOT NULL,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "quantity"     DECIMAL(12, 3) NOT NULL,
  "costPrice"    DECIMAL(12, 2) NOT NULL,
  "productLotId" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_receipt_items_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "delivery_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "delivery_receipt_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "delivery_receipt_items_productLotId_fkey"
    FOREIGN KEY ("productLotId") REFERENCES "product_lots"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_receipt_items_productLotId_key" ON "delivery_receipt_items" ("productLotId");
CREATE        INDEX IF NOT EXISTS "delivery_receipt_items_receipt_idx"      ON "delivery_receipt_items" ("receiptId");
