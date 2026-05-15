-- Sprint 25 Phase 2C — Loyalty Pro (Solo Pro)
-- Adds the new digital stamp-program tables that power the QR-based
-- buy-N-get-1-free loyalty mechanic gated by the loyaltyPro feature flag.

-- CreateTable
CREATE TABLE "stamp_programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stampsRequired" INTEGER NOT NULL,
    "rewardProductId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stamp_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_stamps" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "stampsEarned" INTEGER NOT NULL DEFAULT 0,
    "lastEarnedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "customer_stamps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stamp_programs_tenantId_isActive_idx" ON "stamp_programs"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "customer_stamps_tenantId_customerId_idx" ON "customer_stamps"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_stamps_customerId_programId_key" ON "customer_stamps"("customerId", "programId");

-- AddForeignKey
ALTER TABLE "stamp_programs" ADD CONSTRAINT "stamp_programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_stamps" ADD CONSTRAINT "customer_stamps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_stamps" ADD CONSTRAINT "customer_stamps_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_stamps" ADD CONSTRAINT "customer_stamps_programId_fkey" FOREIGN KEY ("programId") REFERENCES "stamp_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
