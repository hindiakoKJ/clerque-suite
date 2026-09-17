-- Daily saved stock balance per branch and item (the daily sheet's Beginning).
--
-- Written by the end-of-day job once per branch per business day, at the same
-- moment the usage message is due. Every row of one save shares takenAt, the
-- moment the stock was read. A new table only: no existing row needs touching.
CREATE TABLE "stock_day_balances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "endingQty" DECIMAL(12,4) NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_day_balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_day_balances_branchId_rawMaterialId_day_key" ON "stock_day_balances"("branchId", "rawMaterialId", "day");
CREATE INDEX "stock_day_balances_tenantId_branchId_day_idx" ON "stock_day_balances"("tenantId", "branchId", "day");
-- Cascade on purpose: a backup restore or demo reset deletes raw materials, and the history resets with them.
ALTER TABLE "stock_day_balances" ADD CONSTRAINT "stock_day_balances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_day_balances" ADD CONSTRAINT "stock_day_balances_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
