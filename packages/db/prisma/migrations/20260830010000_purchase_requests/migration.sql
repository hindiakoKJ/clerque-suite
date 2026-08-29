-- Clerque Procure: the shop asking the owner to buy something.
--
-- Deliberately NOT a PurchaseOrder. A PO presumes a vendor, terms and an
-- accrual. An MSME cafe buys at the grocery and on Shopee, pays cash or card,
-- and owes nobody -- forcing a vendor onto that adds a step nobody will do.
--
-- The problem it removes: a shortage is found while someone is already standing
-- in the grocery, so a message goes to the owners and somebody makes a second
-- trip, purely to keep "nothing unavailable on the menu" true.

CREATE TYPE "PurchaseRequestStatus" AS ENUM ('OPEN', 'SENT', 'BOUGHT', 'RECEIVED', 'CANCELLED');

CREATE TABLE "purchase_requests" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "branchId"      TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "status"        "PurchaseRequestStatus" NOT NULL DEFAULT 'OPEN',
    "cutoffAt"      TIMESTAMP(3),
    "sentAt"        TIMESTAMP(3),
    "boughtAt"      TIMESTAMP(3),
    "receivedAt"    TIMESTAMP(3),
    "notes"         TEXT,
    "createdById"   TEXT NOT NULL,
    "sentById"      TEXT,
    "receivedById"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_request_lines" (
    "id"                TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "lineNumber"        TEXT NOT NULL,
    "rawMaterialId"     TEXT NOT NULL,
    "qtyRequested"      DECIMAL(12,4) NOT NULL,
    "shortBy"           DECIMAL(12,4),
    "packsBought"       DECIMAL(12,4),
    "packSize"          DECIMAL(12,4),
    "packCost"          DECIMAL(12,4),
    "brandNote"         TEXT,
    "receivedAt"        TIMESTAMP(3),

    CONSTRAINT "purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- The control number is what stops the same request being bought twice, so it
-- has to be unique per tenant rather than merely conventional.
CREATE UNIQUE INDEX "purchase_requests_tenantId_requestNumber_key"
    ON "purchase_requests"("tenantId", "requestNumber");
CREATE INDEX "purchase_requests_tenantId_status_idx"              ON "purchase_requests"("tenantId", "status");
CREATE INDEX "purchase_requests_tenantId_branchId_createdAt_idx"  ON "purchase_requests"("tenantId", "branchId", "createdAt");

-- One line per ingredient. A second line for the same thing is an edit, not an
-- addition -- otherwise a request asks for the same sugar twice.
CREATE UNIQUE INDEX "purchase_request_lines_purchaseRequestId_rawMaterialId_key"
    ON "purchase_request_lines"("purchaseRequestId", "rawMaterialId");
CREATE INDEX "purchase_request_lines_purchaseRequestId_idx" ON "purchase_request_lines"("purchaseRequestId");
CREATE INDEX "purchase_request_lines_rawMaterialId_idx"     ON "purchase_request_lines"("rawMaterialId");

ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_purchaseRequestId_fkey"
    FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An ingredient still sitting on an open request cannot be deleted out from
-- under it.
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_rawMaterialId_fkey"
    FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- You cannot ask for nothing.
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_qty_positive"
    CHECK ("qtyRequested" > 0);
