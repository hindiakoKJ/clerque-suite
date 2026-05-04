-- Sprint 4A: Lot tracking for raw materials (drives FIFO consumption).

CREATE TABLE IF NOT EXISTS "raw_material_lots" (
  "id"              TEXT         NOT NULL,
  "tenantId"        TEXT         NOT NULL,
  "branchId"        TEXT         NOT NULL,
  "rawMaterialId"   TEXT         NOT NULL,
  "qtyReceived"     DECIMAL(12,4) NOT NULL,
  "qtyRemaining"    DECIMAL(12,4) NOT NULL,
  "unitCost"        DECIMAL(12,4) NOT NULL,
  "receivedAt"      TIMESTAMP(3) NOT NULL,
  "referenceNumber" TEXT,
  "paymentMethod"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "raw_material_lots_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "raw_material_lots_rawMaterialId_fkey"
    FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "raw_material_lots_rawMaterialId_branchId_receivedAt_idx"
  ON "raw_material_lots"("rawMaterialId","branchId","receivedAt");
CREATE INDEX IF NOT EXISTS "raw_material_lots_tenantId_idx"
  ON "raw_material_lots"("tenantId");
