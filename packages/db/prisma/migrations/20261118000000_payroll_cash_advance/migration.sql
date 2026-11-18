-- CreateEnum
CREATE TYPE "CashAdvanceStatus" AS ENUM ('REQUESTED', 'OPEN', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "cash_advances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CashAdvanceStatus" NOT NULL DEFAULT 'REQUESTED',
    "amount" DECIMAL(12,2) NOT NULL,
    "perPayday" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "requestedById" TEXT,
    "givenById" TEXT,
    "givenAt" TIMESTAMP(3),
    "paidFromCode" TEXT,
    "journalEntryId" TEXT,
    "decidedById" TEXT,
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_advance_deductions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cashAdvanceId" TEXT NOT NULL,
    "payRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_advance_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_advances_tenantId_status_idx" ON "cash_advances"("tenantId", "status");

-- CreateIndex
CREATE INDEX "cash_advances_tenantId_userId_status_idx" ON "cash_advances"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "cash_advance_deductions_tenantId_payRunId_idx" ON "cash_advance_deductions"("tenantId", "payRunId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_advance_deductions_cashAdvanceId_payRunId_key" ON "cash_advance_deductions"("cashAdvanceId", "payRunId");

-- AddForeignKey
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_advance_deductions" ADD CONSTRAINT "cash_advance_deductions_cashAdvanceId_fkey" FOREIGN KEY ("cashAdvanceId") REFERENCES "cash_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_advance_deductions" ADD CONSTRAINT "cash_advance_deductions_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "pay_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

