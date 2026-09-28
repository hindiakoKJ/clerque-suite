-- What a printed receipt line means to THIS shop: the ingredient tagged and
-- the pack size posted, filed under the product barcode when the receipt
-- prints one ("bc:<barcode>") and under the printed text otherwise
-- ("tx:<normalised text>"). Learned on the receipt screen the first time a
-- person tags a line and posts; read back on every later receipt so the same
-- shelf never needs picking or a "one holds" question again. Per shop: the
-- same barcode is a different ingredient, in a different unit, in another
-- kitchen. A new table only: no existing row is touched.

-- CreateTable
CREATE TABLE "receipt_aliases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "barcode" TEXT,
    "printedKey" TEXT NOT NULL,
    "printedText" TEXT NOT NULL,
    "packSize" DECIMAL(12,4),
    "brandNote" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receipt_aliases_tenantId_printedKey_idx" ON "receipt_aliases"("tenantId", "printedKey");

-- CreateIndex
CREATE INDEX "receipt_aliases_tenantId_barcode_idx" ON "receipt_aliases"("tenantId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_aliases_tenantId_key_key" ON "receipt_aliases"("tenantId", "key");

-- Cascade on purpose: a shop or an ingredient that is deleted takes its memories with it.
-- AddForeignKey
ALTER TABLE "receipt_aliases" ADD CONSTRAINT "receipt_aliases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_aliases" ADD CONSTRAINT "receipt_aliases_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
