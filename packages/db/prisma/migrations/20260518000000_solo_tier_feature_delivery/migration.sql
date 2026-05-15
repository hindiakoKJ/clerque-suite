-- Sprint 25 — Solo tier feature delivery
-- ──────────────────────────────────────────────────────────────────
-- Foundation schema for batch inventory (FEFO + expiry), purchase orders,
-- API keys, maker-checker voids, and Solo Pro auto-backup.
-- Service-layer rollout in subsequent commits.

-- ─── Enums ────────────────────────────────────────────────────────

CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED');
CREATE TYPE "VoidApprovalStatus"  AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- ─── RawMaterialLot: FEFO support ─────────────────────────────────

ALTER TABLE "raw_material_lots" ADD COLUMN "expirationDate"      TIMESTAMP(3);
ALTER TABLE "raw_material_lots" ADD COLUMN "purchaseOrderItemId" TEXT;

CREATE INDEX "raw_material_lots_rawMaterialId_branchId_expirationDate_receivedAt_idx"
  ON "raw_material_lots"("rawMaterialId", "branchId", "expirationDate", "receivedAt");
CREATE INDEX "raw_material_lots_tenantId_expirationDate_idx"
  ON "raw_material_lots"("tenantId", "expirationDate");

-- ─── RawMaterial: lotsTracked flag ────────────────────────────────

ALTER TABLE "raw_materials" ADD COLUMN "lotsTracked" BOOLEAN NOT NULL DEFAULT false;

-- ─── InventoryItem: lotsTracked + new lots ────────────────────────

ALTER TABLE "inventory_items" ADD COLUMN "lotsTracked" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "inventory_lots" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "inventoryItemId"     TEXT NOT NULL,
  "qtyReceived"         DECIMAL(12,4) NOT NULL,
  "qtyRemaining"        DECIMAL(12,4) NOT NULL,
  "unitCost"            DECIMAL(12,4) NOT NULL,
  "receivedAt"          TIMESTAMP(3) NOT NULL,
  "expirationDate"      TIMESTAMP(3),
  "referenceNumber"     TEXT,
  "purchaseOrderItemId" TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_lots_inventoryItemId_fkey"
    FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE
);

CREATE INDEX "inventory_lots_inventoryItemId_expirationDate_receivedAt_idx"
  ON "inventory_lots"("inventoryItemId", "expirationDate", "receivedAt");
CREATE INDEX "inventory_lots_tenantId_expirationDate_idx"
  ON "inventory_lots"("tenantId", "expirationDate");

-- ─── PurchaseOrder + PurchaseOrderItem ────────────────────────────

CREATE TABLE "purchase_orders" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "branchId"      TEXT,
  "vendorId"      TEXT,
  "poNumber"      TEXT NOT NULL,
  "orderDate"     TIMESTAMP(3) NOT NULL,
  "expectedAt"    TIMESTAMP(3),
  "status"        "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents"      INTEGER NOT NULL DEFAULT 0,
  "totalCents"    INTEGER NOT NULL DEFAULT 0,
  "notes"         TEXT,
  "createdById"   TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_orders_tenantId_poNumber_key" UNIQUE ("tenantId", "poNumber"),
  CONSTRAINT "purchase_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL
);

CREATE INDEX "purchase_orders_tenantId_status_idx" ON "purchase_orders"("tenantId", "status");
CREATE INDEX "purchase_orders_tenantId_orderDate_idx" ON "purchase_orders"("tenantId", "orderDate");

CREATE TABLE "purchase_order_items" (
  "id"              TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "rawMaterialId"   TEXT,
  "productId"       TEXT,
  "description"     TEXT NOT NULL,
  "qtyOrdered"      DECIMAL(12,4) NOT NULL,
  "qtyReceived"     DECIMAL(12,4) NOT NULL DEFAULT 0,
  "unitCost"        DECIMAL(12,4) NOT NULL,
  "lineTotalCents"  INTEGER NOT NULL,

  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_items_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE
);

CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");

ALTER TABLE "raw_material_lots"
  ADD CONSTRAINT "raw_material_lots_purchaseOrderItemId_fkey"
  FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL;
ALTER TABLE "inventory_lots"
  ADD CONSTRAINT "inventory_lots_purchaseOrderItemId_fkey"
  FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL;

-- ─── ApiKey ───────────────────────────────────────────────────────

CREATE TABLE "api_keys" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "keyPrefix"   TEXT NOT NULL,
  "keyHash"     TEXT NOT NULL,
  "accessLevel" TEXT NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "lastUsedAt"  TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP(3),

  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_keys_keyHash_key" UNIQUE ("keyHash"),
  CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "api_keys_tenantId_isActive_idx" ON "api_keys"("tenantId", "isActive");

-- ─── VoidApproval ─────────────────────────────────────────────────

CREATE TABLE "void_approvals" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "orderId"         TEXT NOT NULL,
  "orderItemId"     TEXT,
  "amountCents"     INTEGER NOT NULL,
  "reason"          TEXT NOT NULL,
  "initiatedById"   TEXT NOT NULL,
  "initiatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"          "VoidApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "approvedById"    TEXT,
  "approvedAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,

  CONSTRAINT "void_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "void_approvals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "void_approvals_tenantId_status_initiatedAt_idx"
  ON "void_approvals"("tenantId", "status", "initiatedAt");
CREATE INDEX "void_approvals_orderId_idx" ON "void_approvals"("orderId");

-- ─── Tenant fields ────────────────────────────────────────────────

ALTER TABLE "tenants" ADD COLUMN "voidApprovalThresholdCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tenants" ADD COLUMN "autoBackupConfigJson"       JSONB NOT NULL DEFAULT '{}'::jsonb;
