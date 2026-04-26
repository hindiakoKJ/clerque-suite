-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'SETTLED', 'RECONCILED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "settlement_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "expectedAmount" DECIMAL(12,2) NOT NULL,
    "actualAmount" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "bankReference" TEXT,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "reconciledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_items" (
    "id" TEXT NOT NULL,
    "settlementBatchId" TEXT NOT NULL,
    "orderPaymentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transactionRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_batches_tenantId_status_idx" ON "settlement_batches"("tenantId", "status");

-- CreateIndex
CREATE INDEX "settlement_batches_tenantId_method_periodStart_idx" ON "settlement_batches"("tenantId", "method", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_items_orderPaymentId_key" ON "settlement_items"("orderPaymentId");

-- CreateIndex
CREATE INDEX "settlement_items_settlementBatchId_idx" ON "settlement_items"("settlementBatchId");

-- CreateIndex
CREATE INDEX "accounting_periods_tenantId_status_idx" ON "accounting_periods"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_tenantId_startDate_key" ON "accounting_periods"("tenantId", "startDate");

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "settlement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_orderPaymentId_fkey" FOREIGN KEY ("orderPaymentId") REFERENCES "order_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
