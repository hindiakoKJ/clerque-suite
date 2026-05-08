-- CreateEnum
CREATE TYPE "LaundryDeliveryStatus" AS ENUM ('PENDING_PICKUP', 'OUT_FOR_PICKUP', 'AT_LAUNDROMAT', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'LIQUIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FleetAssetKind" AS ENUM ('TRUCK_4_WHEELER', 'TRUCK_6_WHEELER', 'TRUCK_10_WHEELER', 'TRACTOR_HEAD', 'TRAILER', 'VAN', 'MOTORCYCLE');

-- CreateEnum
CREATE TYPE "PMScheduleType" AS ENUM ('ENGINE_OIL', 'TIRE_ROTATION', 'TIRE_REPLACEMENT', 'CHASSIS_LUBE', 'BRAKE_INSPECTION', 'TRANSMISSION_FLUID', 'AIR_FILTER', 'REGISTRATION_LTO', 'INSURANCE_RENEWAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ProgressBillingStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobOrderStatus" AS ENUM ('DRAFT', 'DIAGNOSING', 'AWAITING_APPROVAL', 'AWAITING_PARTS', 'IN_PROGRESS', 'QC', 'READY_FOR_PICKUP', 'CLAIMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobOrderLineKind" AS ENUM ('LABOR', 'PART', 'CONSUMABLE', 'SUBLET');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'PAID_OUT';
ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'CASH_VARIANCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'PHARMACY';
ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'TRUCKING';
ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'CONSTRUCTION';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "defaultAddress" TEXT,
ADD COLUMN     "loyaltyVisits" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "laundry_orders" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryFee" DECIMAL(10,2),
ADD COLUMN     "deliveryStatus" "LaundryDeliveryStatus",
ADD COLUMN     "isDelivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicStubToken" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "dispensedByPrc" TEXT,
ADD COLUMN     "lotId" TEXT,
ADD COLUMN     "prescriptionId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "dosageForm" TEXT,
ADD COLUMN     "genericName" TEXT,
ADD COLUMN     "isControlledDrug" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isRxRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "strength" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "prcLicense" TEXT,
ADD COLUMN     "prcLicenseExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "rxNumber" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientIdType" TEXT,
    "patientIdNumber" TEXT,
    "prescribingDoctor" TEXT NOT NULL,
    "doctorPrcLicense" TEXT NOT NULL,
    "doctorS2License" TEXT,
    "doctorClinic" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "refillsRemaining" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controlled_substance_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "patientName" TEXT NOT NULL,
    "patientIdType" TEXT NOT NULL,
    "patientIdNumber" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    "doctorPrcLicense" TEXT NOT NULL,
    "doctorS2License" TEXT NOT NULL,
    "pharmacistPrc" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "drugStrength" TEXT,
    "quantityDispensed" DECIMAL(10,3) NOT NULL,
    "dispensedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "controlled_substance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "kind" "FleetAssetKind" NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "bodyNumber" TEXT,
    "engineNumber" TEXT,
    "chassisNumber" TEXT,
    "yearModel" INTEGER,
    "mileageKm" INTEGER NOT NULL DEFAULT 0,
    "primaryDriverId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetAssetId" TEXT NOT NULL,
    "type" "PMScheduleType" NOT NULL,
    "customLabel" TEXT,
    "intervalKm" INTEGER,
    "intervalDays" INTEGER,
    "lastDoneAt" TIMESTAMP(3),
    "lastDoneMileageKm" INTEGER,
    "nextDueAt" TIMESTAMP(3),
    "nextDueMileageKm" INTEGER,
    "lastCost" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tire_serials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fleetAssetId" TEXT,
    "serialNumber" TEXT NOT NULL,
    "brand" TEXT,
    "size" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "installedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "position" TEXT,
    "installMileage" INTEGER,
    "removeMileage" INTEGER,
    "retreadCount" INTEGER NOT NULL DEFAULT 0,
    "costPrice" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tire_serials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tripNumber" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "orderId" TEXT,
    "customerId" TEXT,
    "fleetAssetId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "helperId" TEXT,
    "originLabel" TEXT NOT NULL,
    "destinationLabel" TEXT NOT NULL,
    "cargoDescription" TEXT,
    "cargoWeightKg" DECIMAL(10,2),
    "freightAmount" DECIMAL(12,2) NOT NULL,
    "cashAdvance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "receiptsTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "liquidationVariance" DECIMAL(12,2),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "liquidatedAt" TIMESTAMP(3),
    "liquidatedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidation_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripTicketId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receiptImageUrl" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_billings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "billingNumber" TEXT NOT NULL,
    "stageDescription" TEXT NOT NULL,
    "percentComplete" DECIMAL(5,2) NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "retentionPercent" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "retentionAmount" DECIMAL(14,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "status" "ProgressBillingStatus" NOT NULL DEFAULT 'DRAFT',
    "orderId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progress_billings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_releases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "progressBillingId" TEXT NOT NULL,
    "releasedAmount" DECIMAL(14,2) NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,
    "notes" TEXT,

    CONSTRAINT "retention_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "status" "JobOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "customerId" TEXT,
    "itemDescription" TEXT NOT NULL,
    "customerComplaint" TEXT,
    "diagnosis" TEXT,
    "assignedToId" TEXT,
    "estimateAmount" DECIMAL(12,2),
    "estimateApprovedAt" TIMESTAMP(3),
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "promisedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_order_lines" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "kind" "JobOrderLineKind" NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "technicianId" TEXT,
    "notes" TEXT,

    CONSTRAINT "job_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prescriptions_tenantId_customerId_idx" ON "prescriptions"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_tenantId_rxNumber_key" ON "prescriptions"("tenantId", "rxNumber");

-- CreateIndex
CREATE INDEX "product_lots_tenantId_productId_branchId_expiresAt_idx" ON "product_lots"("tenantId", "productId", "branchId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_lots_tenantId_productId_lotNumber_key" ON "product_lots"("tenantId", "productId", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "controlled_substance_logs_orderItemId_key" ON "controlled_substance_logs"("orderItemId");

-- CreateIndex
CREATE INDEX "controlled_substance_logs_tenantId_dispensedAt_idx" ON "controlled_substance_logs"("tenantId", "dispensedAt");

-- CreateIndex
CREATE INDEX "fleet_assets_tenantId_isActive_idx" ON "fleet_assets"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_assets_tenantId_plateNumber_key" ON "fleet_assets"("tenantId", "plateNumber");

-- CreateIndex
CREATE INDEX "pm_schedules_tenantId_fleetAssetId_idx" ON "pm_schedules"("tenantId", "fleetAssetId");

-- CreateIndex
CREATE INDEX "pm_schedules_tenantId_nextDueAt_idx" ON "pm_schedules"("tenantId", "nextDueAt");

-- CreateIndex
CREATE INDEX "tire_serials_tenantId_fleetAssetId_idx" ON "tire_serials"("tenantId", "fleetAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "tire_serials_tenantId_serialNumber_key" ON "tire_serials"("tenantId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "trip_tickets_orderId_key" ON "trip_tickets"("orderId");

-- CreateIndex
CREATE INDEX "trip_tickets_tenantId_status_idx" ON "trip_tickets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "trip_tickets_tenantId_fleetAssetId_dispatchedAt_idx" ON "trip_tickets"("tenantId", "fleetAssetId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "trip_tickets_tenantId_driverId_dispatchedAt_idx" ON "trip_tickets"("tenantId", "driverId", "dispatchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trip_tickets_tenantId_tripNumber_key" ON "trip_tickets"("tenantId", "tripNumber");

-- CreateIndex
CREATE INDEX "liquidation_items_tripTicketId_idx" ON "liquidation_items"("tripTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "progress_billings_orderId_key" ON "progress_billings"("orderId");

-- CreateIndex
CREATE INDEX "progress_billings_tenantId_projectId_createdAt_idx" ON "progress_billings"("tenantId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "progress_billings_tenantId_status_idx" ON "progress_billings"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "progress_billings_tenantId_billingNumber_key" ON "progress_billings"("tenantId", "billingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "retention_releases_progressBillingId_key" ON "retention_releases"("progressBillingId");

-- CreateIndex
CREATE UNIQUE INDEX "retention_releases_orderId_key" ON "retention_releases"("orderId");

-- CreateIndex
CREATE INDEX "retention_releases_tenantId_releasedAt_idx" ON "retention_releases"("tenantId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_orders_orderId_key" ON "job_orders"("orderId");

-- CreateIndex
CREATE INDEX "job_orders_tenantId_status_idx" ON "job_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "job_orders_tenantId_branchId_createdAt_idx" ON "job_orders"("tenantId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_orders_tenantId_jobNumber_key" ON "job_orders"("tenantId", "jobNumber");

-- CreateIndex
CREATE INDEX "job_order_lines_jobOrderId_idx" ON "job_order_lines"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "laundry_orders_publicStubToken_key" ON "laundry_orders"("publicStubToken");

-- CreateIndex
CREATE INDEX "order_items_prescriptionId_idx" ON "order_items"("prescriptionId");

-- CreateIndex
CREATE INDEX "order_items_lotId_idx" ON "order_items"("lotId");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "product_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_substance_logs" ADD CONSTRAINT "controlled_substance_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_substance_logs" ADD CONSTRAINT "controlled_substance_logs_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assets" ADD CONSTRAINT "fleet_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assets" ADD CONSTRAINT "fleet_assets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assets" ADD CONSTRAINT "fleet_assets_primaryDriverId_fkey" FOREIGN KEY ("primaryDriverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_fleetAssetId_fkey" FOREIGN KEY ("fleetAssetId") REFERENCES "fleet_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tire_serials" ADD CONSTRAINT "tire_serials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tire_serials" ADD CONSTRAINT "tire_serials_fleetAssetId_fkey" FOREIGN KEY ("fleetAssetId") REFERENCES "fleet_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tickets" ADD CONSTRAINT "trip_tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tickets" ADD CONSTRAINT "trip_tickets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tickets" ADD CONSTRAINT "trip_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tickets" ADD CONSTRAINT "trip_tickets_fleetAssetId_fkey" FOREIGN KEY ("fleetAssetId") REFERENCES "fleet_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tickets" ADD CONSTRAINT "trip_tickets_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tickets" ADD CONSTRAINT "trip_tickets_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tickets" ADD CONSTRAINT "trip_tickets_liquidatedById_fkey" FOREIGN KEY ("liquidatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tickets" ADD CONSTRAINT "trip_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidation_items" ADD CONSTRAINT "liquidation_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidation_items" ADD CONSTRAINT "liquidation_items_tripTicketId_fkey" FOREIGN KEY ("tripTicketId") REFERENCES "trip_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_billings" ADD CONSTRAINT "progress_billings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_billings" ADD CONSTRAINT "progress_billings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_billings" ADD CONSTRAINT "progress_billings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_releases" ADD CONSTRAINT "retention_releases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_releases" ADD CONSTRAINT "retention_releases_progressBillingId_fkey" FOREIGN KEY ("progressBillingId") REFERENCES "progress_billings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_releases" ADD CONSTRAINT "retention_releases_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_lines" ADD CONSTRAINT "job_order_lines_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_lines" ADD CONSTRAINT "job_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_lines" ADD CONSTRAINT "job_order_lines_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

