-- Receiving drafts: a supplier delivery an API key read from the owner's
-- invoice photo (POST /api/v1/service/inventory/drafts/receiving), held until
-- a person confirms it in Clerque. Nothing moves while a row is DRAFT;
-- confirming receives each line through the existing receiving logic.
--
-- Written by `prisma migrate diff --from-schema-datamodel <previous schema>
-- --to-schema-datamodel packages/db/prisma/schema.prisma --script`, offline;
-- never run against a database from a session. A new table only: no
-- existing row is touched. Applies after 20261111000000_service_api_scopes.

-- CreateTable
CREATE TABLE "receiving_drafts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "supplierName" TEXT NOT NULL,
    "supplierTin" TEXT,
    "vendorId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "vatable" BOOLEAN NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "purchaseOrderId" TEXT,
    "lines" JSONB NOT NULL,
    "evidenceFile" TEXT,
    "evidenceSha256" TEXT,
    "createdByApiKeyId" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receiving_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receiving_drafts_tenantId_status_idx" ON "receiving_drafts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "receiving_drafts_tenantId_invoiceNumber_idx" ON "receiving_drafts"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "receiving_drafts_tenantId_reference_key" ON "receiving_drafts"("tenantId", "reference");

-- AddForeignKey
ALTER TABLE "receiving_drafts" ADD CONSTRAINT "receiving_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_drafts" ADD CONSTRAINT "receiving_drafts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

