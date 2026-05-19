-- Pre-orders (Bakery custom cakes + advance reservations)
-- Adds a deposit/balance reservation flow on top of Orders.
-- Counter dashboard surfaces "today's pickups"; the production-plan job
-- reads pickupDate to seed tomorrow's bake quantities.

-- 1) Status enum
CREATE TYPE "PreOrderStatus" AS ENUM ('DRAFT', 'DEPOSIT_PAID', 'READY', 'PICKED_UP', 'CANCELLED');

-- 2) Pre-orders header table
CREATE TABLE "pre_orders" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "branchId"           TEXT NOT NULL,
  "customerId"         TEXT,
  "createdById"        TEXT NOT NULL,
  "preOrderNumber"     TEXT NOT NULL,
  "status"             "PreOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "pickupDate"         TIMESTAMP(3) NOT NULL,
  "pickupTime"         VARCHAR(8),
  "inscription"        TEXT,
  "notes"              TEXT,
  "subtotalCents"      INTEGER NOT NULL DEFAULT 0,
  "discountCents"      INTEGER NOT NULL DEFAULT 0,
  "totalCents"         INTEGER NOT NULL DEFAULT 0,
  "depositCents"       INTEGER NOT NULL DEFAULT 0,
  "balanceCents"       INTEGER NOT NULL DEFAULT 0,
  "depositOrderId"     TEXT,
  "balanceOrderId"     TEXT,
  "cancelledAt"        TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pre_orders_pkey" PRIMARY KEY ("id")
);

-- Unique receipt# per tenant
CREATE UNIQUE INDEX "pre_orders_tenantId_preOrderNumber_key"
  ON "pre_orders"("tenantId", "preOrderNumber");

-- 1:1 back-pointers
CREATE UNIQUE INDEX "pre_orders_depositOrderId_key" ON "pre_orders"("depositOrderId");
CREATE UNIQUE INDEX "pre_orders_balanceOrderId_key" ON "pre_orders"("balanceOrderId");

-- Hot query paths
CREATE INDEX "pre_orders_tenantId_branchId_pickupDate_idx"
  ON "pre_orders"("tenantId", "branchId", "pickupDate");
CREATE INDEX "pre_orders_tenantId_status_pickupDate_idx"
  ON "pre_orders"("tenantId", "status", "pickupDate");
CREATE INDEX "pre_orders_customerId_idx" ON "pre_orders"("customerId");

-- Foreign keys
ALTER TABLE "pre_orders"
  ADD CONSTRAINT "pre_orders_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pre_orders"
  ADD CONSTRAINT "pre_orders_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pre_orders"
  ADD CONSTRAINT "pre_orders_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pre_orders"
  ADD CONSTRAINT "pre_orders_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pre_orders"
  ADD CONSTRAINT "pre_orders_depositOrderId_fkey"
  FOREIGN KEY ("depositOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pre_orders"
  ADD CONSTRAINT "pre_orders_balanceOrderId_fkey"
  FOREIGN KEY ("balanceOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Line items
CREATE TABLE "pre_order_items" (
  "id"               TEXT NOT NULL,
  "preOrderId"       TEXT NOT NULL,
  "productId"        TEXT NOT NULL,
  "productName"      TEXT NOT NULL,
  "quantity"         DECIMAL(12, 3) NOT NULL,
  "unitPriceCents"   INTEGER NOT NULL,
  "modifierAddCents" INTEGER NOT NULL DEFAULT 0,
  "lineTotalCents"   INTEGER NOT NULL,
  "notes"            TEXT,
  CONSTRAINT "pre_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pre_order_items_preOrderId_idx" ON "pre_order_items"("preOrderId");

ALTER TABLE "pre_order_items"
  ADD CONSTRAINT "pre_order_items_preOrderId_fkey"
  FOREIGN KEY ("preOrderId") REFERENCES "pre_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pre_order_items"
  ADD CONSTRAINT "pre_order_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Modifier snapshots on line items
CREATE TABLE "pre_order_item_modifiers" (
  "id"               TEXT NOT NULL,
  "preOrderItemId"   TEXT NOT NULL,
  "modifierGroupId"  TEXT NOT NULL,
  "modifierOptionId" TEXT NOT NULL,
  "groupName"        TEXT NOT NULL,
  "optionName"       TEXT NOT NULL,
  "priceAdjustment"  DECIMAL(12, 2) NOT NULL,
  CONSTRAINT "pre_order_item_modifiers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pre_order_item_modifiers_preOrderItemId_idx"
  ON "pre_order_item_modifiers"("preOrderItemId");

ALTER TABLE "pre_order_item_modifiers"
  ADD CONSTRAINT "pre_order_item_modifiers_preOrderItemId_fkey"
  FOREIGN KEY ("preOrderItemId") REFERENCES "pre_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
