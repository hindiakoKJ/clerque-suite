-- DME (Medical Equipment) + Gas Station verticals
-- One migration covers both because they ship together as new vertical packs.

-- ════════════════════════════════════════════════════════════════════════════
-- BusinessType enum additions
-- ════════════════════════════════════════════════════════════════════════════
ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'MEDICAL_EQUIPMENT';
ALTER TYPE "BusinessType" ADD VALUE IF NOT EXISTS 'GAS_STATION';

-- ════════════════════════════════════════════════════════════════════════════
-- DME (Medical Equipment) — serial tracking + rentals + repairs
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE "SerializedUnitStatus" AS ENUM ('IN_STOCK', 'SOLD', 'ON_RENT', 'IN_REPAIR', 'RETIRED');
CREATE TYPE "RentalStatus"         AS ENUM ('OPEN', 'RETURNED', 'OVERDUE', 'LOST');
CREATE TYPE "RepairStatus"         AS ENUM ('RECEIVED', 'AWAITING_PARTS', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED');

-- ── SerializedUnit ─────────────────────────────────────────────────────────
CREATE TABLE "serialized_units" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "productId"      TEXT NOT NULL,
  "serialNumber"   TEXT NOT NULL,
  "status"         "SerializedUnitStatus" NOT NULL DEFAULT 'IN_STOCK',
  "acquiredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acquiredCost"   DECIMAL(14, 2),
  "conditionNotes" TEXT,
  "soldOrderId"    TEXT,
  "currentRentalId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "serialized_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "serialized_units_tenantId_serialNumber_key" ON "serialized_units"("tenantId", "serialNumber");
CREATE INDEX "serialized_units_tenantId_productId_status_idx" ON "serialized_units"("tenantId", "productId", "status");
CREATE INDEX "serialized_units_branchId_status_idx" ON "serialized_units"("branchId", "status");

ALTER TABLE "serialized_units"
  ADD CONSTRAINT "serialized_units_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "serialized_units"
  ADD CONSTRAINT "serialized_units_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "serialized_units"
  ADD CONSTRAINT "serialized_units_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RentalAgreement ────────────────────────────────────────────────────────
CREATE TABLE "rental_agreements" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "branchId"         TEXT NOT NULL,
  "customerId"       TEXT NOT NULL,
  "serializedUnitId" TEXT NOT NULL,
  "status"           "RentalStatus" NOT NULL DEFAULT 'OPEN',
  "rentalRate"       DECIMAL(12, 2) NOT NULL,
  "rateUnit"         TEXT NOT NULL,
  "depositCents"     INTEGER NOT NULL DEFAULT 0,
  "depositOrderId"   TEXT,
  "returnOrderId"    TEXT,
  "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt"            TIMESTAMP(3) NOT NULL,
  "returnedAt"       TIMESTAMP(3),
  "damageFeeCents"   INTEGER NOT NULL DEFAULT 0,
  "refundCents"      INTEGER NOT NULL DEFAULT 0,
  "intakeNotes"      TEXT,
  "returnNotes"      TEXT,
  "createdById"      TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rental_agreements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_agreements_depositOrderId_key" ON "rental_agreements"("depositOrderId");
CREATE UNIQUE INDEX "rental_agreements_returnOrderId_key"  ON "rental_agreements"("returnOrderId");
CREATE INDEX "rental_agreements_tenantId_branchId_status_dueAt_idx" ON "rental_agreements"("tenantId", "branchId", "status", "dueAt");
CREATE INDEX "rental_agreements_customerId_idx" ON "rental_agreements"("customerId");
CREATE INDEX "rental_agreements_serializedUnitId_idx" ON "rental_agreements"("serializedUnitId");

ALTER TABLE "rental_agreements"
  ADD CONSTRAINT "rental_agreements_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rental_agreements"
  ADD CONSTRAINT "rental_agreements_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_agreements"
  ADD CONSTRAINT "rental_agreements_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_agreements"
  ADD CONSTRAINT "rental_agreements_serializedUnitId_fkey"
  FOREIGN KEY ("serializedUnitId") REFERENCES "serialized_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_agreements"
  ADD CONSTRAINT "rental_agreements_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RepairTicket ───────────────────────────────────────────────────────────
CREATE TABLE "repair_tickets" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "branchId"         TEXT NOT NULL,
  "ticketNumber"     TEXT NOT NULL,
  "customerId"       TEXT,
  "serializedUnitId" TEXT,
  "itemDescription"  TEXT NOT NULL,
  "reportedIssue"    TEXT NOT NULL,
  "diagnosis"        TEXT,
  "status"           "RepairStatus" NOT NULL DEFAULT 'RECEIVED',
  "quotedFeeCents"   INTEGER NOT NULL DEFAULT 0,
  "pickupOrderId"    TEXT,
  "receivedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt"          TIMESTAMP(3),
  "pickedUpAt"       TIMESTAMP(3),
  "createdById"      TEXT NOT NULL,
  "technicianId"     TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "repair_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "repair_tickets_tenantId_ticketNumber_key" ON "repair_tickets"("tenantId", "ticketNumber");
CREATE UNIQUE INDEX "repair_tickets_pickupOrderId_key"        ON "repair_tickets"("pickupOrderId");
CREATE INDEX "repair_tickets_tenantId_branchId_status_idx"    ON "repair_tickets"("tenantId", "branchId", "status");
CREATE INDEX "repair_tickets_customerId_idx"                  ON "repair_tickets"("customerId");

ALTER TABLE "repair_tickets"
  ADD CONSTRAINT "repair_tickets_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "repair_tickets"
  ADD CONSTRAINT "repair_tickets_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "repair_tickets"
  ADD CONSTRAINT "repair_tickets_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "repair_tickets"
  ADD CONSTRAINT "repair_tickets_serializedUnitId_fkey"
  FOREIGN KEY ("serializedUnitId") REFERENCES "serialized_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "repair_tickets"
  ADD CONSTRAINT "repair_tickets_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "repair_tickets"
  ADD CONSTRAINT "repair_tickets_technicianId_fkey"
  FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Gas Station — fuel pumps + dispenses + tank dips
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE "FuelGrade"          AS ENUM ('UNLEADED', 'REGULAR', 'DIESEL', 'PREMIUM', 'KEROSENE', 'OTHER');
CREATE TYPE "FuelDispenseStatus" AS ENUM ('OPEN', 'COMPLETED', 'VOIDED');
CREATE TYPE "TankDipKind"        AS ENUM ('MORNING', 'EVENING', 'DELIVERY');

-- ── FuelPump ───────────────────────────────────────────────────────────────
CREATE TABLE "fuel_pumps" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "branchId"     TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "fuelGrade"    "FuelGrade" NOT NULL,
  "productId"    TEXT NOT NULL,
  "currentMeter" DECIMAL(14, 3) NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fuel_pumps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fuel_pumps_tenantId_branchId_label_key" ON "fuel_pumps"("tenantId", "branchId", "label");
CREATE INDEX "fuel_pumps_tenantId_branchId_isActive_idx"     ON "fuel_pumps"("tenantId", "branchId", "isActive");

ALTER TABLE "fuel_pumps"
  ADD CONSTRAINT "fuel_pumps_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fuel_pumps"
  ADD CONSTRAINT "fuel_pumps_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fuel_pumps"
  ADD CONSTRAINT "fuel_pumps_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── FuelDispense ───────────────────────────────────────────────────────────
CREATE TABLE "fuel_dispenses" (
  "id"              TEXT NOT NULL,
  "pumpId"          TEXT NOT NULL,
  "attendantId"     TEXT NOT NULL,
  "openingMeter"    DECIMAL(14, 3) NOT NULL,
  "closingMeter"    DECIMAL(14, 3),
  "litersDispensed" DECIMAL(14, 3),
  "pricePerLiter"   DECIMAL(8, 2) NOT NULL,
  "totalCents"      INTEGER,
  "orderId"         TEXT,
  "status"          "FuelDispenseStatus" NOT NULL DEFAULT 'OPEN',
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"         TIMESTAMP(3),
  "voidReason"      TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fuel_dispenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fuel_dispenses_pumpId_openingMeter_key" ON "fuel_dispenses"("pumpId", "openingMeter");
CREATE UNIQUE INDEX "fuel_dispenses_orderId_key"             ON "fuel_dispenses"("orderId");
CREATE INDEX "fuel_dispenses_pumpId_status_idx"              ON "fuel_dispenses"("pumpId", "status");
CREATE INDEX "fuel_dispenses_attendantId_startedAt_idx"      ON "fuel_dispenses"("attendantId", "startedAt");

ALTER TABLE "fuel_dispenses"
  ADD CONSTRAINT "fuel_dispenses_pumpId_fkey"
  FOREIGN KEY ("pumpId") REFERENCES "fuel_pumps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fuel_dispenses"
  ADD CONSTRAINT "fuel_dispenses_attendantId_fkey"
  FOREIGN KEY ("attendantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── TankDip ────────────────────────────────────────────────────────────────
CREATE TABLE "tank_dips" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "fuelGrade"      "FuelGrade" NOT NULL,
  "recordedAt"     TIMESTAMP(3) NOT NULL,
  "kind"           "TankDipKind" NOT NULL,
  "litersOnHand"   DECIMAL(14, 3) NOT NULL,
  "deliveryLiters" DECIMAL(14, 3),
  "notes"          TEXT,
  "recordedById"   TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tank_dips_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tank_dips_tenantId_branchId_fuelGrade_recordedAt_idx"
  ON "tank_dips"("tenantId", "branchId", "fuelGrade", "recordedAt");

ALTER TABLE "tank_dips"
  ADD CONSTRAINT "tank_dips_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tank_dips"
  ADD CONSTRAINT "tank_dips_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tank_dips"
  ADD CONSTRAINT "tank_dips_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
