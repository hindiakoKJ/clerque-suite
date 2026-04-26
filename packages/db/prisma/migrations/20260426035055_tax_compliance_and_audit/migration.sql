/*
  Warnings:

  - A unique constraint covering the columns `[reversalOfId]` on the table `journal_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AccountingMethod" AS ENUM ('CASH', 'ACCRUAL');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('VAT_12', 'VAT_EXEMPT', 'ZERO_RATED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('CASH_SALE', 'CHARGE');

-- CreateEnum
CREATE TYPE "TaxStatus" AS ENUM ('VAT', 'NON_VAT', 'UNREGISTERED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('TAX_STATUS_CHANGED', 'TIN_UPDATED', 'PRICE_ADJUSTED', 'DISCOUNT_APPLIED', 'VOID_PROCESSED', 'SETTING_CHANGED');

-- CreateEnum
CREATE TYPE "PostingControl" AS ENUM ('OPEN', 'AP_ONLY', 'AR_ONLY', 'SYSTEM_ONLY');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'SYSTEM', 'AP', 'AR');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'SALES_LEAD';
ALTER TYPE "UserRole" ADD VALUE 'AR_ACCOUNTANT';
ALTER TYPE "UserRole" ADD VALUE 'AP_ACCOUNTANT';
ALTER TYPE "UserRole" ADD VALUE 'MDM';
ALTER TYPE "UserRole" ADD VALUE 'WAREHOUSE_STAFF';
ALTER TYPE "UserRole" ADD VALUE 'FINANCE_LEAD';
ALTER TYPE "UserRole" ADD VALUE 'BOOKKEEPER';
ALTER TYPE "UserRole" ADD VALUE 'PAYROLL_MASTER';

-- AlterTable
ALTER TABLE "accounting_periods" ADD COLUMN     "reopenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reopenReason" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "reopenedById" TEXT;

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "postingControl" "PostingControl" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedBy" TEXT,
ADD COLUMN     "postingDate" TIMESTAMP(3),
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "reversalOfId" TEXT,
ADD COLUMN     "source" "JournalSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'PHP',
ADD COLUMN     "exchangeRate" DECIMAL(12,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "taxType" "TaxType" NOT NULL DEFAULT 'VAT_12';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customerAddress" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerTin" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceType" "InvoiceType" NOT NULL DEFAULT 'CASH_SALE',
ADD COLUMN     "taxType" "TaxType" NOT NULL DEFAULT 'VAT_12',
ADD COLUMN     "updatedById" TEXT,
ADD COLUMN     "voidInitiatedById" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "unitOfMeasureId" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "accountingMethod" "AccountingMethod" NOT NULL DEFAULT 'ACCRUAL',
ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "isBirRegistered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPtuHolder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVatRegistered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minNumber" TEXT,
ADD COLUMN     "ptuNumber" TEXT,
ADD COLUMN     "registeredAddress" TEXT,
ADD COLUMN     "taxStatus" "TaxStatus" NOT NULL DEFAULT 'UNREGISTERED',
ADD COLUMN     "tinNumber" TEXT;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "description" TEXT,
    "performedBy" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "z_read_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalOrders" INTEGER NOT NULL,
    "voidCount" INTEGER NOT NULL,
    "grossSales" DECIMAL(15,4) NOT NULL,
    "netSales" DECIMAL(15,4) NOT NULL,
    "vatAmount" DECIMAL(15,4) NOT NULL,
    "discountAmount" DECIMAL(15,4) NOT NULL,
    "cashAmount" DECIMAL(15,4) NOT NULL,
    "nonCashAmount" DECIMAL(15,4) NOT NULL,
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "z_read_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x_read_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "totalOrders" INTEGER NOT NULL,
    "voidCount" INTEGER NOT NULL,
    "grossSales" DECIMAL(15,4) NOT NULL,
    "netSales" DECIMAL(15,4) NOT NULL,
    "vatAmount" DECIMAL(15,4) NOT NULL,
    "discountAmount" DECIMAL(15,4) NOT NULL,
    "cashAmount" DECIMAL(15,4) NOT NULL,
    "nonCashAmount" DECIMAL(15,4) NOT NULL,
    "openingCash" DECIMAL(15,4) NOT NULL,
    "closingCash" DECIMAL(15,4) NOT NULL,
    "cashVariance" DECIMAL(15,4) NOT NULL,
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "x_read_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tin" TEXT,
    "address" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "defaultAtcCode" TEXT,
    "defaultWhtRate" DECIMAL(5,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "vendorId" TEXT,
    "description" TEXT NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "atcCode" TEXT,
    "whtRate" DECIMAL(5,4),
    "whtAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "inputVat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "referenceNumber" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_action_idx" ON "audit_logs"("tenantId", "action");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "z_read_logs_tenantId_date_idx" ON "z_read_logs"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "z_read_logs_branchId_date_key" ON "z_read_logs"("branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "x_read_logs_shiftId_key" ON "x_read_logs"("shiftId");

-- CreateIndex
CREATE INDEX "x_read_logs_tenantId_closedAt_idx" ON "x_read_logs"("tenantId", "closedAt");

-- CreateIndex
CREATE INDEX "vendors_tenantId_tin_idx" ON "vendors"("tenantId", "tin");

-- CreateIndex
CREATE INDEX "vendors_tenantId_isActive_idx" ON "vendors"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "expense_entries_tenantId_expenseDate_idx" ON "expense_entries"("tenantId", "expenseDate");

-- CreateIndex
CREATE INDEX "expense_entries_tenantId_status_idx" ON "expense_entries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "expense_entries_vendorId_idx" ON "expense_entries"("vendorId");

-- CreateIndex
CREATE INDEX "accounting_events_tenantId_status_createdAt_idx" ON "accounting_events"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversalOfId_key" ON "journal_entries"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_postingDate_idx" ON "journal_entries"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_status_idx" ON "journal_entries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "order_discounts_orderId_idx" ON "order_discounts"("orderId");

-- CreateIndex
CREATE INDEX "order_payments_orderId_idx" ON "order_payments"("orderId");

-- CreateIndex
CREATE INDEX "orders_tenantId_deletedAt_idx" ON "orders"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "orders_branchId_deletedAt_idx" ON "orders"("branchId", "deletedAt");

-- CreateIndex
CREATE INDEX "products_tenantId_sku_idx" ON "products"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "products_tenantId_barcode_idx" ON "products"("tenantId", "barcode");

-- CreateIndex
CREATE INDEX "promotions_tenantId_isActive_startDate_endDate_idx" ON "promotions"("tenantId", "isActive", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "shifts_branchId_closedAt_idx" ON "shifts"("branchId", "closedAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unitOfMeasureId_fkey" FOREIGN KEY ("unitOfMeasureId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "z_read_logs" ADD CONSTRAINT "z_read_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x_read_logs" ADD CONSTRAINT "x_read_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
