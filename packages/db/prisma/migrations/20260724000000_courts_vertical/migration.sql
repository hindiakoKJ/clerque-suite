-- Courts / sports-facility vertical: per-line revenue routing, equipment
-- rentals with deposits, and the CourtSide ingest idempotency inbox.
--
-- Fully additive and backfill-free:
--   • categories.revenueAccountCode is nullable — every existing category
--     reads NULL, which the SALE handler treats as "the default POS revenue
--     account (4010)", i.e. exactly today's behaviour.
--   • the four new tables are brand new; no data to migrate.

-- CreateEnum
CREATE TYPE "RentableItemStatus" AS ENUM ('AVAILABLE', 'RENTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "EquipmentRentalStatus" AS ENUM ('OUT', 'RETURNED', 'OVERDUE', 'LOST');

-- AlterTable
-- The routing key: which income account a category's sales credit. NULL = 4010.
ALTER TABLE "categories" ADD COLUMN "revenueAccountCode" TEXT;

-- CreateTable
CREATE TABLE "rentable_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "assetTag" TEXT,
    "rentFeeCentavos" INTEGER NOT NULL DEFAULT 0,
    "depositCentavos" INTEGER NOT NULL DEFAULT 0,
    "status" "RentableItemStatus" NOT NULL DEFAULT 'AVAILABLE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rentable_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "rentalNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerMobile" TEXT,
    "customerId" TEXT,
    "status" "EquipmentRentalStatus" NOT NULL DEFAULT 'OUT',
    "rentFeeCentavos" INTEGER NOT NULL DEFAULT 0,
    "depositHeldCentavos" INTEGER NOT NULL DEFAULT 0,
    "depositRefundedCentavos" INTEGER NOT NULL DEFAULT 0,
    "depositForfeitedCentavos" INTEGER NOT NULL DEFAULT 0,
    "timeOut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeIn" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_lines" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "rentFeeCentavos" INTEGER NOT NULL DEFAULT 0,
    "depositCentavos" INTEGER NOT NULL DEFAULT 0,
    "returned" BOOLEAN NOT NULL DEFAULT false,
    "forfeited" BOOLEAN NOT NULL DEFAULT false,
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "rental_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resultOrderId" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rentable_items_tenantId_status_idx" ON "rentable_items"("tenantId", "status");
CREATE INDEX "rentable_items_tenantId_isActive_idx" ON "rentable_items"("tenantId", "isActive");
CREATE INDEX "rental_transactions_tenantId_status_idx" ON "rental_transactions"("tenantId", "status");
CREATE INDEX "rental_transactions_tenantId_customerMobile_idx" ON "rental_transactions"("tenantId", "customerMobile");
CREATE UNIQUE INDEX "rental_transactions_tenantId_rentalNumber_key" ON "rental_transactions"("tenantId", "rentalNumber");
CREATE INDEX "rental_lines_rentalId_idx" ON "rental_lines"("rentalId");
CREATE INDEX "rental_lines_itemId_idx" ON "rental_lines"("itemId");
-- Idempotency: one row per (tenant, sender key). A CourtSide re-delivery of
-- the same sale:/refund: key collides here and is served from the inbox.
CREATE UNIQUE INDEX "ingest_receipts_tenantId_idempotencyKey_key" ON "ingest_receipts"("tenantId", "idempotencyKey");
CREATE INDEX "ingest_receipts_tenantId_source_createdAt_idx" ON "ingest_receipts"("tenantId", "source", "createdAt");

-- AddForeignKey
ALTER TABLE "rentable_items" ADD CONSTRAINT "rentable_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rental_transactions" ADD CONSTRAINT "rental_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rental_lines" ADD CONSTRAINT "rental_lines_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rental_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT: a rentable item that has ever been on a rental cannot be hard-deleted
-- (retire it with status RETIRED instead) — preserves the rental history.
ALTER TABLE "rental_lines" ADD CONSTRAINT "rental_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "rentable_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ingest_receipts" ADD CONSTRAINT "ingest_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
